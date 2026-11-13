// Contract: docs/design.md #8.3 — which speech model Dozin will use (checked when the extension loads) and the
// background task `speech-model` that downloads one. Downloads are fake: small payloads served by a fake fetch.
import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const packageDir = new URL('../miniapp/extension/', import.meta.url)
const { DOWNLOAD_DIR, SPEECH_MODELS, VAD, checkSpeechModels, runSpeechModel, speechCheckLine, speechModelsRoot } = await import(new URL('speechModel.mjs', packageDir))
const { activate, logSpeechModels } = await import(new URL('index.mjs', packageDir))

const [QWEN, SENSE] = SPEECH_MODELS
const sha = (buffer) => createHash('sha256').update(buffer).digest('hex')

/** `<home>` with the extension's data directory; removed after the test. */
const makeHome = (t) => {
  const home = mkdtempSync(join(tmpdir(), 'audience-speech-'))
  t.after(() => rmSync(home, { recursive: true, force: true }))
  const dataDir = join(home, 'userdata', 'extensions', 'audience-bot')
  mkdirSync(dataDir, { recursive: true })
  const root = join(home, 'speech-models')
  mkdirSync(root, { recursive: true })
  return { home, dataDir, root }
}

const write = (path, content = 'x') => {
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, content)
}
const placeVad = (root) => write(join(root, VAD.file), Buffer.alloc(VAD.bytes))
const placeModel = (root, model) => { for (const file of model.files) write(join(root, model.dir, file), `${model.id}:${file}`) }
const pause = (ms) => new Promise((done) => setTimeout(done, ms))
const listAll = (dir) => (existsSync(dir) ? readdirSync(dir, { recursive: true }).map(String).sort() : [])

test('the models root is three levels above the data directory, and only for <home>/userdata/extensions/<name>', () => {
  assert.equal(speechModelsRoot('/Users/a/.dozin_preview/userdata/extensions/audience-bot'), '/Users/a/.dozin_preview/speech-models')
  assert.equal(speechModelsRoot('/Users/a/.dozin/extensions/data/audience-bot'), undefined, 'an older layout is not guessed')
  assert.equal(speechModelsRoot('/Users/a/projects/audience-bot'), undefined)
})

test('check: nothing, only SenseVoice, both, and a download on its way give the same answer as Dozin', async (t) => {
  const { root } = makeHome(t)
  let check = await checkSpeechModels(root)
  assert.equal(check.selected, null)
  assert.equal(check.pending, false)
  assert.deepEqual(check.models.map((model) => model.state), ['missing', 'missing'])
  assert.equal(speechCheckLine(check), 'speech model: none ready, download needed — vad missing, qwen3-asr-0.6b missing, sensevoice-small missing')

  placeModel(root, SENSE)
  check = await checkSpeechModels(root)
  assert.equal(check.selected, null, 'no model is used without the VAD')
  placeVad(root)
  check = await checkSpeechModels(root)
  assert.equal(check.selected, 'sensevoice-small')
  assert.equal(speechCheckLine(check), 'speech model: Dozin will use SenseVoice Small (sensevoice-small) — vad ready, qwen3-asr-0.6b missing, sensevoice-small ready')

  placeModel(root, QWEN)
  check = await checkSpeechModels(root)
  assert.equal(check.selected, 'qwen3-asr-0.6b', 'Dozin prefers the first ready one in its list')

  const { root: other } = makeHome(t)
  write(join(other, DOWNLOAD_DIR, QWEN.archive), Buffer.alloc(312_000_000 / 1000))
  check = await checkSpeechModels(other)
  assert.deepEqual(check.models[0], { id: QWEN.id, name: QWEN.name, bytes: QWEN.bytes, state: 'downloading', received: 312000 })
  assert.equal(check.pending, true)
  assert.match(speechCheckLine(check), /^speech model: none ready, download in progress — vad missing, qwen3-asr-0.6b downloading 0\/879 MB/)
  mkdirSync(join(other, DOWNLOAD_DIR, SENSE.dir))
  assert.equal((await checkSpeechModels(other)).models[1].state, 'installing', 'an extracted directory waiting to be moved')
})

test('activate registers the manual background task and logs one line on the model, without downloading', async (t) => {
  const cwd = process.cwd()
  t.after(() => process.chdir(cwd))
  const cases = [
    ['no model', () => {}, 'speech model: none ready, download needed — vad missing, qwen3-asr-0.6b missing, sensevoice-small missing'],
    ['only SenseVoice', (root) => { placeVad(root); placeModel(root, SENSE) }, 'speech model: Dozin will use SenseVoice Small (sensevoice-small) — vad ready, qwen3-asr-0.6b missing, sensevoice-small ready'],
    ['both', (root) => { placeVad(root); placeModel(root, SENSE); placeModel(root, QWEN) }, 'speech model: Dozin will use Qwen3-ASR 0.6B (qwen3-asr-0.6b) — vad ready, qwen3-asr-0.6b ready, sensevoice-small ready'],
    ['downloading', (root) => write(join(root, DOWNLOAD_DIR, SENSE.archive), Buffer.alloc(2_000_000)), 'speech model: none ready, download in progress — vad missing, qwen3-asr-0.6b missing, sensevoice-small downloading 2/163 MB']
  ]
  let services
  for (const [name, setup, line] of cases) {
    const { dataDir, root } = makeHome(t)
    setup(root)
    const before = listAll(root)
    process.chdir(dataDir)
    services = []
    const logs = []
    activate({ registerConnector() {}, registerService: (definition) => services.push(definition), log: (text) => logs.push(text) })
    for (let i = 0; i < 50 && !logs.length; i++) await pause(10)
    assert.deepEqual(logs, [line], name)
    assert.deepEqual(listAll(root), before, `${name}: nothing is downloaded or changed at load`)
  }
  assert.equal(services.length, 1)
  const { id, name, start, restart, run } = services[0]
  assert.deepEqual({ id, name, start, restart }, { id: 'speech-model', name: '下载语音模型', start: 'manual', restart: { policy: 'never' } })
  assert.equal(typeof run, 'function')

  const lines = []
  await logSpeechModels((text) => lines.push(text), '/somewhere/else/audience-bot')
  assert.deepEqual(lines, ['speech model: not checked (the data directory is not <home>/userdata/extensions/<name>)'])
})

/** Small stand-ins for the real files: the same ids, names and directories, payloads of a few bytes. */
const fakeEntries = ({ badModel = false } = {}) => {
  const vadPayload = Buffer.from('vad-bytes')
  const modelPayload = Buffer.from('model-archive-bytes')
  const vad = { ...VAD, bytes: vadPayload.length, sha256: sha(vadPayload) }
  const models = SPEECH_MODELS.map((model) => ({ ...model, bytes: modelPayload.length, sha256: badModel ? sha(Buffer.from('other')) : sha(modelPayload) }))
  return { vad, models, payloads: { [VAD.file]: vadPayload, [QWEN.archive]: modelPayload, [SENSE.archive]: modelPayload } }
}

const fakeFetch = (payloads, calls) => async (url) => {
  const name = url.split('/').at(-1)
  calls.push(name)
  return payloads[name] ? new Response(payloads[name]) : new Response('missing', { status: 404 })
}

/** Stands in for tar: puts the model's directory with its files into `.download/`. */
const fakeExtract = (calls) => async ({ archive, into }) => {
  calls.push(archive.split('/').at(-1))
  const model = SPEECH_MODELS.find((item) => archive.endsWith(item.archive))
  for (const file of model.files) write(join(into, model.dir, file), 'extracted')
}

const fakeCtx = (dataDir, input, signal) => {
  const statuses = [], logs = []
  return { statuses, logs, ctx: { input, dataDir, signal, status: (text, level, progress) => statuses.push({ text, level, ...(progress ? { progress } : {}) }), log: (text) => logs.push(text) } }
}
const onMac = { platform: 'darwin', arch: 'arm64' }

test('task: an unknown model is refused and nothing is touched', async (t) => {
  const { dataDir, root } = makeHome(t)
  const fetched = []
  for (const input of [{ model: 'whisper-large' }, {}, undefined]) {
    const { ctx, statuses } = fakeCtx(dataDir, input)
    await assert.rejects(runSpeechModel(ctx, { fetch: fakeFetch({}, fetched), ...onMac }), { code: 'unknown_model' })
    assert.equal(statuses.at(-1).level, 'error')
    assert.equal(statuses.at(-1).text, '失败：不认识的模型（只能是 qwen3-asr-0.6b 或 sensevoice-small）')
  }
  assert.deepEqual(fetched, [])
  assert.deepEqual(listAll(root), [])
  const { ctx } = fakeCtx(dataDir, { model: QWEN.id })
  await assert.rejects(runSpeechModel(ctx, { fetch: fakeFetch({}, fetched), platform: 'win32', arch: 'x64' }), { code: 'unsupported_platform' })
  assert.deepEqual(fetched, [])
})

test('task: a bad checksum deletes what was downloaded and leaves the ready model and VAD alone', async (t) => {
  const { dataDir, root } = makeHome(t)
  placeVad(root)
  placeModel(root, SENSE)
  const before = listAll(root)
  const { vad, models, payloads } = fakeEntries({ badModel: true })
  const { ctx, statuses } = fakeCtx(dataDir, { model: QWEN.id })
  const fetched = [], extracted = []
  await assert.rejects(runSpeechModel(ctx, { models, vad: { ...vad, bytes: VAD.bytes }, fetch: fakeFetch(payloads, fetched), extract: fakeExtract(extracted), ...onMac }), { code: 'checksum_mismatch' })
  assert.deepEqual(fetched, [QWEN.archive], 'the VAD is ready, so only the model is fetched')
  assert.deepEqual(extracted, [], 'never extracted')
  assert.equal(statuses.at(-1).text, '失败：校验不对，已删除下载的文件')
  assert.deepEqual(listAll(join(root, DOWNLOAD_DIR)), [])
  assert.deepEqual(listAll(root).filter((path) => path !== DOWNLOAD_DIR), before)
  assert.equal(readFileSync(join(root, SENSE.dir, 'tokens.txt'), 'utf8'), 'sensevoice-small:tokens.txt')
})

test('task: success downloads the VAD and the model, moves them into place and leaves .download empty', async (t) => {
  const { dataDir, root } = makeHome(t)
  const { vad, models, payloads } = fakeEntries()
  // A partial file left earlier by an interrupted download is replaced, not taken as a running one.
  write(join(root, DOWNLOAD_DIR, QWEN.archive), 'stale')
  await pause(60)
  const { ctx, statuses, logs } = fakeCtx(dataDir, { model: QWEN.id })
  const fetched = [], extracted = []
  await runSpeechModel(ctx, { models, vad, fetch: fakeFetch(payloads, fetched), extract: fakeExtract(extracted), busyMs: 30, ...onMac })
  assert.deepEqual(fetched, [VAD.file, QWEN.archive])
  assert.deepEqual(extracted, [QWEN.archive])
  assert.deepEqual(statuses.map(({ text }) => text), ['下载断句模型 silero_vad', '下载 Qwen3-ASR 0.6B：0 / 0 MB', '下载 Qwen3-ASR 0.6B：0 / 0 MB', '解压中：Qwen3-ASR 0.6B', '已就绪：Qwen3-ASR 0.6B'])
  assert.deepEqual(statuses[2].progress, { done: payloads[QWEN.archive].length, total: payloads[QWEN.archive].length })
  assert.ok(statuses.every(({ level }) => level === 'info'))
  assert.deepEqual(listAll(join(root, DOWNLOAD_DIR)), [])
  assert.deepEqual(readFileSync(join(root, VAD.file)), payloads[VAD.file])
  for (const file of QWEN.files) assert.ok(existsSync(join(root, QWEN.dir, file)), file)
  const check = await checkSpeechModels(root, { models, vad })
  assert.equal(check.selected, QWEN.id)
  assert.match(logs.at(-1), /^speech-model: qwen3-asr-0.6b ready; speech model: Dozin will use Qwen3-ASR 0.6B/)

  // Downloading SenseVoice now says that Dozin keeps using Qwen3-ASR.
  const second = fakeCtx(dataDir, { model: SENSE.id })
  await runSpeechModel(second.ctx, { models, vad, fetch: fakeFetch(payloads, fetched), extract: fakeExtract(extracted), ...onMac })
  assert.equal(second.statuses.at(-1).text, '已就绪：SenseVoice Small（Dozin 会先用已就绪的 Qwen3-ASR 0.6B）')
})

test('task: a model already ready ends at once without fetching', async (t) => {
  const { dataDir, root } = makeHome(t)
  placeVad(root)
  placeModel(root, SENSE)
  const fetched = []
  const { ctx, statuses } = fakeCtx(dataDir, { model: SENSE.id })
  await runSpeechModel(ctx, { fetch: fakeFetch({}, fetched), ...onMac })
  assert.deepEqual(fetched, [])
  assert.deepEqual(statuses, [{ text: '已就绪：SenseVoice Small', level: 'info' }])
})

test('task: a file in .download that is still growing belongs to another download and is not touched', async (t) => {
  const { dataDir, root } = makeHome(t)
  placeVad(root)
  write(join(root, DOWNLOAD_DIR, SENSE.archive), 'being written')
  const fetched = []
  const { ctx, statuses } = fakeCtx(dataDir, { model: SENSE.id })
  await assert.rejects(runSpeechModel(ctx, { fetch: fakeFetch({}, fetched), ...onMac }), { code: 'download_busy' })
  assert.equal(statuses.at(-1).text, '失败：另一个下载正在进行，稍后再试')
  assert.equal(readFileSync(join(root, DOWNLOAD_DIR, SENSE.archive), 'utf8'), 'being written')
  assert.deepEqual(fetched, [])
})

test('task: a file still growing inside an older extracted folder counts as busy (the skill extracting)', async (t) => {
  const { dataDir, root } = makeHome(t)
  placeVad(root)
  const inner = join(root, DOWNLOAD_DIR, SENSE.dir, 'model.int8.onnx')
  write(inner, 'part')
  await pause(80)
  appendFileSync(inner, 'more')
  const { ctx } = fakeCtx(dataDir, { model: SENSE.id })
  await assert.rejects(runSpeechModel(ctx, { fetch: fakeFetch({}, []), busyMs: 50, ...onMac }), { code: 'download_busy' })
  assert.equal(readFileSync(inner, 'utf8'), 'partmore')
})

test('task: wrong size, missing files after extracting and a fetch failure each clean up and say why', async (t) => {
  const { dataDir, root } = makeHome(t)
  placeVad(root)
  const { vad, payloads } = fakeEntries()
  const ready = { ...vad, bytes: VAD.bytes }
  const sized = (extra) => SPEECH_MODELS.map((model) => ({ ...model, bytes: payloads[SENSE.archive].length + extra, sha256: sha(payloads[SENSE.archive]) }))
  const cases = [
    ['size_mismatch', { models: sized(5), fetch: fakeFetch(payloads, []) }, '失败：大小不对，已删除下载的文件'],
    ['extract_incomplete', { models: sized(0), fetch: fakeFetch(payloads, []), extract: async ({ into }) => write(join(into, SENSE.dir, SENSE.files[0])) }, '失败：解压后缺文件，已删除下载的文件'],
    ['network', { models: sized(0), fetch: async () => { throw new TypeError('fetch failed', { cause: { code: 'ECONNRESET' } }) } }, '失败：网络中断，已删除下载的文件'],
    ['failed', { models: sized(0), fetch: async () => { throw new TypeError('x is not a function') } }, '失败：出错（failed），已删除下载的文件']
  ]
  for (const [code, deps, text] of cases) {
    const { ctx, statuses } = fakeCtx(dataDir, { model: SENSE.id })
    await assert.rejects(runSpeechModel(ctx, { vad: ready, extract: fakeExtract([]), ...deps, ...onMac }), { code }, code)
    assert.equal(statuses.at(-1).text, text, code)
    assert.deepEqual(listAll(join(root, DOWNLOAD_DIR)), [], `${code}: .download is empty`)
    assert.equal(existsSync(join(root, SENSE.dir)), false, `${code}: nothing moved into place`)
  }
})

test('task: an incomplete model folder is replaced; one that became ready during the run is kept', async (t) => {
  const { dataDir, root } = makeHome(t)
  placeVad(root)
  const { vad, models, payloads } = fakeEntries()
  const ready = { ...vad, bytes: VAD.bytes }
  write(join(root, SENSE.dir, 'tokens.txt'), 'old')
  write(join(root, SENSE.dir, 'leftover.bin'), 'old')
  const first = fakeCtx(dataDir, { model: SENSE.id })
  await runSpeechModel(first.ctx, { models, vad: ready, fetch: fakeFetch(payloads, []), extract: fakeExtract([]), ...onMac })
  assert.deepEqual(listAll(join(root, SENSE.dir)), ['model.int8.onnx', 'tokens.txt'])
  assert.equal(readFileSync(join(root, SENSE.dir, 'tokens.txt'), 'utf8'), 'extracted')

  // Another download (the skill) finishes Qwen3 while this one is extracting: theirs stays, ours is dropped.
  const theirs = async ({ archive, into }) => {
    await fakeExtract([])({ archive, into })
    for (const file of QWEN.files) write(join(root, QWEN.dir, file), 'theirs')
  }
  const second = fakeCtx(dataDir, { model: QWEN.id })
  await runSpeechModel(second.ctx, { models, vad: ready, fetch: fakeFetch(payloads, []), extract: theirs, ...onMac })
  for (const file of QWEN.files) assert.equal(readFileSync(join(root, QWEN.dir, file), 'utf8'), 'theirs', file)
  assert.deepEqual(listAll(join(root, DOWNLOAD_DIR)), [])
  assert.equal(second.statuses.at(-1).text, '已就绪：Qwen3-ASR 0.6B')
})

test('task: an HTTP error and a stop both clean up; a stop is not a failure', async (t) => {
  const { dataDir, root } = makeHome(t)
  placeVad(root)
  const { models, vad } = fakeEntries()
  const failed = fakeCtx(dataDir, { model: SENSE.id })
  await assert.rejects(runSpeechModel(failed.ctx, { models, vad: { ...vad, bytes: VAD.bytes }, fetch: fakeFetch({}, []), ...onMac }), { code: 'http_404' })
  assert.equal(failed.statuses.at(-1).text, '失败：下载出错（HTTP 404），已删除下载的文件')
  assert.deepEqual(listAll(join(root, DOWNLOAD_DIR)), [])

  const controller = new AbortController()
  const endless = async (_url, { signal }) => new Response(new ReadableStream({
    start(stream) {
      stream.enqueue(new Uint8Array(4))
      signal.addEventListener('abort', () => stream.error(signal.reason))
    }
  }))
  const stopped = fakeCtx(dataDir, { model: SENSE.id }, controller.signal)
  const running = runSpeechModel(stopped.ctx, { vad: { ...VAD }, fetch: endless, ...onMac })
  for (let i = 0; i < 50 && !existsSync(join(root, DOWNLOAD_DIR, SENSE.archive)); i++) await new Promise((done) => setTimeout(done, 10))
  assert.ok(existsSync(join(root, DOWNLOAD_DIR, SENSE.archive)), 'the download had started')
  controller.abort()
  await running
  assert.equal(stopped.statuses.at(-1).text, '已停止，已删除下载的文件')
  assert.deepEqual(listAll(join(root, DOWNLOAD_DIR)), [])
})

test('task: the real tar extracts the model without its sample recordings', { skip: !existsSync('/usr/bin/tar') && 'no /usr/bin/tar' }, async (t) => {
  const { dataDir, root } = makeHome(t)
  placeVad(root)
  const src = mkdtempSync(join(tmpdir(), 'audience-archive-'))
  t.after(() => rmSync(src, { recursive: true, force: true }))
  for (const file of [...SENSE.files, 'test_wavs/zh.wav']) write(join(src, SENSE.dir, file), file)
  execFileSync('/usr/bin/tar', ['-cjf', join(src, SENSE.archive), '-C', src, SENSE.dir])
  const payload = readFileSync(join(src, SENSE.archive))
  const models = SPEECH_MODELS.map((model) => (model.id === SENSE.id ? { ...model, bytes: payload.length, sha256: sha(payload) } : model))
  const { ctx, statuses } = fakeCtx(dataDir, { model: SENSE.id })
  await runSpeechModel(ctx, { models, fetch: fakeFetch({ [SENSE.archive]: payload }, []), ...onMac })
  assert.equal(statuses.at(-1).text, '已就绪：SenseVoice Small')
  assert.deepEqual(listAll(join(root, SENSE.dir)), ['model.int8.onnx', 'tokens.txt'])
  assert.equal(statSync(join(root, SENSE.dir, 'tokens.txt')).isFile(), true)
  assert.deepEqual(listAll(join(root, DOWNLOAD_DIR)), [])
})

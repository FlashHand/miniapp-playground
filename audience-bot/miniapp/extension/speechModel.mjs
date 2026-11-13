// Speech models for Dozin's built-in recognition (docs/design.md #8.3): which model Dozin will use, and the background
// task `speech-model` that downloads one into `<home>/speech-models/` the way Dozin expects (`.download/` → check →
// extract → move). The list and the "ready" rules copy Dozin's src/shared/speech/speechModels.ts and speechStatus.ts:
// change them together.
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { lstat, mkdir, readdir, rename, rm, stat } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'

/** Public copies of the official sherpa-onnx release assets (Ral 2026-11-08: OSS only). */
export const MODEL_BASE_URL = 'https://dozin-public-assets.oss-cn-hangzhou.aliyuncs.com/models/speech-models/sherpa-onnx'
export const DOWNLOAD_DIR = '.download'
/** A file in `.download/` that changed this recently belongs to a download still running elsewhere (the skill's script). */
export const BUSY_MS = 15000
const PROGRESS_MS = 1000

/** Sentence cutting; no model is used without it. */
export const VAD = { file: 'silero_vad.onnx', bytes: 643854, sha256: '9e2449e1087496d8d4caba907f23e0bd3f78d91fa552479bb9c23ac09cbb1fd6' }

/** In Dozin's order: the first one that is ready (with the VAD) is the one Dozin uses. `files` are those Dozin checks. */
export const SPEECH_MODELS = Object.freeze([
  {
    id: 'qwen3-asr-0.6b',
    name: 'Qwen3-ASR 0.6B',
    dir: 'sherpa-onnx-qwen3-asr-0.6B-int8-2026-03-25',
    archive: 'sherpa-onnx-qwen3-asr-0.6B-int8-2026-03-25.tar.bz2',
    bytes: 878702423,
    sha256: '393f8a14e2f5fb96746aaab342997a40641001fbd5bf9592a080a8329178ee96',
    files: ['conv_frontend.onnx', 'encoder.int8.onnx', 'decoder.int8.onnx', 'tokenizer']
  },
  {
    id: 'sensevoice-small',
    name: 'SenseVoice Small',
    dir: 'sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2024-07-17',
    archive: 'sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2024-07-17.tar.bz2',
    bytes: 163002883,
    sha256: '7d1efa2138a65b0b488df37f8b89e3d91a60676e416f515b952358d83dfd347e',
    files: ['model.int8.onnx', 'tokens.txt']
  }
])

/**
 * `<home>/speech-models` from this extension's data directory `<home>/userdata/extensions/<name>` (the Host's working
 * directory); undefined when the path has another shape, so nothing is read or written in a guessed place.
 */
export const speechModelsRoot = (dataDir) => {
  const extensions = dirname(dataDir)
  const userdata = dirname(extensions)
  if (basename(extensions) !== 'extensions' || basename(userdata) !== 'userdata') return undefined
  return join(dirname(userdata), 'speech-models')
}

const info = async (path) => {
  try {
    return await stat(path)
  } catch {
    return undefined
  }
}

/**
 * Newest change of `path` and everything under it. A file growing inside a folder leaves the folder's own times alone,
 * and tar sets each file's mtime from the archive, so the change time (ctime) of every entry is what shows activity.
 */
const lastChange = async (path) => {
  const top = await lstat(path).catch(() => undefined)
  if (!top) return undefined
  let newest = Math.max(top.mtimeMs, top.ctimeMs)
  if (top.isDirectory()) {
    for (const name of await readdir(path, { recursive: true }).catch(() => [])) {
      const entry = await lstat(join(path, name)).catch(() => undefined)
      if (entry) newest = Math.max(newest, entry.mtimeMs, entry.ctimeMs)
    }
  }
  return newest
}

const missingFiles = async (dir, files) => {
  const found = await Promise.all(files.map((file) => info(join(dir, file))))
  return files.filter((_, i) => !found[i])
}

const archiveState = async (root, archive, bytes) => {
  const found = await info(join(root, DOWNLOAD_DIR, archive))
  if (!found?.isFile()) return undefined
  return found.size < bytes ? { state: 'downloading', received: found.size } : { state: 'installing' }
}

/** The same answer Dozin's `MAESTROSDK.speech.status()` gives, from the files alone. */
export const checkSpeechModels = async (root, { models = SPEECH_MODELS, vad = VAD } = {}) => {
  const vadFile = await info(join(root, vad.file))
  const vadReady = Boolean(vadFile?.isFile()) && vadFile.size === vad.bytes
  const vadState = vadReady ? { state: 'ready' } : ((await archiveState(root, vad.file, vad.bytes)) ?? { state: 'missing' })
  const list = []
  for (const model of models) {
    let state
    if (!(await missingFiles(join(root, model.dir), model.files)).length) state = { state: 'ready' }
    else if (await info(join(root, DOWNLOAD_DIR, model.dir))) state = { state: 'installing' }
    else state = (await archiveState(root, model.archive, model.bytes)) ?? { state: 'missing' }
    list.push({ id: model.id, name: model.name, bytes: model.bytes, ...state })
  }
  const selected = vadReady ? (list.find((model) => model.state === 'ready')?.id ?? null) : null
  const pending = [vadState, ...list].some((item) => item.state === 'downloading' || item.state === 'installing')
  return { vad: { bytes: vad.bytes, ...vadState }, models: list, selected, pending }
}

const mb = (bytes) => Math.round(bytes / 1e6)

/** One log line: which model Dozin will use, or that one has to be downloaded, then every file's state. */
export const speechCheckLine = (check) => {
  const states = [
    `vad ${check.vad.state}`,
    ...check.models.map((model) => (model.state === 'downloading' ? `${model.id} downloading ${mb(model.received)}/${mb(model.bytes)} MB` : `${model.id} ${model.state}`))
  ].join(', ')
  const using = check.models.find((model) => model.id === check.selected)
  const head = using ? `Dozin will use ${using.name} (${using.id})` : check.pending ? 'none ready, download in progress' : 'none ready, download needed'
  return `speech model: ${head} — ${states}`
}

const REASONS = {
  unknown_model: `不认识的模型（只能是 ${SPEECH_MODELS.map((model) => model.id).join(' 或 ')}）`,
  unsupported_platform: '语音识别只支持 macOS Apple 芯片',
  home_not_found: '找不到 Dozin 的主目录',
  download_busy: '另一个下载正在进行，稍后再试',
  network: '网络中断',
  size_mismatch: '大小不对',
  checksum_mismatch: '校验不对',
  disk_full: '磁盘空间不够',
  extract_failed: '解压出错',
  extract_incomplete: '解压后缺文件'
}

/** The status line for a failure; `cleaned` when this run had created files and deleted them. */
export const failureText = (code, cleaned) => {
  const http = /^http_(\d+)$/.exec(code)
  const reason = REASONS[code] ?? (http ? `下载出错（HTTP ${http[1]}）` : `出错（${code}）`)
  return `失败：${reason}${cleaned ? '，已删除下载的文件' : ''}`
}

const failure = (code, detail) => Object.assign(new Error(detail ? `${code}: ${detail}` : code), { code })

const NETWORK = /^(ECONN|ETIMEDOUT|EAI_|ENOTFOUND|EPIPE|UND_ERR)/
/** fetch's own failures: "fetch failed" before the body, "terminated" during it; any other TypeError is a bug. */
const fetchFailed = (error) => error?.name === 'TypeError' && (error.cause !== undefined || /^(fetch failed|terminated)$/.test(error.message))
const codeOf = (error) => {
  const code = String(error?.code ?? '')
  if (REASONS[code] || /^http_\d+$/.test(code)) return code
  if (code === 'ENOSPC') return 'disk_full'
  if (fetchFailed(error) || NETWORK.test(code) || NETWORK.test(String(error?.cause?.code ?? ''))) return 'network'
  return code.slice(0, 40) || 'failed'
}

/** Streams `url` into `file`, hashing as it goes; the byte count and the sha256 must both match. */
const download = async ({ url, file, bytes, sha256, signal, fetch, onProgress }) => {
  const response = await fetch(url, { signal })
  if (!response.ok || !response.body) {
    await response.body?.cancel().catch(() => {})
    throw failure(`http_${response.status}`)
  }
  const hash = createHash('sha256')
  let done = 0
  const count = new Transform({
    transform(chunk, _encoding, next) {
      done += chunk.length
      if (done > bytes) return next(failure('size_mismatch'))
      hash.update(chunk)
      onProgress?.(done)
      next(null, chunk)
    }
  })
  await pipeline(Readable.fromWeb(response.body), count, createWriteStream(file), { signal })
  if (done !== bytes) throw failure('size_mismatch')
  if (hash.digest('hex') !== sha256) throw failure('checksum_mismatch')
}

/** `/usr/bin/tar -xjf` into `into`, without the sample recordings; stopping the task kills it. */
export const extractArchive = ({ archive, into, signal }) =>
  new Promise((resolve, reject) => {
    execFile('/usr/bin/tar', ['-xjf', archive, '-C', into, '--exclude', '*/test_wavs'], { signal, maxBuffer: 1024 * 1024 }, (error) => {
      if (!error) return resolve()
      if (error.name === 'AbortError') return reject(error)
      const disk = /No space left on device/i.test(String(error.message))
      reject(failure(disk ? 'disk_full' : 'extract_failed', String(error.message).slice(0, 200)))
    })
  })

const readyText = (model, check) => {
  const using = check.models.find((item) => item.id === check.selected)
  return using && using.id !== model.id ? `已就绪：${model.name}（Dozin 会先用已就绪的 ${using.name}）` : `已就绪：${model.name}`
}

/**
 * The background task (docs/design.md #8.3): `ctx.input.model` is one of SPEECH_MODELS' ids. Downloads the VAD and that
 * model if missing, reports each step with `ctx.status`, and throws on failure after deleting what this run put in
 * `.download/`. A ready model or VAD is never touched. `deps` replace the network and tar in tests.
 */
export const runSpeechModel = async (ctx, deps = {}) => {
  const {
    models = SPEECH_MODELS,
    vad = VAD,
    baseUrl = MODEL_BASE_URL,
    fetch = globalThis.fetch,
    extract = extractArchive,
    platform = process.platform,
    arch = process.arch,
    now = Date.now,
    busyMs = BUSY_MS
  } = deps
  const refuse = (code, detail) => {
    ctx.status(failureText(code, false), 'error')
    ctx.log(`speech-model: refused: ${code}`)
    throw failure(code, detail)
  }
  const model = models.find((item) => item.id === ctx.input?.model)
  if (!model) refuse('unknown_model', String(ctx.input?.model).slice(0, 40))
  if (platform !== 'darwin' || arch !== 'arm64') refuse('unsupported_platform', `${platform}-${arch}`)
  const root = speechModelsRoot(ctx.dataDir ?? process.cwd())
  if (!root) refuse('home_not_found')

  const before = await checkSpeechModels(root, { models, vad })
  const needVad = before.vad.state !== 'ready'
  const needModel = before.models.find((item) => item.id === model.id).state !== 'ready'
  if (!needVad && !needModel) {
    ctx.status(readyText(model, before), 'info')
    ctx.log(`speech-model: ${model.id} already ready`)
    return
  }

  const work = join(root, DOWNLOAD_DIR)
  const vadTemp = join(work, vad.file)
  const archive = join(work, model.archive)
  const extracted = join(work, model.dir)
  const touched = [...(needVad ? [vadTemp] : []), ...(needModel ? [archive, extracted] : [])]
  for (const path of touched) {
    const changed = await lastChange(path)
    if (changed !== undefined && now() - changed < busyMs) refuse('download_busy', basename(path))
  }
  /** What this run has started writing; only these are deleted when it fails or is stopped. */
  const created = []

  ctx.log(`speech-model: downloading ${[needVad ? 'vad' : '', needModel ? model.id : ''].filter(Boolean).join(' and ')}`)
  try {
    await mkdir(work, { recursive: true })
    // Left by a download that was interrupted earlier: Dozin would show it as "downloading" for ever.
    for (const path of touched) await rm(path, { recursive: true, force: true })
    if (needVad) {
      ctx.status('下载断句模型 silero_vad', 'info')
      created.push(vadTemp)
      await download({ url: `${baseUrl}/${vad.file}`, file: vadTemp, bytes: vad.bytes, sha256: vad.sha256, signal: ctx.signal, fetch })
      await rename(vadTemp, join(root, vad.file))
    }
    if (needModel) {
      let shownAt = -Infinity
      const show = (done) => {
        if (done < model.bytes && now() - shownAt < PROGRESS_MS) return
        shownAt = now()
        ctx.status(`下载 ${model.name}：${mb(done)} / ${mb(model.bytes)} MB`, 'info', { done, total: model.bytes })
      }
      show(0)
      created.push(archive)
      await download({ url: `${baseUrl}/${model.archive}`, file: archive, bytes: model.bytes, sha256: model.sha256, signal: ctx.signal, fetch, onProgress: show })
      ctx.status(`解压中：${model.name}`, 'info')
      created.push(extracted)
      await extract({ archive, into: work, signal: ctx.signal })
      const lacking = await missingFiles(extracted, model.files)
      if (lacking.length) throw failure('extract_incomplete', lacking.join(', '))
      const destination = join(root, model.dir)
      // Ready by now (another download finished first): keep it and drop ours. Otherwise what is there is incomplete.
      if (!(await missingFiles(destination, model.files)).length) await rm(extracted, { recursive: true, force: true })
      else {
        await rm(destination, { recursive: true, force: true })
        await rename(extracted, destination)
      }
      await rm(archive, { force: true })
    }
  } catch (error) {
    for (const path of created) await rm(path, { recursive: true, force: true }).catch(() => {})
    if (ctx.signal?.aborted) {
      ctx.status('已停止，已删除下载的文件', 'warn')
      ctx.log('speech-model: stopped')
      return
    }
    const code = codeOf(error)
    ctx.status(failureText(code, true), 'error')
    ctx.log(`speech-model: failed: ${code}`)
    throw failure(code)
  }

  const after = await checkSpeechModels(root, { models, vad })
  ctx.status(readyText(model, after), 'info')
  ctx.log(`speech-model: ${model.id} ready; ${speechCheckLine(after)}`)
}

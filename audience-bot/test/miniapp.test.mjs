// Contract: docs/design.md #4 — the persona page on a fake MAESTROSDK: load, save with the stamp it read, a change made
// elsewhere is loaded or offered as a choice, nothing is overwritten silently, and an older Dozin without the SDK.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { parseHTML } from 'linkedom'
import { mount, EXAMPLE, CONNECTOR_DIR, TAKEOVER, STEPS_KEY } from '../miniapp/app.js'

const html = readFileSync(new URL('../miniapp/index.html', import.meta.url), 'utf8')
const settle = async () => { for (let i = 0; i < 10; i++) await new Promise((done) => setImmediate(done)) }

const page = () => {
  const { window, document } = parseHTML(html)
  const el = (name) => document.querySelector(`[name="${name}"]`)
  const fire = (name, type) => el(name).dispatchEvent(new window.Event(type))
  const type = (value) => { el('audience-bot__persona-text').value = value; fire('audience-bot__persona-text', 'input') }
  return { document, el, fire, type, click: (name) => fire(name, 'click') }
}

/** A connectors directory holding one Agent.md; writes are refused when the stamp is not the current one. */
const fakeSdk = (content = '旧人格') => {
  const file = { content, stamp: 'v0', exists: true }
  const writes = []
  let listener
  let hook
  return {
    file,
    writes,
    change: (dir = CONNECTOR_DIR) => listener?.({ dir, stamp: file.stamp }),
    edit: (text) => { file.content = text; file.stamp = `ext${Math.random()}` },
    hook: () => hook,
    beforeRefresh: (fn) => { hook = fn; return () => {} },
    confirm: async () => false,
    connectors: {
      async readAgentMd(dir) {
        return { path: `/home/u/.dozin/connectors/${dir}/Agent.md`, exists: file.exists, content: file.content, bytes: file.content.length, limit: 16384, stamp: file.stamp }
      },
      async writeAgentMd(dir, value, { stamp }) {
        writes.push({ dir, value, stamp })
        if (stamp !== file.stamp) return { ok: false, reason: 'changed', stamp: file.stamp }
        file.content = value
        file.stamp = `w${writes.length}`
        return { ok: true, stamp: file.stamp }
      },
      onAgentMdChange(fn) { listener = fn; return () => { listener = undefined } }
    }
  }
}

test('without MAESTROSDK.connectors the page says so and cannot be edited', async () => {
  const p = page()
  const view = mount(p.document, undefined, { clipboard: { writeText: async () => {} } })
  await view.ready
  assert.equal(p.el('audience-bot__persona-text').disabled, true)
  assert.equal(p.el('audience-bot__save').disabled, true)
  assert.equal(p.el('audience-bot__notice').hidden, false)
  assert.match(p.el('audience-bot__notice-text').textContent, /MAESTROSDK\.connectors/)
})

test('loads the file, saves with the stamp it read, and ignores the change its own save causes', async () => {
  const p = page()
  const sdk = fakeSdk()
  const view = mount(p.document, sdk, { clipboard: { writeText: async () => {} } })
  await view.ready
  assert.equal(p.el('audience-bot__persona-text').value, '旧人格')
  assert.equal(p.el('audience-bot__persona-path').textContent, '/home/u/.dozin/connectors/audience-bot/Agent.md')
  assert.equal(p.el('audience-bot__persona-state').textContent, '已保存')
  assert.equal(p.el('audience-bot__save').disabled, true)

  p.type('新人格')
  assert.equal(p.el('audience-bot__persona-state').textContent, '未保存')
  assert.equal(p.el('audience-bot__save').disabled, false)
  p.click('audience-bot__save')
  await settle()
  assert.deepEqual(sdk.writes, [{ dir: 'audience-bot', value: '新人格', stamp: 'v0' }])
  assert.equal(sdk.file.content, '新人格')
  assert.equal(p.el('audience-bot__persona-state').textContent, '已保存')

  sdk.change()
  await settle()
  assert.equal(p.el('audience-bot__notice').hidden, true, 'our own write is not reported as a change')
})

test('a change made elsewhere is loaded when nothing is unsaved here', async () => {
  const p = page()
  const sdk = fakeSdk()
  const view = mount(p.document, sdk, { clipboard: { writeText: async () => {} } })
  await view.ready
  sdk.edit('AI 改过的人格')
  sdk.change()
  await settle()
  assert.equal(p.el('audience-bot__persona-text').value, 'AI 改过的人格')
  assert.equal(p.el('audience-bot__notice').hidden, false)
  assert.match(p.el('audience-bot__notice-text').textContent, /已载入/)
  assert.equal(p.el('audience-bot__use-mine').hidden, true)
})

test('a change made elsewhere while editing is a choice: "use mine" overwrites knowingly, "use theirs" loads it', async () => {
  const p = page()
  const sdk = fakeSdk()
  const view = mount(p.document, sdk, { clipboard: { writeText: async () => {} } })
  await view.ready
  p.type('我正在写的')
  sdk.edit('AI 改过的人格')
  sdk.change()
  await settle()
  assert.equal(p.el('audience-bot__persona-text').value, '我正在写的', 'the editor is left as it is')
  assert.equal(p.el('audience-bot__use-mine').hidden, false)
  assert.equal(p.el('audience-bot__use-theirs').hidden, false)
  p.click('audience-bot__use-mine')
  await settle()
  assert.equal(sdk.file.content, '我正在写的')
  assert.equal(p.el('audience-bot__notice').hidden, true)

  p.type('又改了一次')
  sdk.edit('AI 又改了')
  sdk.change()
  await settle()
  p.click('audience-bot__use-theirs')
  await settle()
  assert.equal(p.el('audience-bot__persona-text').value, 'AI 又改了')
  assert.equal(p.el('audience-bot__persona-state').textContent, '已保存')
})

test('a save refused as changed shows the choice and writes nothing', async () => {
  const p = page()
  const sdk = fakeSdk()
  const view = mount(p.document, sdk, { clipboard: { writeText: async () => {} } })
  await view.ready
  sdk.edit('别处刚写的') // no change event yet: the page still holds stamp v0
  p.type('我的')
  p.click('audience-bot__save')
  await settle()
  assert.equal(sdk.file.content, '别处刚写的')
  assert.equal(p.el('audience-bot__use-mine').hidden, false)
  assert.equal(p.el('audience-bot__persona-state').textContent, '未保存')
})

test('over 16 KB is flagged but can still be saved; copies carry the file path; refresh asks only with unsaved edits', async () => {
  const p = page()
  const sdk = fakeSdk('')
  const copied = []
  const view = mount(p.document, sdk, { clipboard: { writeText: async (text) => { copied.push(text) } } })
  await view.ready
  assert.equal(await sdk.hook()(), true, 'nothing unsaved: refresh goes ahead')
  p.type('字'.repeat(6000))
  assert.equal(p.el('audience-bot__persona-warning').hidden, false)
  assert.match(p.el('audience-bot__persona-warning').textContent, /不会进对话/)
  assert.equal(p.el('audience-bot__save').disabled, false)
  assert.equal(await sdk.hook()(), false, 'unsaved edits: the native confirm decides (declined here)')

  p.click('audience-bot__copy-path')
  p.click('audience-bot__copy-example')
  await settle()
  assert.deepEqual(copied, [
    '/home/u/.dozin/connectors/audience-bot/Agent.md',
    `${EXAMPLE}（人格文件：/home/u/.dozin/connectors/audience-bot/Agent.md）`
  ])
})

test('the three steps: the takeover sentence is shown and copied; folding is remembered in the page storage', async () => {
  const data = new Map()
  const storage = { getItem: (key) => (data.has(key) ? data.get(key) : null), setItem: (key, value) => data.set(key, String(value)) }
  const copied = []
  const p = page()
  await mount(p.document, fakeSdk(), { clipboard: { writeText: async (text) => { copied.push(text) } }, storage }).ready
  assert.equal(p.el('audience-bot__takeover-text').textContent, TAKEOVER)
  p.click('audience-bot__copy-takeover')
  await settle()
  assert.deepEqual(copied, [TAKEOVER])
  assert.equal(p.el('audience-bot__steps-list').hidden, false)
  p.click('audience-bot__steps-toggle')
  assert.equal(p.el('audience-bot__steps-list').hidden, true)
  assert.equal(p.el('audience-bot__steps-toggle').textContent, '展开')
  assert.equal(data.get(STEPS_KEY), '1')

  const again = page()
  await mount(again.document, fakeSdk(), { clipboard: { writeText: async () => {} }, storage }).ready
  assert.equal(again.el('audience-bot__steps-list').hidden, true, 'folded across a reload')
  again.click('audience-bot__steps-toggle')
  assert.equal(again.el('audience-bot__steps-list').hidden, false)
  assert.equal(data.get(STEPS_KEY), '0')
})

test('the install guide opens the mini app and never connects it to the Gateway', () => {
  const guide = readFileSync(new URL('../miniapp/INSTALL.md', import.meta.url), 'utf8')
  const manifest = JSON.parse(readFileSync(new URL('../miniapp/miniapp.json', import.meta.url), 'utf8'))
  assert.match(guide, new RegExp(`open_miniapp[^\\n]*miniapp:${manifest.appId.replace(/\./g, '\\.')}`))
  assert.doesNotMatch(guide, /gateway_attach|gateway_register/)
  assert.match(guide, /不要替用户批准/)
})

// docs/design.md #8.2: the "主播语音" card on a fake MAESTROSDK.speech.
const { mountSpeech, speechView, DOWNLOAD_SENTENCE } = await import('../miniapp/speech.js')
const QWEN = { id: 'qwen3-asr-0.6b', name: 'Qwen3-ASR 0.6B', bytes: 878702423 }
const SENSE = { id: 'sensevoice-small', name: 'SenseVoice Small', bytes: 163002883 }
const VAD_READY = { bytes: 643854, state: 'ready' }
const speechStatus = (models, extra = {}) => ({ supported: true, root: '/h/speech-models', vad: VAD_READY, models, selected: null, active: null, ...extra })

test('speech card: downloading shows percent and MB; nothing ready and nothing downloading offers the download sentence', () => {
  const downloading = speechView(speechStatus([{ ...QWEN, state: 'downloading', received: 439351212 }, { ...SENSE, state: 'missing' }]))
  assert.deepEqual(downloading.rows.map((row) => row.text), ['下载中 50%（439 / 879 MB）', '未下载（163 MB）'])
  assert.equal(downloading.rows[0].percent, 50)
  assert.equal(downloading.download, false, 'no sentence while a download is on its way')
  const missing = speechView(speechStatus([{ ...QWEN, state: 'missing' }, { ...SENSE, state: 'missing' }], { vad: { bytes: 643854, state: 'missing' } }))
  assert.equal(missing.download, true)
  assert.deepEqual(missing.rows.map((row) => row.name), ['Qwen3-ASR 0.6B', 'SenseVoice Small', '断句模型'], 'the sentence-cutting model shows while it is not ready')
  assert.equal(speechView(speechStatus([{ ...QWEN, state: 'installing' }, { ...SENSE, state: 'missing' }])).rows[0].text, '解压中')
})

test('speech card: the model in use and the one that will be used', () => {
  const running = speechView(speechStatus([{ ...QWEN, state: 'ready' }, { ...SENSE, state: 'ready' }], { selected: QWEN.id, active: { modelId: QWEN.id, modelName: QWEN.name, state: 'running', streams: 1 } }))
  assert.equal(running.active, '使用中：Qwen3-ASR 0.6B · 1 个直播间')
  assert.deepEqual(running.rows.map((row) => row.selected), [true, false])
  assert.equal(speechView(speechStatus([{ ...QWEN, state: 'ready' }], { selected: QWEN.id })).active, '将使用：Qwen3-ASR 0.6B')
  assert.equal(speechView(speechStatus([{ ...QWEN, state: 'ready' }], { selected: QWEN.id, active: { modelId: QWEN.id, modelName: QWEN.name, state: 'loading', streams: 1 } })).active, '加载中：Qwen3-ASR 0.6B')
  assert.match(speechView(speechStatus([], { supported: false })).note, /macOS Apple 芯片/)
  assert.match(speechView(null, { available: false }).note, /MAESTROSDK\.speech/)
})

test('speech card: renders the status, follows changes, copies the download sentence; an older Dozin only shows a note', async () => {
  const p = page()
  let listener
  const copied = []
  const sdk = { speech: {
    status: async () => speechStatus([{ ...QWEN, state: 'missing' }, { ...SENSE, state: 'missing' }]),
    onStatusChange: (fn) => { listener = fn; return () => {} }
  } }
  const card = mountSpeech(p.document, sdk, { clipboard: { writeText: async (text) => copied.push(text) } })
  await card.ready
  assert.equal(p.el('audience-bot__speech-download').hidden, false)
  assert.equal(p.el('audience-bot__speech-download-text').textContent, DOWNLOAD_SENTENCE)
  p.click('audience-bot__copy-download')
  await settle()
  assert.deepEqual(copied, [DOWNLOAD_SENTENCE])
  listener(speechStatus([{ ...QWEN, state: 'downloading', received: 87870243 }, { ...SENSE, state: 'missing' }]))
  const rows = [...p.document.querySelectorAll('[name="audience-bot__speech-model"]')]
  assert.equal(rows[0].dataset.model, QWEN.id)
  assert.ok(rows[0].textContent.includes('下载中 10%'))
  assert.ok(rows[0].querySelector('.speech-card__progress-fill').style.width === '10%')
  assert.equal(p.el('audience-bot__speech-download').hidden, true)
  listener(speechStatus([{ ...QWEN, state: 'ready' }, { ...SENSE, state: 'missing' }], { selected: QWEN.id, active: { modelId: QWEN.id, modelName: QWEN.name, state: 'running', streams: 1 } }))
  assert.equal(p.el('audience-bot__speech-active').textContent, '使用中：Qwen3-ASR 0.6B · 1 个直播间')
  assert.ok(p.document.querySelector('[data-model="qwen3-asr-0.6b"]').textContent.startsWith('Qwen3-ASR 0.6B（默认）已就绪'))

  const old = page()
  await mountSpeech(old.document, { connectors: {} }).ready
  assert.equal(old.el('audience-bot__speech-note').hidden, false)
  assert.equal(old.document.querySelectorAll('[name="audience-bot__speech-model"]').length, 0)
})

// speech-model-002: no usable model → pick one of two (Qwen3 by default) and the extension's background task downloads it.
const { startErrorText, EXTENSION_NAME, SPEECH_SERVICE } = await import('../miniapp/speech.js')
const NO_MODEL = () => speechStatus([{ ...QWEN, state: 'missing' }, { ...SENSE, state: 'missing' }], { vad: { bytes: 643854, state: 'missing' } })
const extensionWith = (service, extra = {}) => ({
  ok: true,
  extension: { name: 'audience-bot', version: '0.2.0', state: 'running', approval: 'approved', switchedOn: true, services: service ? [{ id: 'speech-model', name: '下载语音模型', start: 'manual', state: 'stopped', ...service }] : [], ...extra }
})

/** MAESTROSDK with speech and extensions; `ext` is what extensions.get answers now, `startResult` what startService answers. */
const speechHost = ({ status = NO_MODEL(), ext = extensionWith({}), startResult = { ok: true }, startService = true } = {}) => {
  const host = { status, ext, startResult, starts: [], gets: 0, listener: undefined }
  host.sdk = {
    speech: { status: async () => host.status, onStatusChange: (fn) => { host.listener = fn; return () => {} } },
    extensions: {
      get: async (name) => { host.gets++; return name === 'audience-bot' ? host.ext : { ok: false, error: 'not_owned' } },
      ...(startService ? { startService: async (name, service, input) => { host.starts.push({ name, service, input }); return host.startResult } } : {})
    }
  }
  return host
}
const radioState = (p) => [...p.document.querySelectorAll('[name="audience-bot__speech-choice"]')].map((radio) => `${radio.value}:${radio.checked ? 'on' : 'off'}${radio.disabled ? ':disabled' : ''}`)

test('picker: no usable model shows two choices with Qwen3 picked; the button starts the task with the picked id', async () => {
  const p = page()
  const host = speechHost()
  const card = mountSpeech(p.document, host.sdk, { pollMs: 0 })
  await card.ready
  assert.equal(p.el('audience-bot__speech-picker').hidden, false)
  assert.deepEqual(radioState(p), ['qwen3-asr-0.6b:on', 'sensevoice-small:off'])
  assert.equal(p.el('audience-bot__speech-start').disabled, false)
  assert.equal(p.el('audience-bot__speech-start').textContent, '下载并初始化')
  assert.equal(p.el('audience-bot__speech-download').hidden, true, 'the button works: no fallback sentence')
  assert.equal(p.el('audience-bot__speech-picker-reason').hidden, true)

  p.click('audience-bot__speech-start')
  await settle()
  assert.deepEqual(host.starts, [{ name: EXTENSION_NAME, service: SPEECH_SERVICE, input: { model: 'qwen3-asr-0.6b' } }])

  // The person picks SenseVoice instead, on a fresh page.
  const q = page()
  const other = speechHost()
  await mountSpeech(q.document, other.sdk, { pollMs: 0 }).ready
  const sense = q.document.querySelector('[name="audience-bot__speech-choice"][value="sensevoice-small"]')
  sense.checked = true
  sense.dispatchEvent(new (parseHTML('<p></p>').window.Event)('change'))
  assert.deepEqual(radioState(q), ['qwen3-asr-0.6b:off', 'sensevoice-small:on'])
  q.click('audience-bot__speech-start')
  await settle()
  assert.deepEqual(other.starts.map((start) => start.input), [{ model: 'sensevoice-small' }])
})

test('picker: while downloading the button cannot be pressed and the progress shows; when it ends the picker goes away', async () => {
  const p = page()
  const host = speechHost()
  const card = mountSpeech(p.document, host.sdk, { pollMs: 0 })
  await card.ready
  host.ext = extensionWith({ state: 'running', lastStatus: { text: '下载 Qwen3-ASR 0.6B：312 / 879 MB', level: 'info', at: 1, progress: { done: 312e6, total: 878702423 } } })
  host.listener(speechStatus([{ ...QWEN, state: 'downloading', received: 312e6 }, { ...SENSE, state: 'missing' }]))
  await settle()
  assert.equal(p.el('audience-bot__speech-start').disabled, true)
  assert.equal(p.el('audience-bot__speech-start').textContent, '下载中…')
  assert.deepEqual(radioState(p), ['qwen3-asr-0.6b:on:disabled', 'sensevoice-small:off:disabled'])
  assert.equal(p.el('audience-bot__speech-picker-status').textContent, '下载 Qwen3-ASR 0.6B：312 / 879 MB')
  assert.ok(p.document.querySelector('[data-model="qwen3-asr-0.6b"]').textContent.includes('下载中 35%'))
  p.click('audience-bot__speech-start')
  await settle()
  assert.equal(host.starts.length, 0, 'no second download')

  // Unpacking: no download file growing, the task still runs.
  host.ext = extensionWith({ state: 'running', lastStatus: { text: '解压中：Qwen3-ASR 0.6B', level: 'info', at: 2 } })
  host.listener(speechStatus([{ ...QWEN, state: 'installing' }, { ...SENSE, state: 'missing' }]))
  await settle()
  assert.equal(p.el('audience-bot__speech-start').disabled, true)
  assert.equal(p.el('audience-bot__speech-picker-status').textContent, '解压中：Qwen3-ASR 0.6B')

  // Ready: Dozin selects it and the picker is gone.
  host.ext = extensionWith({ state: 'stopped', lastStatus: { text: '已就绪：Qwen3-ASR 0.6B', level: 'info', at: 3 } })
  host.listener(speechStatus([{ ...QWEN, state: 'ready' }, { ...SENSE, state: 'missing' }], { selected: QWEN.id }))
  await settle()
  assert.equal(p.el('audience-bot__speech-picker').hidden, true)
  assert.equal(p.el('audience-bot__speech-active').textContent, '将使用：Qwen3-ASR 0.6B')
  assert.equal(p.el('audience-bot__speech-download').hidden, true)
})

test('picker: a failed run shows its reason and the button works again; a refused start says why', async () => {
  const p = page()
  const host = speechHost({ ext: extensionWith({ state: 'failed', lastStatus: { text: '失败：校验不对，已删除下载的文件', level: 'error', at: 1 } }) })
  await mountSpeech(p.document, host.sdk, { pollMs: 0 }).ready
  assert.equal(p.el('audience-bot__speech-picker-status').textContent, '失败：校验不对，已删除下载的文件')
  assert.ok(p.el('audience-bot__speech-picker-status').className.includes('speech-card__picker-status--error'))
  assert.equal(p.el('audience-bot__speech-start').disabled, false)

  const q = page()
  const refused = speechHost({ startResult: { ok: false, error: 'failed', code: 'extension_not_running' } })
  await mountSpeech(q.document, refused.sdk, { pollMs: 0 }).ready
  q.click('audience-bot__speech-start')
  await settle()
  assert.equal(refused.starts.length, 1)
  assert.match(q.el('audience-bot__speech-picker-status').textContent, /没能开始下载：扩展 audience-bot 还没在 设置 › Extensions 批准并打开/)
  assert.equal(q.el('audience-bot__speech-start').disabled, false, 'can try again')

  assert.match(startErrorText({ ok: false, error: 'not_found' }), /版本较旧/)
  assert.match(startErrorText({ ok: false, error: 'host_unavailable' }), /Dozin 没有响应/)
  assert.match(startErrorText({ ok: false, error: 'failed', code: 'missing_config' }), /missing_config/)
})

test('picker: an already running task is not a failure; a model already present is picked by default', async () => {
  const p = page()
  const host = speechHost({ startResult: { ok: false, error: 'failed', code: 'already_running' } })
  await mountSpeech(p.document, host.sdk, { pollMs: 0 }).ready
  host.ext = extensionWith({ state: 'running', lastStatus: { text: '下载断句模型 silero_vad', level: 'info', at: 1 } })
  p.click('audience-bot__speech-start')
  await settle()
  assert.equal(p.el('audience-bot__speech-picker-status').textContent, '下载断句模型 silero_vad')
  assert.equal(p.el('audience-bot__speech-start').disabled, true)

  // SenseVoice is downloaded, only the sentence-cutting model is missing: no reason to fetch 880 MB.
  const q = page()
  const vadOnly = speechHost({ status: speechStatus([{ ...QWEN, state: 'missing' }, { ...SENSE, state: 'ready' }], { vad: { bytes: 643854, state: 'missing' } }) })
  await mountSpeech(q.document, vadOnly.sdk, { pollMs: 0 }).ready
  assert.deepEqual(radioState(q), ['qwen3-asr-0.6b:off', 'sensevoice-small:on'])
})

test('picker: with a usable model, on an unsupported computer or without MAESTROSDK.speech there is no picker', async () => {
  const p = page()
  const host = speechHost({ status: speechStatus([{ ...QWEN, state: 'ready' }, { ...SENSE, state: 'missing' }], { selected: QWEN.id }) })
  await mountSpeech(p.document, host.sdk, { pollMs: 0 }).ready
  assert.equal(p.el('audience-bot__speech-picker').hidden, true)
  assert.equal(p.el('audience-bot__speech-download').hidden, true)
  assert.equal(speechView(speechStatus([], { supported: false }), { control: { startable: true } }).picker.show, false)
  assert.equal(speechView(null, { available: false }).picker.show, false)
})

test('picker: without startService, an extension not approved, missing or too old, the button is off, says why and keeps the sentence', async () => {
  const cases = [
    [{ startService: false }, /需要支持 MAESTROSDK\.extensions/],
    [{ ext: extensionWith({}, { approval: 'pending', state: 'pending', switchedOn: false }) }, /扩展 audience-bot 还没在 设置 › Extensions 批准并打开/],
    [{ ext: extensionWith({}, { switchedOn: false, state: 'disabled' }) }, /批准并打开/],
    [{ ext: extensionWith({}, { state: 'backoff' }) }, /没在运行（backoff）/],
    [{ ext: { ok: true, extension: null } }, /没装/],
    [{ ext: { ok: false, error: 'not_owned' } }, /读不到扩展 audience-bot/],
    [{ ext: extensionWith(null) }, /版本较旧/]
  ]
  for (const [setup, reason] of cases) {
    const p = page()
    const host = speechHost(setup)
    await mountSpeech(p.document, host.sdk, { pollMs: 0 }).ready
    assert.equal(p.el('audience-bot__speech-picker').hidden, false, String(reason))
    assert.equal(p.el('audience-bot__speech-start').disabled, true, String(reason))
    assert.match(p.el('audience-bot__speech-picker-reason').textContent, reason)
    assert.equal(p.el('audience-bot__speech-download').hidden, false, 'the copyable sentence is the fallback')
    assert.equal(p.el('audience-bot__speech-download-text').textContent, DOWNLOAD_SENTENCE)
    p.click('audience-bot__speech-start')
    await settle()
    assert.equal(host.starts.length, 0)
  }
})

test('picker: the task status is read again on every speech change and, while the picker shows, on a timer that stops afterwards', async () => {
  const p = page()
  const host = speechHost()
  const card = mountSpeech(p.document, host.sdk, { pollMs: 5 })
  await card.ready
  const first = host.gets
  await new Promise((done) => setTimeout(done, 40))
  assert.ok(host.gets > first, 'polled while the picker shows')
  host.listener(speechStatus([{ ...QWEN, state: 'ready' }, { ...SENSE, state: 'missing' }], { selected: QWEN.id }))
  await settle()
  const settled = host.gets
  await new Promise((done) => setTimeout(done, 40))
  assert.equal(host.gets, settled, 'no polling once a model is usable')
  card.stop()
})

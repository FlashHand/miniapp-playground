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

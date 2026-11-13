// "主播语音" card of the persona page (docs/design.md #8.2, #8.3): which speech models are downloaded, downloading or
// missing, and which one Dozin is using, from MAESTROSDK.speech (Dozin docs/features/speech-recognition.md #4.2). With no
// usable model, the person picks one of two and the extension's background task downloads it (speech-model-002).

/** What the person says to the AI to get the model downloaded (the douyin-live-reply skill does it); the fallback. */
export const DOWNLOAD_SENTENCE = '下载 Audience BOT 的语音模型'
/** The extension that brings the background task, and the task's id (docs/design.md #8.3). */
export const EXTENSION_NAME = 'audience-bot'
export const SPEECH_SERVICE = 'speech-model'
/**
 * The two models the person picks from, the default first (Ral 2026-11-14「提供两个模型供人工选择，并设置一个默认选项」).
 * Their sizes and notes are written in index.html.
 */
export const SPEECH_CHOICES = ['qwen3-asr-0.6b', 'sensevoice-small']
export const DEFAULT_CHOICE = SPEECH_CHOICES[0]

const EXTENSION_OFF = `扩展 ${EXTENSION_NAME} 还没在 设置 › Extensions 批准并打开。`
const REASONS = {
  noHost: '这个 Dozin 版本还不能在这里下载语音模型：需要支持 MAESTROSDK.extensions 的版本。',
  unreadable: `读不到扩展 ${EXTENSION_NAME} 的状态，请稍后再打开这一页。`,
  missing: `扩展 ${EXTENSION_NAME} 没装：重新安装 Audience BOT 小程序。`,
  off: EXTENSION_OFF,
  notRunning: (state) => `扩展 ${EXTENSION_NAME} 没在运行（${state}）：到 设置 › Extensions 查看。`,
  old: `扩展 ${EXTENSION_NAME} 版本较旧，没有「下载语音模型」：更新 Audience BOT 后重新批准扩展。`
}
/** The service states in which a download is under way or about to be retried: the button must not start another. */
const SERVICE_BUSY = new Set(['starting', 'running', 'stopping', 'backoff'])

const mb = (bytes) => Math.round(bytes / 1e6)

const stateText = (item) => {
  if (item.state === 'ready') return '已就绪'
  if (item.state === 'installing') return '解压中'
  if (item.state === 'downloading') return `下载中 ${Math.min(99, Math.floor(((item.received ?? 0) / item.bytes) * 100))}%（${mb(item.received ?? 0)} / ${mb(item.bytes)} MB）`
  return `未下载（${mb(item.bytes)} MB）`
}

const activeText = (status) => {
  const active = status.active
  if (active?.state === 'running') return `使用中：${active.modelName} · ${active.streams} 个直播间`
  if (active?.state === 'loading') return `加载中：${active.modelName}`
  if (active?.state === 'idle') return `空闲：${active.modelName}`
  const selected = status.models.find((model) => model.id === status.selected)
  return selected ? `将使用：${selected.name}` : ''
}

/** Why `startService` refused, in words. */
export const startErrorText = (result) => {
  const code = result?.code
  if (code === 'extension_not_running') return `没能开始下载：${EXTENSION_OFF}`
  if (code === 'bad_input') return '没能开始下载：扩展不认这个模型，请更新 Audience BOT 后再试。'
  if (result?.error === 'not_found') return `没能开始下载：${REASONS.old}`
  if (result?.error === 'not_owned') return `没能开始下载：这个小程序管不了扩展 ${EXTENSION_NAME}。`
  if (result?.error === 'host_unavailable') return '没能开始下载：Dozin 没有响应，请稍后再试。'
  return `没能开始下载：${code || result?.error || 'unknown'}`
}

const HIDDEN_PICKER = { show: false, choices: [], button: { enabled: false, text: '下载并初始化' }, statusText: '', statusLevel: 'info', reason: '', fallback: false }

/**
 * The picker (speech-model-002), pure. `control`: `startable` (the host has extensions.startService), `ext` (the last
 * extensions.get result; undefined until read), `starting` (a click waits for its answer), `error` (why the last start was
 * refused), `choice` (the radio the person picked). Shown only while this computer can recognise speech and no model is
 * usable; `fallback` asks for the copyable sentence when the button cannot be used.
 */
export const pickerView = (status, control = {}) => {
  if (!status?.supported || status.selected) return HIDDEN_PICKER
  const { startable = false, ext, starting = false, error = '', choice } = control
  const extension = ext?.ok ? ext.extension : undefined
  const service = extension?.services?.find((item) => item.id === SPEECH_SERVICE)
  const pending = [status.vad, ...status.models].some((item) => item.state === 'downloading' || item.state === 'installing')
  const busy = pending || starting || SERVICE_BUSY.has(service?.state)
  let reason = ''
  if (!startable) reason = REASONS.noHost
  else if (ext && !ext.ok) reason = REASONS.unreadable
  else if (ext && !extension) reason = REASONS.missing
  else if (extension && (extension.approval !== 'approved' || !extension.switchedOn)) reason = REASONS.off
  else if (extension && extension.state !== 'running') reason = REASONS.notRunning(extension.state)
  else if (extension && !service) reason = REASONS.old
  const usable = startable && Boolean(service) && !reason
  const offered = SPEECH_CHOICES.flatMap((id) => {
    const model = status.models.find((item) => item.id === id)
    return model ? [{ id, name: model.name, ready: model.state === 'ready' }] : []
  })
  // A model already downloaded (only the sentence-cutting model missing) is the cheapest pick; else the default.
  const picked = offered.find((item) => item.id === choice)?.id ?? offered.find((item) => item.ready)?.id ?? offered.find((item) => item.id === DEFAULT_CHOICE)?.id ?? offered[0]?.id
  const last = service?.lastStatus
  let statusText = ''
  let statusLevel = 'info'
  // A download under way speaks for itself; then why the last click was refused; then how the last run ended badly.
  if (last && SERVICE_BUSY.has(service.state)) [statusText, statusLevel] = [last.text, last.level]
  else if (error) [statusText, statusLevel] = [error, 'error']
  else if (last && last.level !== 'info') [statusText, statusLevel] = [last.text, last.level]
  return {
    show: true,
    choices: offered.map((item) => ({ id: item.id, name: item.name, checked: item.id === picked, disabled: busy })),
    button: { enabled: usable && !busy && Boolean(picked), text: busy ? '下载中…' : '下载并初始化' },
    statusText,
    statusLevel,
    reason: busy ? '' : reason,
    fallback: Boolean(reason) && !busy
  }
}

/**
 * Pure view of a status. `available`: the page has MAESTROSDK.speech at all. Returns the note, the active line, one row
 * per model (and the sentence-cutting model while it is not ready), the picker, and whether to offer the download sentence.
 */
export const speechView = (status, { available = true, control } = {}) => {
  if (!available) return { note: '这个 Dozin 版本还不能显示主播语音：需要支持 MAESTROSDK.speech 的版本。', active: '', rows: [], picker: HIDDEN_PICKER, download: false }
  if (!status) return { note: '读不到主播语音的状态，请稍后再打开这一页。', active: '', rows: [], picker: HIDDEN_PICKER, download: false }
  if (!status.supported) return { note: '这台电脑不能识别主播语音（只支持 macOS Apple 芯片）。', active: '', rows: [], picker: HIDDEN_PICKER, download: false }
  const rows = status.models.map((model) => ({
    id: model.id,
    name: model.name,
    text: stateText(model),
    state: model.state,
    percent: model.state === 'downloading' ? Math.floor(((model.received ?? 0) / model.bytes) * 100) : model.state === 'missing' ? 0 : 100,
    selected: model.id === status.selected
  }))
  if (status.vad.state !== 'ready') rows.push({ id: 'vad', name: '断句模型', text: stateText(status.vad), state: status.vad.state, percent: status.vad.state === 'downloading' ? Math.floor(((status.vad.received ?? 0) / status.vad.bytes) * 100) : 0, selected: false })
  const picker = pickerView(status, control)
  return { note: '', active: activeText(status), rows, picker, download: picker.fallback }
}

/**
 * Wires the card. `sdk` is window.MAESTROSDK. The background task has no change event, so while the picker shows,
 * extensions.get is read every `pollMs` (0: never, for tests) and on every speech status change. Returns
 * `{ ready, render, refresh, stop }` for tests.
 */
export function mountSpeech(doc, sdk, { clipboard, pollMs = 2000 } = {}) {
  const el = (name) => doc.querySelector(`[name="${name}"]`)
  const note = el('audience-bot__speech-note')
  const active = el('audience-bot__speech-active')
  const list = el('audience-bot__speech-models')
  const download = el('audience-bot__speech-download')
  const copyButton = el('audience-bot__copy-download')
  const picker = el('audience-bot__speech-picker')
  const radios = [...doc.querySelectorAll('[name="audience-bot__speech-choice"]')]
  const startButton = el('audience-bot__speech-start')
  const pickerStatus = el('audience-bot__speech-picker-status')
  const pickerReason = el('audience-bot__speech-picker-reason')
  el('audience-bot__speech-download-text').textContent = DOWNLOAD_SENTENCE
  const speech = sdk?.speech
  const extensions = sdk?.extensions
  const state = { status: null, ext: undefined, starting: false, error: '', choice: undefined }
  let timer
  let view

  const refresh = async () => {
    if (typeof extensions?.get !== 'function') return
    try {
      state.ext = await extensions.get(EXTENSION_NAME)
    } catch {
      state.ext = { ok: false, error: 'host_unavailable' }
    }
    render()
  }

  const poll = (on) => {
    if (on && !timer && pollMs > 0 && typeof extensions?.get === 'function') timer = setInterval(() => void refresh(), pollMs)
    if (!on && timer) {
      clearInterval(timer)
      timer = undefined
    }
  }

  const render = (status = state.status) => {
    state.status = status
    view = speechView(status, {
      available: Boolean(speech),
      control: { startable: typeof extensions?.startService === 'function', ext: state.ext, starting: state.starting, error: state.error, choice: state.choice }
    })
    note.hidden = !view.note
    note.textContent = view.note
    active.textContent = view.active
    download.hidden = !view.download
    list.replaceChildren(...view.rows.map((row) => {
      const item = doc.createElement('li')
      item.className = `speech-card__model speech-card__model--${row.state}${row.selected ? ' speech-card__model--selected' : ''}`
      item.setAttribute('name', 'audience-bot__speech-model')
      item.dataset.model = row.id
      const name = doc.createElement('span')
      name.className = 'speech-card__model-name'
      name.textContent = row.selected ? `${row.name}（默认）` : row.name
      const text = doc.createElement('span')
      text.className = 'speech-card__model-state'
      text.textContent = row.text
      const bar = doc.createElement('span')
      bar.className = 'speech-card__progress'
      const fill = doc.createElement('span')
      fill.className = 'speech-card__progress-fill'
      fill.style.width = `${row.percent}%`
      bar.append(fill)
      item.append(name, text, bar)
      return item
    }))
    const p = view.picker
    picker.hidden = !p.show
    for (const radio of radios) {
      const choice = p.choices.find((item) => item.id === radio.value)
      radio.closest('label').hidden = !choice
      radio.checked = Boolean(choice?.checked)
      radio.disabled = !choice || choice.disabled
    }
    startButton.disabled = !p.button.enabled
    startButton.textContent = p.button.text
    pickerStatus.hidden = !p.statusText
    pickerStatus.textContent = p.statusText
    pickerStatus.className = `speech-card__picker-status${p.statusLevel === 'info' ? '' : ` speech-card__picker-status--${p.statusLevel}`}`
    pickerReason.hidden = !p.reason
    pickerReason.textContent = p.reason
    poll(p.show)
  }

  const start = async () => {
    const chosen = view?.picker.choices.find((item) => item.checked)?.id
    if (!chosen || !view.picker.button.enabled) return
    state.starting = true
    state.error = ''
    render()
    let result
    try {
      result = await extensions.startService(EXTENSION_NAME, SPEECH_SERVICE, { model: chosen })
    } catch {
      result = { ok: false, error: 'host_unavailable' }
    }
    // Already running is not a failure: the download under way is the one this click wanted.
    if (!result?.ok && result?.code !== 'already_running') state.error = startErrorText(result)
    await refresh()
    state.starting = false
    render()
  }

  for (const radio of radios) {
    radio.addEventListener('change', () => {
      if (!radio.checked) return
      state.choice = radio.value
      render()
    })
  }
  startButton.addEventListener('click', () => void start())

  copyButton.addEventListener('click', async () => {
    try {
      await (clipboard ?? globalThis.navigator?.clipboard).writeText(DOWNLOAD_SENTENCE)
      copyButton.classList.add('icon-btn--done')
      setTimeout(() => copyButton.classList.remove('icon-btn--done'), 1200)
    } catch {
      // The sentence is on screen; it can be selected by hand.
    }
  })

  const stop = () => poll(false)

  if (!speech) {
    render(null)
    return { ready: Promise.resolve(), render, refresh, stop }
  }
  speech.onStatusChange((status) => {
    render(status)
    void refresh()
  })
  const ready = Promise.all([
    speech.status().then((status) => render(status), () => render(null)),
    refresh()
  ]).then(() => undefined)
  return { ready, render, refresh, stop }
}

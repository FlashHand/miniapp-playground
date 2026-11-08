// "主播语音" card of the persona page (docs/design.md #8.2): which speech models are downloaded, downloading or missing,
// and which one Dozin is using, from MAESTROSDK.speech (Dozin docs/features/speech-recognition.md #4.2).

/** What the person says to the AI to get the model downloaded (the douyin-live-reply skill does it). */
export const DOWNLOAD_SENTENCE = '下载 Audience BOT 的语音模型'

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

/**
 * Pure view of a status. `available`: the page has MAESTROSDK.speech at all. Returns the note, the active line, one row
 * per model (and the sentence-cutting model while it is not ready), and whether to offer the download sentence.
 */
export const speechView = (status, { available = true } = {}) => {
  if (!available) return { note: '这个 Dozin 版本还不能显示主播语音：需要支持 MAESTROSDK.speech 的版本。', active: '', rows: [], download: false }
  if (!status) return { note: '读不到主播语音的状态，请稍后再打开这一页。', active: '', rows: [], download: false }
  if (!status.supported) return { note: '这台电脑不能识别主播语音（只支持 macOS Apple 芯片）。', active: '', rows: [], download: false }
  const rows = status.models.map((model) => ({
    id: model.id,
    name: model.name,
    text: stateText(model),
    state: model.state,
    percent: model.state === 'downloading' ? Math.floor(((model.received ?? 0) / model.bytes) * 100) : model.state === 'missing' ? 0 : 100,
    selected: model.id === status.selected
  }))
  if (status.vad.state !== 'ready') rows.push({ id: 'vad', name: '断句模型', text: stateText(status.vad), state: status.vad.state, percent: status.vad.state === 'downloading' ? Math.floor(((status.vad.received ?? 0) / status.vad.bytes) * 100) : 0, selected: false })
  const pending = [status.vad, ...status.models].some((item) => item.state === 'downloading' || item.state === 'installing')
  return { note: '', active: activeText(status), rows, download: !status.selected && !pending }
}

/** Wires the card. `sdk` is window.MAESTROSDK; returns `{ ready, render }` for tests. */
export function mountSpeech(doc, sdk, { clipboard } = {}) {
  const el = (name) => doc.querySelector(`[name="${name}"]`)
  const note = el('audience-bot__speech-note')
  const active = el('audience-bot__speech-active')
  const list = el('audience-bot__speech-models')
  const download = el('audience-bot__speech-download')
  const copyButton = el('audience-bot__copy-download')
  el('audience-bot__speech-download-text').textContent = DOWNLOAD_SENTENCE
  const speech = sdk?.speech

  const render = (status) => {
    const view = speechView(status, { available: Boolean(speech) })
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
  }

  copyButton.addEventListener('click', async () => {
    try {
      await (clipboard ?? globalThis.navigator?.clipboard).writeText(DOWNLOAD_SENTENCE)
      copyButton.classList.add('icon-btn--done')
      setTimeout(() => copyButton.classList.remove('icon-btn--done'), 1200)
    } catch {
      // The sentence is on screen; it can be selected by hand.
    }
  })

  if (!speech) {
    render(null)
    return { ready: Promise.resolve(), render }
  }
  speech.onStatusChange(render)
  const ready = speech.status().then(render, () => render(null))
  return { ready, render }
}

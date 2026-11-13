// The host's voice, step 1 (docs/design.md #8.1): capture the live room tab's own audio through Dozin
// (`ctx.browser.captureAudio`) and measure it once a second, so the owner can check that only this tab is heard.
// No speech recognition yet; nothing reaches the chat.

export const FLOOR_DB = -90
export const SILENT_DB = -60
const WINDOW_MS = 1000
const SUMMARY_MS = 10000

/** Failures that will not go away by trying again: the next try waits for a new target or a new takeover. */
const PERMANENT = new Set(['audio_platform_unsupported', 'capability_denied', 'audio_transport_unavailable'])
const REASONS = {
  audio_platform_unsupported: '只支持 macOS Apple 芯片',
  capability_denied: '扩展没有采音能力',
  audio_transport_unavailable: '这个 Dozin 版本不支持采音',
  tab_not_granted: '标签页没有允许',
  stale_document: '页面刚刷新，稍后重试',
  audio_capture_start_timeout: '启动超时，稍后重试'
}

/** dBFS of the samples' RMS, rounded, never below FLOOR_DB. */
export const levelDb = (sumSquares, count) => {
  if (!count || !(sumSquares > 0)) return FLOOR_DB
  return Math.max(FLOOR_DB, Math.round(20 * Math.log10(Math.sqrt(sumSquares / count))))
}

export const levelText = (db) => (db < SILENT_DB ? '采音：本标签页 · 静音' : `采音：本标签页 · 音量 ${db} dB`)

export const failureText = (code) => `采音失败：${REASONS[code] ?? code}`

const codeOf = (error) => String(error?.code || error?.message || 'audio_capture_failed').slice(0, 80)

/**
 * Starts capturing `tabId`. `setStatus` gets one line for the monitor panel; `log` gets a summary every 10 s (levels and
 * counts, never audio). `onEnd({ retry, code })` is called once when the capture ends by itself — `retry: false` for a
 * failure that trying again will not fix. `stop()` ends it without calling `onEnd`.
 */
export const startTabVoice = ({ browser, tabId, setStatus, log, onEnd, now = Date.now }) => {
  let stream
  let stopped = false
  const end = (detail) => {
    if (!stopped) onEnd?.(detail)
  }
  void (async () => {
    // Never call onEnd synchronously: the caller stores the returned handle first.
    await null
    setStatus('采音：正在启动…')
    try {
      stream = await browser.captureAudio(tabId)
    } catch (error) {
      if (stopped) return
      const code = codeOf(error)
      setStatus(failureText(code))
      log(`voice: capture failed: ${code}`)
      return end({ retry: !PERMANENT.has(code), code })
    }
    if (stopped) return void stream.stop().catch(() => {})
    log(`voice: capturing ${tabId}`)
    let sum = 0
    let count = 0
    let lastSequence = -1
    let windowStart = now()
    let summary = { seconds: 0, loud: 0, frames: 0, gaps: 0, peak: FLOOR_DB, since: windowStart }
    try {
      for await (const frame of stream.frames) {
        if (stopped) break
        const pcm = frame.pcm
        for (let i = 0; i < pcm.length; i++) sum += pcm[i] * pcm[i]
        count += pcm.length
        summary.frames++
        if (lastSequence >= 0 && frame.sequence > lastSequence + 1) summary.gaps += frame.sequence - lastSequence - 1
        lastSequence = frame.sequence
        const at = now()
        if (at - windowStart >= WINDOW_MS) {
          const db = levelDb(sum, count)
          setStatus(levelText(db))
          summary.seconds++
          if (db >= SILENT_DB) summary.loud++
          summary.peak = Math.max(summary.peak, db)
          sum = 0
          count = 0
          windowStart = at
        }
        if (at - summary.since >= SUMMARY_MS) {
          log(`voice: ${summary.seconds} s, ${summary.loud} s with sound, peak ${summary.peak} dB, ${summary.frames} frames, ${summary.gaps} missing`)
          summary = { seconds: 0, loud: 0, frames: 0, gaps: 0, peak: FLOOR_DB, since: at }
        }
      }
    } catch (error) {
      if (!stopped) log(`voice: stream failed: ${codeOf(error)}`)
    }
    if (stopped) return
    // A refresh or a navigation ends the stream; the caller starts a new one.
    setStatus('采音已停止，稍后重试')
    log('voice: stream ended')
    end({ retry: true, code: 'audio_ended' })
  })()
  return {
    async stop() {
      if (stopped) return
      stopped = true
      await stream?.stop().catch(() => {})
    }
  }
}

// The host's voice, step 2 (docs/design.md #8.2): Dozin recognises the room tab's audio (`ctx.browser.transcribe`) and
// hands back one sentence at a time. The extension carries no model and no recognition engine.

/** Failures that trying again will not fix; the others (no model yet, downloading, refresh) retry every few seconds. */
const SPEECH_PERMANENT = new Set(['audio_platform_unsupported', 'capability_denied', 'speech_not_supported', 'audio_transport_unavailable'])
const SPEECH_REASONS = {
  speech_model_missing: '语音模型未下载，在小程序 Audience BOT 里选择并下载',
  speech_model_downloading: '语音模型下载中，下好后自动开始',
  speech_unavailable: '语音识别暂时不可用，稍后重试',
  speech_not_supported: '这个 Dozin 版本不支持语音识别',
  speech_model_busy: '另一个直播间正在用别的模型，稍后重试',
  audio_platform_unsupported: '只支持 macOS Apple 芯片',
  capability_denied: '扩展没有采音能力',
  tab_not_granted: '标签页没有允许',
  stale_document: '页面刚刷新，稍后重试',
  audio_already_started: '这个标签页已在采音，稍后重试'
}

export const speechFailureText = (code) => `主播语音：${SPEECH_REASONS[code] ?? `没能开始（${code}）`}`
export const speechRunningText = (modelName) => `主播语音：${modelName} · 识别中`

/**
 * Starts recognising `tabId`. `onSentence({ text, seq, at, streamId })` gets each sentence (`at` = wall-clock time it
 * ended). `setStatus` gets the panel line. `onEnd({ retry, code })` is called once when it stops by itself or cannot
 * start; `stop()` ends it without calling `onEnd`. `log` gets the start and the end, never sentence text.
 */
export const startTabSpeech = ({ browser, tabId, setStatus, log, onSentence, onEnd, now = Date.now }) => {
  let stream
  let stopped = false
  const end = (detail) => {
    if (!stopped) onEnd?.(detail)
  }
  void (async () => {
    // Never call onEnd synchronously: the caller stores the returned handle first.
    await null
    setStatus('主播语音：正在启动…')
    try {
      if (typeof browser?.transcribe !== 'function') throw Object.assign(new Error('speech_not_supported'), { code: 'speech_not_supported' })
      stream = await browser.transcribe(tabId)
    } catch (error) {
      if (stopped) return
      const code = codeOf(error)
      setStatus(speechFailureText(code))
      return end({ retry: !SPEECH_PERMANENT.has(code), code })
    }
    if (stopped) return void stream.stop().catch(() => {})
    const startedAt = now()
    setStatus(speechRunningText(stream.modelName))
    log(`speech: recognising ${tabId} with ${stream.modelName}`)
    try {
      for await (const sentence of stream.sentences) {
        if (stopped) break
        onSentence({ text: sentence.text, seq: sentence.seq, at: startedAt + sentence.endMs, streamId: stream.streamId })
      }
    } catch (error) {
      if (!stopped) log(`speech: stream failed: ${codeOf(error)}`)
    }
    if (stopped) return
    const result = await stream.ended.catch(() => ({ reason: 'speech_unavailable', dropped: 0 }))
    setStatus(result.reason === 'document_changed' ? '主播语音：页面刷新，稍后继续' : '主播语音已停止，稍后重试')
    log(`speech: ended (${result.reason}, ${result.dropped} not recognised in time)`)
    end({ retry: true, code: result.reason })
  })()
  return {
    async stop() {
      if (stopped) return
      stopped = true
      await stream?.stop().catch(() => {})
    }
  }
}

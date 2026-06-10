// Shared live-recording pipeline: backend invokes, event listeners, level
// meter, duration/silence timers. Owns the transient feedback state
// (volatile tail, audio level, speaking, timers); the caller owns the
// transcript text (via `setText`) and its own state machine.
import { useCallback, useRef, useState } from "react"
import { invoke } from "@tauri-apps/api/core"
import { listen, emit } from "@tauri-apps/api/event"
import { error as logError } from "@tauri-apps/plugin-log"
import { newStreamMerge, consumeConfirmed, consumeVolatile, normalizeSource, appendStream } from "@/lib/stream-transcript"

export type AudioSourceKind = "mic" | "system" | "both"

export interface UseRecordingOptions {
  audioSource: AudioSourceKind
  speechLang: string
  /** Receives the live transcript text. Compatible with a React state setter. */
  setText: React.Dispatch<React.SetStateAction<string>>
  /** Capture/transcription errors (start failures, sidecar errors). */
  onError?: (message: string) => void
  /** Stop automatically after this many seconds of continuous silence. */
  silenceLimitSecs?: number
  /** Called after an automatic silence stop, so the caller can update its state. */
  onSilenceLimit?: () => void
}

function broadcast(recording: boolean) {
  window.dispatchEvent(new CustomEvent("recording-state", { detail: { recording } }))
  emit("recording-state", { recording }).catch((e) => logError(String(e)))
}

export function useRecording({
  audioSource,
  speechLang,
  setText,
  onError,
  silenceLimitSecs,
  onSilenceLimit,
}: UseRecordingOptions) {
  // In-progress tail from the streaming ASR path (shown muted, replaced live).
  const [volatileText, setVolatileText] = useState("")
  const [audioLevel, setAudioLevel] = useState(0)
  const [isSpeaking, setIsSpeaking] = useState(false)
  const [duration, setDuration] = useState(0)
  const [silenceSeconds, setSilenceSeconds] = useState(0)

  // Merges the mic + system streaming feeds into one interleaved transcript.
  const streamMergeRef = useRef(newStreamMerge())
  const unlistenRef = useRef<Array<() => void>>([])
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const silenceRef = useRef(0)
  const micLevelRef = useRef(0)
  const sysLevelRef = useRef(0)

  const clearTick = useCallback(() => {
    if (tickRef.current) {
      clearInterval(tickRef.current)
      tickRef.current = null
    }
  }, [])

  const teardown = useCallback(() => {
    unlistenRef.current.forEach((u) => u())
    unlistenRef.current = []
    clearTick()
  }, [clearTick])

  const resetLiveState = useCallback(() => {
    setVolatileText("")
    setAudioLevel(0)
    setIsSpeaking(false)
    setSilenceSeconds(0)
    silenceRef.current = 0
    micLevelRef.current = 0
    sysLevelRef.current = 0
  }, [])

  /** Immediate teardown for cancel/unmount: no flush wait, no callbacks. */
  const abort = useCallback(() => {
    teardown()
    invoke("stop_continuous").catch((e) => logError(String(e)))
    resetLiveState()
    broadcast(false)
  }, [teardown, resetLiveState])

  const beginTick = useCallback(() => {
    clearTick()
    tickRef.current = setInterval(() => {
      setDuration((d) => d + 1)
      silenceRef.current += 1
      setSilenceSeconds(silenceRef.current)
      if (silenceLimitSecs && silenceRef.current > silenceLimitSecs) {
        abort()
        onSilenceLimit?.()
      }
    }, 1000)
  }, [clearTick, silenceLimitSecs, abort, onSilenceLimit])

  const markActivity = useCallback(() => {
    silenceRef.current = 0
    setSilenceSeconds(0)
  }, [])

  const attachListeners = useCallback(async () => {
    // Each source's `confirmed` is cumulative. Single source uses the stream
    // text verbatim (exactly what the live caption shows); "both" mode
    // interleaves mic/system with Me/Them labels via deltas.
    const unStream = await listen<{ source: string; confirmed: string; volatile: string }>("transcript-stream", (e) => {
      markActivity()
      const labeled = audioSource === "both"
      const src = normalizeSource(e.payload.source)
      if (labeled) {
        const add = consumeConfirmed(streamMergeRef.current, src, e.payload.confirmed, labeled)
        if (add) setText((p) => appendStream(p, add))
      } else {
        // The text IS the live stream — cumulative confirmed plus the
        // in-progress volatile tail, replaced wholesale on every update so
        // revisions self-correct and it keeps pace with the live caption.
        const { confirmed, volatile } = e.payload
        setText(volatile ? (confirmed ? confirmed + " " + volatile : volatile) : confirmed)
      }
      setVolatileText(consumeVolatile(streamMergeRef.current, src, e.payload.volatile, labeled))
    })
    const unLevel = await listen<{ rms: number; source: string }>("audio-level", (e) => {
      const { rms, source } = e.payload
      if (source === "mic") micLevelRef.current = rms
      else if (source === "system") sysLevelRef.current = rms
      const level = Math.max(micLevelRef.current, sysLevelRef.current)
      setAudioLevel(level)
      const speaking = level > 0.012
      setIsSpeaking(speaking)
      if (speaking) markActivity()
    })
    const unErr = await listen<{ text: string }>("capture-error", (e) => {
      onError?.(`Transcription: ${e.payload.text}`)
    })
    unlistenRef.current = [unStream, unLevel, unErr]
  }, [audioSource, setText, onError, markActivity])

  const invokeStart = useCallback(
    () =>
      invoke("start_continuous", {
        language: speechLang === "auto" ? null : speechLang || null,
        source: audioSource,
      }),
    [speechLang, audioSource],
  )

  const start = useCallback(async () => {
    streamMergeRef.current = newStreamMerge()
    resetLiveState()
    setDuration(0)
    try {
      await attachListeners()
      await invokeStart()
      beginTick()
      broadcast(true)
    } catch (err) {
      teardown()
      const msg = err instanceof Error ? err.message : typeof err === "string" ? err : "Failed to start recording"
      onError?.(msg)
      throw err
    }
  }, [attachListeners, invokeStart, beginTick, teardown, resetLiveState, onError])

  /** Stop and wait `flushMs` for the backend to flush the final transcript
   *  before detaching listeners — detaching first would lose the tail. */
  const stop = useCallback(
    async (flushMs = 800) => {
      clearTick()
      await invoke("stop_continuous").catch((e) => logError(String(e)))
      await new Promise((r) => setTimeout(r, flushMs))
      teardown()
      resetLiveState()
      broadcast(false)
    },
    [clearTick, teardown, resetLiveState],
  )

  /** Pause keeps listeners attached; only the backend capture and timers stop.
   *  The merge state resets so the next session's confirmed restarts clean. */
  const pause = useCallback(async () => {
    clearTick()
    streamMergeRef.current = newStreamMerge()
    setVolatileText("")
    await invoke("stop_continuous").catch(() => {})
  }, [clearTick])

  const resume = useCallback(async () => {
    try {
      await invokeStart()
      beginTick()
    } catch (err) {
      teardown()
      const msg = err instanceof Error ? err.message : typeof err === "string" ? err : "Failed to resume recording"
      onError?.(msg)
      throw err
    }
  }, [invokeStart, beginTick, teardown, onError])

  return { volatileText, audioLevel, isSpeaking, duration, silenceSeconds, start, stop, pause, resume, abort }
}

// Shared live-recording pipeline: backend invokes, event listeners, level
// meter, duration/silence timers. Owns the transient feedback state
// (volatile tail, audio level, speaking, timers); the caller owns the
// transcript text (via `setText`) and its own state machine.
import { useCallback, useEffect, useRef, useState } from "react"
import { invoke } from "@tauri-apps/api/core"
import { listen, emit } from "@tauri-apps/api/event"
import { error as logError } from "@tauri-apps/plugin-log"
import {
  newStreamMerge,
  consumeConfirmed,
  consumeVolatile,
  normalizeSource,
  appendStream,
  setChannelLabels,
  type ChannelLabels,
} from "@/lib/stream-transcript"
import type { TranscriptionModel } from "@/types"

export type AudioSourceKind = "mic" | "system" | "both"

export interface UseRecordingOptions {
  audioSource: AudioSourceKind
  speechLang: string
  transcriptionModel: TranscriptionModel
  /** Dual-channel live labels (defaults Me/Them). */
  channelLabels?: Partial<ChannelLabels>
  /** Receives the live transcript text. Compatible with a React state setter. */
  setText: React.Dispatch<React.SetStateAction<string>>
  /** Returns the current editor text (a ref read, not state). Used to detect
   *  manual edits between stream updates; must stay in sync with `setText`. */
  getText: () => string
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
  transcriptionModel,
  channelLabels,
  setText,
  getText,
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
  const streamMergeRef = useRef(newStreamMerge(channelLabels))
  const channelLabelsRef = useRef(channelLabels)
  const unlistenRef = useRef<Array<() => void>>([])

  // Keep channel labels ref in sync without writing refs during render.
  useEffect(() => {
    channelLabelsRef.current = channelLabels
    if (channelLabels) setChannelLabels(streamMergeRef.current, channelLabels)
  }, [channelLabels])
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

  // Single-source editing support. The note shows `base + stream tail`:
  // `base` is whatever was in the editor at session start — or, after a manual
  // edit, the user's edited text (which embeds the stream text rendered so
  // far). `offset` skips the stream characters already baked into the base,
  // and `rendered` detects manual edits between updates so we re-anchor
  // instead of clobbering them. This works because with zeroed confirmation
  // gates the stream text (confirmed + volatile) is strictly append-only.
  const baseRef = useRef("")
  const streamOffsetRef = useRef(0)
  const lastStreamLenRef = useRef(0)
  const renderedRef = useRef<string | null>(null)

  const anchorText = useCallback(() => {
    streamOffsetRef.current = 0
    lastStreamLenRef.current = 0
    const p = getText()
    baseRef.current = p
    renderedRef.current = p
  }, [getText])

  const attachListeners = useCallback(async () => {
    // Each source's `confirmed` is cumulative. Single source appends the
    // stream text after the editor's existing content (re-anchoring around
    // manual edits); "both" mode interleaves mic/system with Me/Them labels
    // via deltas.
    const unStream = await listen<{ source: string; confirmed: string; volatile: string }>("transcript-stream", (e) => {
      markActivity()
      const labeled = audioSource === "both"
      const src = normalizeSource(e.payload.source)
      if (labeled) {
        const add = consumeConfirmed(streamMergeRef.current, src, e.payload.confirmed, labeled)
        if (add) setText((p) => appendStream(p, add))
      } else {
        const { confirmed, volatile } = e.payload
        const full = volatile ? (confirmed ? confirmed + " " + volatile : volatile) : confirmed
        // All ref bookkeeping happens here, outside the state updater — React
        // (StrictMode) may invoke updaters more than once, so they must stay pure.
        const p = getText()
        if (renderedRef.current !== null && p !== renderedRef.current) {
          // Manual edit since our last render: the edited text becomes the
          // new base (it already contains the stream text rendered so far);
          // only stream text beyond that point appends after it.
          baseRef.current = p
          streamOffsetRef.current = lastStreamLenRef.current
        }
        const tail = full.slice(streamOffsetRef.current).replace(/^\s+/, "")
        const base = baseRef.current
        const sep = base && tail ? (/\s$/.test(base) ? "" : " ") : ""
        const next = base + sep + tail
        lastStreamLenRef.current = full.length
        renderedRef.current = next
        setText(next)
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
  }, [audioSource, setText, getText, onError, markActivity])

  const invokeStart = useCallback(
    () =>
      invoke("start_continuous", {
        language: speechLang === "auto" ? null : speechLang || null,
        source: audioSource,
        model: transcriptionModel,
      }),
    [speechLang, audioSource, transcriptionModel],
  )

  /** Pre-spawn the streaming sidecar so the ASR model is already loaded when the
   *  user hits record. The backend parks the process (no capture, no mic
   *  indicator) behind a short TTL; `start` then reuses it instead of paying
   *  the multi-second model load. Best-effort — failures just mean a normal
   *  (slower) start. */
  const prewarm = useCallback(() => {
    invoke("prewarm_stream", { model: transcriptionModel, source: audioSource }).catch((e) =>
      logError(String(e)),
    )
  }, [transcriptionModel, audioSource])

  const start = useCallback(async () => {
    streamMergeRef.current = newStreamMerge(channelLabelsRef.current)
    resetLiveState()
    setDuration(0)
    // Existing editor content stays as the prefix; the session's stream text
    // appends after it.
    anchorText()
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
  }, [attachListeners, invokeStart, beginTick, teardown, resetLiveState, anchorText, onError])

  /** Live-update dual-channel speaker names mid-recording. */
  const updateChannelLabels = useCallback((labels: Partial<ChannelLabels>) => {
    setChannelLabels(streamMergeRef.current, labels)
    channelLabelsRef.current = { ...channelLabelsRef.current, ...labels }
  }, [])

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
    streamMergeRef.current = newStreamMerge(channelLabelsRef.current)
    setVolatileText("")
    await invoke("stop_continuous").catch(() => {})
    // Re-prewarm so resume skips the model load (the stopped sidecar exits with
    // its session; a parked replacement loads in the background while paused).
    prewarm()
  }, [clearTick, prewarm])

  const resume = useCallback(async () => {
    // The resumed sidecar session restarts its confirmed text from empty, so
    // re-anchor: text from before the pause is kept as the new base.
    anchorText()
    try {
      await invokeStart()
      beginTick()
    } catch (err) {
      teardown()
      const msg = err instanceof Error ? err.message : typeof err === "string" ? err : "Failed to resume recording"
      onError?.(msg)
      throw err
    }
  }, [invokeStart, beginTick, teardown, anchorText, onError])

  return {
    volatileText,
    audioLevel,
    isSpeaking,
    duration,
    silenceSeconds,
    start,
    stop,
    pause,
    resume,
    abort,
    prewarm,
    updateChannelLabels,
  }
}

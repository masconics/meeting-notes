import { useState, useRef, useCallback } from "react"

type WhisperState = "idle" | "recording" | "transcribing" | "done"
type EngineStatus = { status: "checking" | "ready" | "unavailable"; error?: string }

function createWav(audioBuffer: AudioBuffer): ArrayBuffer {
  const numChannels = 1
  const sampleRate = audioBuffer.sampleRate
  const bitsPerSample = 16
  const data = audioBuffer.getChannelData(0)
  const byteRate = sampleRate * numChannels * (bitsPerSample / 8)
  const blockAlign = numChannels * (bitsPerSample / 8)
  const dataSize = data.length * (bitsPerSample / 8)
  const buffer = new ArrayBuffer(44 + dataSize)
  const view = new DataView(buffer)

  function writeString(offset: number, str: string) {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i))
    }
  }

  writeString(0, "RIFF")
  view.setUint32(4, 36 + dataSize, true)
  writeString(8, "WAVE")
  writeString(12, "fmt ")
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, numChannels, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, byteRate, true)
  view.setUint16(32, blockAlign, true)
  view.setUint16(34, bitsPerSample, true)
  writeString(36, "data")
  view.setUint32(40, dataSize, true)

  let offset = 44
  for (let i = 0; i < data.length; i++) {
    const s = Math.max(-1, Math.min(1, data[i]))
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true)
    offset += 2
  }

  return buffer
}

export function useWhisper() {
  const [state, setState] = useState<WhisperState>("idle")
  const [result, setResult] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [engine, setEngine] = useState<EngineStatus>({ status: "checking" })
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])

  const checkEngine = useCallback(async () => {
    setEngine({ status: "checking" })
    try {
      const { invoke } = await import("@tauri-apps/api/core")
      const ready: boolean = await invoke("check_whisper_ready")
      setEngine({ status: ready ? "ready" : "unavailable", error: ready ? undefined : "Whisper engine not installed. Go to Settings to download it." })
    } catch {
      setEngine({ status: "unavailable", error: "Cannot connect to transcription engine. Is this running as a Tauri app?" })
    }
  }, [])

  const setupEngine = useCallback(async () => {
    setEngine({ status: "checking" })
    try {
      const { invoke } = await import("@tauri-apps/api/core")
      await invoke("setup_whisper")
      const ready: boolean = await invoke("check_whisper_ready")
      setEngine({ status: ready ? "ready" : "unavailable", error: ready ? undefined : "Installation completed but engine reports not ready." })
    } catch (err: unknown) {
      setEngine({
        status: "unavailable",
        error: err instanceof Error ? err.message : typeof err === "string" ? err : "Installation failed",
      })
    }
  }, [])

  const startRecording = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setError("Microphone not available")
      return
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      })
      const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : "audio/webm"
      const recorder = new MediaRecorder(stream, { mimeType })
      chunksRef.current = []
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data)
      }
      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop())
        if (chunksRef.current.length === 0) {
          setState("idle")
          return
        }
        await transcribe()
      }
      recorder.start()
      mediaRecorderRef.current = recorder
      setState("recording")
      setError(null)
      setResult("")
    } catch (err) {
      setError(
        err instanceof DOMException && err.name === "NotAllowedError"
          ? "Microphone access denied"
          : "Failed to start recording"
      )
    }
  }, [])

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current?.state === "recording") {
      mediaRecorderRef.current.stop()
    }
    setState("transcribing")
  }, [])

  const transcribe = useCallback(async () => {
    try {
      const blob = new Blob(chunksRef.current, { type: "audio/webm" })
      const arrayBuffer = await blob.arrayBuffer()
      const audioCtx = new AudioContext({ sampleRate: 16000 })
      const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer)
      const wavBuffer = createWav(audioBuffer)
      const wavBytes = Array.from(new Uint8Array(wavBuffer))
      await audioCtx.close()

      const { invoke } = await import("@tauri-apps/api/core")
      const text: string = await invoke("transcribe_audio", {
        audioData: wavBytes,
      })
      setResult(text)
      setState("done")
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : typeof err === "string"
            ? err
            : "Transcription failed"
      )
      setState("idle")
    }
  }, [])

  const reset = useCallback(() => {
    setState("idle")
    setResult("")
    setError(null)
  }, [])

  return {
    state,
    result,
    error,
    engine,
    checkEngine,
    setupEngine,
    startRecording,
    stopRecording,
    reset,
  }
}

import { useState, useRef, useCallback, useEffect } from "react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { HugeiconsIcon } from "@hugeicons/react"
import {
  AiVoiceIcon,
  StopIcon,
  PlayListAddIcon,
  Mic01Icon,
  HeadsetIcon,
  HelpCircleIcon,
  Settings02Icon,
  ShieldIcon,
  LockIcon,
} from "@hugeicons/core-free-icons"
import { useAudioDevices } from "@/lib/use-audio-devices"
import { useMicrophonePermission } from "@/lib/use-permissions"
import { WhisperModal } from "@/components/whisper-modal"
import type { Meeting, AppSettings } from "@/types"

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

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}:${s.toString().padStart(2, "0")}`
}

function AudioBars({ active }: { active: boolean }) {
  return (
    <div className="flex items-end justify-center gap-0.5 h-10" aria-hidden="true">
      {Array.from({ length: 9 }).map((_, i) => (
        <div
          key={i}
          className="w-1 bg-primary rounded-full"
          style={
            active
              ? {
                  height: `${30 + Math.random() * 70}%`,
                  animation: `audio-bar 0.${400 + i * 50}ms ease-in-out infinite alternate`,
                  animationDelay: `${i * 80}ms`,
                }
              : { height: "16%" }
          }
        />
      ))}
    </div>
  )
}

interface MeetingRecorderProps {
  onSave: (meeting: Meeting) => void
  onCancel: () => void
  onSettings: () => void
  settings: AppSettings
}

type RecorderState = "idle" | "recording" | "reviewing"

export function MeetingRecorder({ onSave, onCancel, onSettings, settings }: MeetingRecorderProps) {
  const [recorderState, setRecorderState] = useState<RecorderState>("idle")
  const [title, setTitle] = useState(settings.titlePrefix)
  const [transcript, setTranscript] = useState("")
  const [notes, setNotes] = useState("")
  const [duration, setDuration] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [showSetupHelp, setShowSetupHelp] = useState(false)
  const [isProcessingChunk, setIsProcessingChunk] = useState(false)
  const [isSpeaking, setIsSpeaking] = useState(false)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const vadRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const transcriptAccRef = useRef("")
  const pendingChunksRef = useRef<Blob[]>([])
  const activeRef = useRef(false)
  const silenceCountRef = useRef(0)
  const mimeTypeRef = useRef("")
  const processingRef = useRef(false)
  const hasSpeechRef = useRef(false)
  const segmentTicksRef = useRef(0)
  const vadCtxRef = useRef<AudioContext | null>(null)
  const recordStreamRef = useRef<MediaStream | null>(null)

  const mic = useMicrophonePermission()

  const {
    devices,
    selectedDevice,
    setSelectedDevice,
    audioSource,
    setAudioSource,
  } = useAudioDevices()

  useEffect(() => {
    if (settings.audioSource) setAudioSource(settings.audioSource)
    if (settings.preferredDeviceId && settings.preferredDeviceId !== "default") {
      setSelectedDevice(settings.preferredDeviceId)
    }
  }, [])

  const cleanupRecording = useCallback(() => {
    // Stop while still "active" is false so onstop transcribes the final
    // segment but does not start a new one.
    activeRef.current = false
    silenceCountRef.current = 0
    segmentTicksRef.current = 0
    if (vadRef.current) {
      clearInterval(vadRef.current)
      vadRef.current = null
    }
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === "recording") {
      mediaRecorderRef.current.stop()
    }
    mediaRecorderRef.current = null
    if (vadCtxRef.current && vadCtxRef.current.state !== "closed") {
      vadCtxRef.current.close()
    }
    vadCtxRef.current = null
    recordStreamRef.current = null
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop())
    }
    streamRef.current = null
    if (timerRef.current) {
      clearInterval(timerRef.current)
      timerRef.current = null
    }
  }, [])

  // Transcribe one complete WebM segment. Each segment is a self-contained
  // recording (with its own header) so decodeAudioData always succeeds —
  // unlike slicing a single recorder's timeslice chunks, where only the first
  // chunk carries the WebM header.
  const transcribeBlob = useCallback(async (blob: Blob) => {
    processingRef.current = true
    setIsProcessingChunk(true)
    try {
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

      if (text.trim()) {
        transcriptAccRef.current += " " + text.trim()
        setTranscript(transcriptAccRef.current.trim())
      }
    } catch {
      // Silently continue
    } finally {
      processingRef.current = false
      setIsProcessingChunk(false)
    }
  }, [])

  const startRecording = useCallback(async () => {
    const permResult = await mic.request()
    if (permResult !== "granted") return

    if (!navigator.mediaDevices?.getUserMedia) {
      setError("Microphone access not available")
      return
    }

    setError(null)
    setTranscript("")
    setDuration(0)
    transcriptAccRef.current = ""
    pendingChunksRef.current = []
    activeRef.current = true
    silenceCountRef.current = 0
    segmentTicksRef.current = 0
    hasSpeechRef.current = false
    setIsSpeaking(false)

    try {
      // Capture constraints. For mic, enable the browser's built-in DSP
      // (noise suppression / echo cancel / auto gain) — big accuracy win for
      // Whisper. For system audio (loopback via BlackHole etc.) leave DSP off
      // so we don't distort an already-clean signal.
      const deviceConstraint: MediaTrackConstraints =
        selectedDevice && selectedDevice !== "default"
          ? { deviceId: { exact: selectedDevice } }
          : {}
      const dspConstraints: MediaTrackConstraints =
        audioSource === "system"
          ? { echoCancellation: false, noiseSuppression: false, autoGainControl: false }
          : { echoCancellation: true, noiseSuppression: true, autoGainControl: true }

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { ...deviceConstraint, ...dspConstraints },
      })
      streamRef.current = stream

      const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : "audio/webm"
      mimeTypeRef.current = mimeType

      // Start a fresh, self-contained recorder for one speech segment. When it
      // stops (on silence / max length / final stop) onstop transcribes the
      // complete WebM blob and, while still active, starts the next segment.
      const startSegment = () => {
        const recordStream = recordStreamRef.current
        if (!recordStream || !activeRef.current) return
        pendingChunksRef.current = []
        hasSpeechRef.current = false
        segmentTicksRef.current = 0
        const recorder = new MediaRecorder(recordStream, { mimeType })

        recorder.ondataavailable = (e) => {
          if (e.data.size > 0) pendingChunksRef.current.push(e.data)
        }

        recorder.onstop = async () => {
          const chunks = pendingChunksRef.current
          pendingChunksRef.current = []
          if (chunks.length > 0 && hasSpeechRef.current) {
            await transcribeBlob(new Blob(chunks, { type: mimeType }))
          }
          // Restart for the next segment unless recording was stopped.
          if (activeRef.current) startSegment()
        }

        recorder.onerror = () => {
          setError("Recording error occurred")
        }

        recorder.start()
        mediaRecorderRef.current = recorder
      }

      // Build a cleanup graph that feeds BOTH the VAD analyser and the
      // recorder. The context lives for the whole recording, across segment
      // restarts. Chain: source -> high-pass (cut rumble/hum < 85Hz)
      // -> low-shelf de-emphasis -> analyser + recorder destination.
      const audioCtx = new AudioContext()
      vadCtxRef.current = audioCtx
      const source = audioCtx.createMediaStreamSource(stream)

      const highpass = audioCtx.createBiquadFilter()
      highpass.type = "highpass"
      highpass.frequency.value = 85 // remove HVAC hum, desk thumps, DC offset

      const lowshelf = audioCtx.createBiquadFilter()
      lowshelf.type = "lowshelf"
      lowshelf.frequency.value = 200
      lowshelf.gain.value = -6 // tame low-end boom that muddies speech

      const analyser = audioCtx.createAnalyser()
      analyser.fftSize = 512
      analyser.smoothingTimeConstant = 0.3

      const dest = audioCtx.createMediaStreamDestination()

      source.connect(highpass)
      highpass.connect(lowshelf)
      lowshelf.connect(analyser)
      lowshelf.connect(dest)

      // Recorder records the filtered output, not the raw mic stream.
      recordStreamRef.current = dest.stream

      const dataArray = new Float32Array(analyser.fftSize)

      // VAD: RMS volume check every 150ms.
      // Speech > 0.01 RMS; silence < 0.01 for 10 ticks (1.5s) closes a segment.
      const SPEECH_THRESHOLD = 0.01
      const SILENCE_TICKS = 10
      const MAX_SEGMENT_TICKS = 100 // ~15s cap so long speech still flushes

      const endSegment = () => {
        if (mediaRecorderRef.current?.state === "recording") {
          // Triggers onstop -> transcribe + restart.
          mediaRecorderRef.current.stop()
        }
      }

      vadRef.current = setInterval(() => {
        if (!activeRef.current) return
        analyser.getFloatTimeDomainData(dataArray)

        let sum = 0
        for (let i = 0; i < dataArray.length; i++) {
          sum += dataArray[i] * dataArray[i]
        }
        const rms = Math.sqrt(sum / dataArray.length)
        segmentTicksRef.current++

        if (rms > SPEECH_THRESHOLD) {
          silenceCountRef.current = 0
          hasSpeechRef.current = true
          setIsSpeaking(true)
        } else {
          silenceCountRef.current++
          setIsSpeaking(false)
          if (hasSpeechRef.current && silenceCountRef.current >= SILENCE_TICKS) {
            endSegment()
            return
          }
        }

        // Force a flush on long continuous speech so the transcript updates
        // incrementally instead of only at the next pause.
        if (hasSpeechRef.current && segmentTicksRef.current >= MAX_SEGMENT_TICKS) {
          endSegment()
        }
      }, 150)

      startSegment()

      timerRef.current = setInterval(() => {
        setDuration((d) => d + 1)
      }, 1000)

      setRecorderState("recording")
    } catch (err) {
      setError(
        err instanceof DOMException && err.name === "NotAllowedError"
          ? "Microphone access denied"
          : "Failed to start recording"
      )
    }
  }, [audioSource, selectedDevice, mic, transcribeBlob])

  const stopRecording = useCallback(() => {
    activeRef.current = false
    cleanupRecording()
    setRecorderState("reviewing")
  }, [cleanupRecording])

  const handleSave = useCallback(() => {
    const meeting: Meeting = {
      id: crypto.randomUUID(),
      title: title || `Meeting ${new Date().toLocaleDateString()}`,
      date: new Date().toISOString(),
      duration,
      transcript: transcript.trim(),
      notes: notes.trim(),
    }
    onSave(meeting)
  }, [title, duration, transcript, notes, onSave])

  useEffect(() => {
    return () => {
      cleanupRecording()
    }
  }, [cleanupRecording])

  const systemAudioLabel = devices.find((d) => d.deviceId === selectedDevice)?.label

  return (
    <div className="flex flex-col gap-6 w-full max-w-2xl mx-auto">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-lg">New Meeting</CardTitle>
            <div className="flex items-center gap-2">
              {recorderState === "recording" && (
                <Badge variant="destructive" className="animate-pulse">
                  {formatDuration(duration)}
                </Badge>
              )}
              <Button variant="ghost" size="icon-sm" onClick={onSettings}>
                <HugeiconsIcon icon={Settings02Icon} strokeWidth={2} />
              </Button>
              <Button variant="ghost" size="sm" onClick={onCancel}>
                Back
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {mic.permission === "denied" ? (
            <div className="flex flex-col items-center gap-4 py-6">
              <div className="bg-destructive/10 inline-flex size-14 items-center justify-center rounded-full">
                <HugeiconsIcon icon={LockIcon} strokeWidth={2} className="size-7 text-destructive" />
              </div>
              <div className="text-center flex flex-col gap-1">
                <p className="text-base font-medium">Microphone Access Required</p>
                <p className="text-sm text-muted-foreground max-w-sm">
                  Meeting Notes needs microphone permission to transcribe conversations.
                  Enable it in System Settings to start recording.
                </p>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={mic.request}>
                  <HugeiconsIcon icon={ShieldIcon} strokeWidth={2} data-icon="inline-start" />
                  Try Again
                </Button>
                <Button size="sm" onClick={mic.openSystemSettings}>
                  <HugeiconsIcon icon={Settings02Icon} strokeWidth={2} data-icon="inline-start" />
                  Open System Settings
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Go to Privacy &amp; Security &rarr; Microphone &rarr; enable Meeting Notes
              </p>
            </div>
          ) : mic.permission === "requesting" ? (
            <div className="flex flex-col items-center gap-3 py-12">
              <div className="size-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
              <p className="text-sm text-muted-foreground">Requesting microphone access...</p>
            </div>
          ) : (
            <>
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Meeting title..."
            disabled={recorderState === "recording"}
          />

          <div className="flex flex-col gap-2">
            <label className="text-xs font-medium text-muted-foreground">
              Audio Source
            </label>
            <div className="flex gap-2">
              <Button
                variant={audioSource === "mic" ? "default" : "outline"}
                size="sm"
                onClick={() => setAudioSource("mic")}
                disabled={recorderState !== "idle"}
                className="flex-1"
              >
                <HugeiconsIcon icon={Mic01Icon} strokeWidth={2} data-icon="inline-start" />
                Microphone
              </Button>
              <Button
                variant={audioSource === "system" ? "default" : "outline"}
                size="sm"
                onClick={() => setAudioSource("system")}
                disabled={recorderState !== "idle"}
                className="flex-1"
              >
                <HugeiconsIcon icon={HeadsetIcon} strokeWidth={2} data-icon="inline-start" />
                System Audio
              </Button>
            </div>
          </div>

          {audioSource === "system" && devices.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-muted-foreground">
                Audio Input Device
              </label>
              <Select
                value={selectedDevice}
                onValueChange={setSelectedDevice}
                disabled={recorderState !== "idle"}
              >
                <SelectTrigger size="sm">
                  <SelectValue placeholder="Select audio input..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {devices.map((d) => (
                      <SelectItem key={d.deviceId} value={d.deviceId}>
                        {d.label}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Selected: {systemAudioLabel || "None"}
              </p>
            </div>
          )}

          {audioSource === "mic" && devices.length > 0 && (
            <Select
              value={selectedDevice}
              onValueChange={setSelectedDevice}
              disabled={recorderState !== "idle"}
            >
              <SelectTrigger size="sm">
                <SelectValue placeholder="Select microphone..." />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {devices.map((d) => (
                    <SelectItem key={d.deviceId} value={d.deviceId}>
                      {d.label}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          )}

          {audioSource === "system" && (
            <Card className="border-dashed">
              <CardContent className="flex flex-col gap-3 pt-4">
                <div className="flex items-start gap-2">
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => setShowSetupHelp(!showSetupHelp)}
                    className="shrink-0 mt-0.5"
                  >
                    <HugeiconsIcon icon={showSetupHelp ? Settings02Icon : HelpCircleIcon} strokeWidth={2} />
                  </Button>
                  <div>
                    <p className="text-sm font-medium">
                      Capture audio from Teams, Zoom &amp; other apps
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Route system audio through a virtual device to transcribe meeting
                      conversations from any app.
                    </p>
                  </div>
                </div>

                {showSetupHelp && (
                  <div className="flex flex-col gap-3 text-xs text-muted-foreground bg-muted rounded-2xl p-3">
                    <div>
                      <span className="font-medium text-foreground">Step 1:</span>{" "}
                      Install{" "}
                      <a
                        href="https://github.com/ExistentialAudio/BlackHole"
                        target="_blank"
                        rel="noreferrer"
                        className="text-primary underline underline-offset-3"
                      >
                        BlackHole
                      </a>{" "}
                      (free virtual audio driver for macOS).
                    </div>
                    <div>
                      <span className="font-medium text-foreground">Step 2:</span>{" "}
                      Open <strong>Audio MIDI Setup</strong> &rarr; create a
                      Multi-Output Device with your speakers + BlackHole.
                    </div>
                    <div>
                      <span className="font-medium text-foreground">Step 3:</span>{" "}
                      In your meeting app, set the speaker output to the
                      Multi-Output Device.
                    </div>
                    <div>
                      <span className="font-medium text-foreground">Step 4:</span>{" "}
                      In this app, select <strong>System Audio</strong> mode and
                      choose <strong>BlackHole 2ch</strong> as the input device above.
                    </div>
                    <div>
                      <span className="font-medium text-foreground">Step 5:</span>{" "}
                      Start recording. Audio will be captured and transcribed using
                      the local Whisper engine.
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          <AudioBars active={recorderState === "recording"} />

          {error && (
            <div className="text-destructive text-sm font-medium" role="alert">
              {error}
            </div>
          )}

          {recorderState === "idle" && (
            <div className="flex justify-center">
              <Button size="lg" onClick={startRecording}>
                <HugeiconsIcon icon={AiVoiceIcon} strokeWidth={2} data-icon="inline-start" />
                Start Recording
              </Button>
            </div>
          )}

          {recorderState === "recording" && (
            <div className="flex justify-center">
              <Button size="lg" variant="destructive" onClick={stopRecording}>
                <HugeiconsIcon icon={StopIcon} strokeWidth={2} data-icon="inline-start" />
                Stop Recording
              </Button>
            </div>
          )}

          {(transcript || recorderState === "recording" || recorderState === "reviewing") && (
            <div className="flex flex-col gap-2">
              <label className="text-xs font-medium text-muted-foreground flex items-center gap-2">
                Transcription
                {recorderState === "recording" && isProcessingChunk && (
                  <span className="inline-flex items-center gap-1 text-primary">
                    <div className="size-2 border border-primary border-t-transparent rounded-full animate-spin" />
                    processing...
                  </span>
                )}
                {recorderState === "recording" && !isProcessingChunk && isSpeaking && (
                  <span className="text-primary inline-flex items-center gap-1">
                    <span className="size-1.5 rounded-full bg-emerald-500 animate-pulse" />
                    speaking
                  </span>
                )}
                {recorderState === "recording" && !isProcessingChunk && !isSpeaking && (
                  <span className="text-muted-foreground inline-flex items-center gap-1">
                    <span className="size-1.5 rounded-full bg-muted-foreground" />
                    listening
                  </span>
                )}
              </label>
              <Textarea
                value={transcript}
                onChange={(e) => setTranscript(e.target.value)}
                readOnly={recorderState === "recording"}
                placeholder="Transcription will appear here..."
                className="min-h-32"
              />
            </div>
          )}

          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <label className="text-xs font-medium text-muted-foreground">
                Notes
              </label>
              <WhisperModal
                onTranscription={(text) =>
                  setNotes((prev) => (prev ? prev + "\n" + text : text))
                }
                onOpenSettings={onSettings}
              />
            </div>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Add your meeting notes..."
              className="min-h-28"
            />
          </div>
            </>
          )}
        </CardContent>
      </Card>

      {recorderState === "reviewing" && (
        <div className="flex justify-end gap-2">
          <Button
            variant="outline"
            onClick={() => {
              setTranscript("")
              setDuration(0)
              startRecording()
            }}
          >
            <HugeiconsIcon icon={AiVoiceIcon} strokeWidth={2} data-icon="inline-start" />
            Record Again
          </Button>
          <Button onClick={handleSave}>
            <HugeiconsIcon icon={PlayListAddIcon} strokeWidth={2} data-icon="inline-start" />
            Save Meeting
          </Button>
        </div>
      )}
    </div>
  )
}

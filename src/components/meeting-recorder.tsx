import { useState, useRef, useCallback, useEffect } from "react"
import { motion } from "framer-motion"
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
  FileCheckIcon,
  AiBrain01Icon,
  ArrowDown01Icon,
  ArrowUp01Icon,
} from "@hugeicons/core-free-icons"
import { useAudioDevices } from "@/lib/use-audio-devices"
import { useMicrophonePermission } from "@/lib/use-permissions"
import { WhisperModal } from "@/components/whisper-modal"
import { MeetingTemplateSelector } from "@/components/meeting-template-selector"
import { NoteEnhancer } from "@/components/note-enhancer"
import { TemplateIcon } from "@/components/template-icon"
import type { Meeting, AppSettings, MeetingTemplate, MeetingSection } from "@/types"

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

const BAR_COUNT = 9

// Real-time level meter driven by the recording analyser. Reads the frequency
// spectrum each animation frame and maps the speech-range bins onto BAR_COUNT
// bars, so the bars actually move with the user's voice.
function AudioBars({
  active,
  analyserRef,
}: {
  active: boolean
  analyserRef: React.RefObject<AnalyserNode | null>
}) {
  const [levels, setLevels] = useState<number[]>(() => new Array(BAR_COUNT).fill(0))
  const rafRef = useRef<number | null>(null)

  useEffect(() => {
    if (!active) {
      setLevels(new Array(BAR_COUNT).fill(0))
      return
    }
    // ~512 fftSize -> 256 bins. Speech energy lives in the low-mid bins, so we
    // only sample the first ~72 (roughly up to a few kHz) and split into bars.
    const USABLE_BINS = 72
    const per = Math.floor(USABLE_BINS / BAR_COUNT)
    const data = new Uint8Array(256)

    const loop = () => {
      const analyser = analyserRef.current
      if (analyser) {
        analyser.getByteFrequencyData(data)
        const next: number[] = []
        for (let b = 0; b < BAR_COUNT; b++) {
          let sum = 0
          for (let i = 0; i < per; i++) sum += data[b * per + i]
          // Normalize 0..1, apply a gentle curve so quiet speech still shows.
          next.push(Math.pow(sum / per / 255, 0.6))
        }
        setLevels(next)
      }
      rafRef.current = requestAnimationFrame(loop)
    }
    rafRef.current = requestAnimationFrame(loop)
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
    }
  }, [active, analyserRef])

  return (
    <div className="flex items-end justify-center gap-0.5 h-10" aria-hidden="true">
      {levels.map((lvl, i) => (
        <div
          key={i}
          className="w-1 bg-primary rounded-full transition-[height] duration-75 ease-out"
          style={{ height: active ? `${Math.max(8, Math.min(100, lvl * 130))}%` : "16%" }}
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
  const [isTranscribing, setIsTranscribing] = useState(false)
  const [isSpeaking, setIsSpeaking] = useState(false)
  const [selectedTemplate, setSelectedTemplate] = useState<MeetingTemplate | undefined>(undefined)
  const [showTemplatePicker, setShowTemplatePicker] = useState(false)
  const [reviewStructuredNotes, setReviewStructuredNotes] = useState<MeetingSection[] | null>(null)
  const [reviewEnhancedNotes, setReviewEnhancedNotes] = useState<string | null>(null)
  const [brief, setBrief] = useState<string | null>(null)
  const [isBriefLoading, setIsBriefLoading] = useState(false)
  const [showBrief, setShowBrief] = useState(false)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const allChunksRef = useRef<Blob[]>([])
  const audioCtxRef = useRef<AudioContext | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const analyserPollerRef = useRef<ReturnType<typeof setInterval> | null>(null)

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
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === "recording") {
      mediaRecorderRef.current.stop()
    }
    mediaRecorderRef.current = null
    analyserRef.current = null
    if (analyserPollerRef.current) {
      clearInterval(analyserPollerRef.current)
      analyserPollerRef.current = null
    }
    if (audioCtxRef.current && audioCtxRef.current.state !== "closed") {
      audioCtxRef.current.close()
    }
    audioCtxRef.current = null
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop())
    }
    streamRef.current = null
    if (timerRef.current) {
      clearInterval(timerRef.current)
      timerRef.current = null
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
    setIsSpeaking(false)

    try {
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

      const audioCtx = new AudioContext()
      audioCtxRef.current = audioCtx
      const source = audioCtx.createMediaStreamSource(stream)

      const highpass = audioCtx.createBiquadFilter()
      highpass.type = "highpass"
      highpass.frequency.value = 85

      const analyser = audioCtx.createAnalyser()
      analyser.fftSize = 512
      analyser.smoothingTimeConstant = 0.3
      analyserRef.current = analyser

      const dest = audioCtx.createMediaStreamDestination()

      source.connect(highpass)
      highpass.connect(analyser)
      highpass.connect(dest)

      const dataArray = new Float32Array(analyser.fftSize)
      analyserPollerRef.current = setInterval(() => {
        analyser.getFloatTimeDomainData(dataArray)
        let sum = 0
        for (let i = 0; i < dataArray.length; i++) {
          sum += dataArray[i] * dataArray[i]
        }
        const rms = Math.sqrt(sum / dataArray.length)
        setIsSpeaking(rms > 0.01)
      }, 150)

      allChunksRef.current = []
      const recorder = new MediaRecorder(dest.stream, { mimeType })

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) allChunksRef.current.push(e.data)
      }

      recorder.onstop = async () => {
        const chunks = [...allChunksRef.current]
        allChunksRef.current = []
        if (chunks.length > 0) {
          setIsTranscribing(true)
          try {
            const blob = new Blob(chunks, { type: mimeType })
            const arrayBuffer = await blob.arrayBuffer()
            const decCtx = new AudioContext({ sampleRate: 16000 })
            const audioBuffer = await decCtx.decodeAudioData(arrayBuffer)
            const wavBuffer = createWav(audioBuffer)
            await decCtx.close()

            const { invoke } = await import("@tauri-apps/api/core")
            const text: string = await invoke("transcribe_audio_fluid", {
              audioData: Array.from(new Uint8Array(wavBuffer)),
            })
            setTranscript(text.trim())
          } catch (err) {
            const msg = err instanceof Error ? err.message : typeof err === "string" ? err : "Transcription failed"
            setError(msg)
          } finally {
            setIsTranscribing(false)
          }
        }
        analyserRef.current = null
        if (analyserPollerRef.current) {
          clearInterval(analyserPollerRef.current)
          analyserPollerRef.current = null
        }
        if (audioCtxRef.current && audioCtxRef.current.state !== "closed") {
          audioCtxRef.current.close()
        }
        audioCtxRef.current = null
        if (streamRef.current) {
          streamRef.current.getTracks().forEach((t) => t.stop())
        }
        streamRef.current = null
        if (timerRef.current) {
          clearInterval(timerRef.current)
          timerRef.current = null
        }
        setRecorderState("reviewing")
      }

      recorder.onerror = () => {
        setError("Recording error occurred")
      }

      recorder.start()
      mediaRecorderRef.current = recorder

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
  }, [audioSource, selectedDevice, mic])

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current?.state === "recording") {
      mediaRecorderRef.current.stop()
    }
  }, [])

  const handleGenerateBrief = useCallback(async () => {
    setIsBriefLoading(true)
    setError(null)
    try {
      const { generateBrief, isAIConfigured } = await import("@/lib/ai-service")
      if (!isAIConfigured()) {
        setError("AI is not configured. Set your API key in Settings.")
        return
      }
      const { loadMeetings } = await import("@/lib/storage")
      const pastMeetings = loadMeetings()
      const sections = selectedTemplate?.sections ?? []
      const result = await generateBrief(title, sections, pastMeetings)
      setBrief(result)
      setShowBrief(true)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setIsBriefLoading(false)
    }
  }, [title, selectedTemplate])

  const handleSave = useCallback(() => {
    const meeting: Meeting = {
      id: crypto.randomUUID(),
      title: title || `Meeting ${new Date().toLocaleDateString()}`,
      date: new Date().toISOString(),
      duration,
      transcript: transcript.trim(),
      notes: notes.trim(),
      templateId: selectedTemplate?.id,
      structuredNotes: reviewStructuredNotes ?? undefined,
      enhancedNotes: reviewEnhancedNotes ?? undefined,
      brief: brief ?? undefined,
    }
    onSave(meeting)
  }, [title, duration, transcript, notes, selectedTemplate, reviewStructuredNotes, reviewEnhancedNotes, brief, onSave])

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
                <motion.div
                  animate={{ opacity: [1, 0.6, 1] }}
                  transition={{ repeat: Infinity, duration: 1 }}
                >
                  <Badge variant="destructive">
                    {formatDuration(duration)}
                  </Badge>
                </motion.div>
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

          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-muted-foreground">
              Template
            </label>
            <button
              className="flex items-center gap-2 w-full rounded-2xl border border-dashed px-3 py-2 text-sm hover:bg-muted/50 transition-colors disabled:opacity-50"
              onClick={() => setShowTemplatePicker(true)}
              disabled={recorderState === "recording"}
            >
              {selectedTemplate ? (
                <>
                  <TemplateIcon name={selectedTemplate.icon} className="size-4" />
                  <span>{selectedTemplate.name}</span>
                  <span className="text-xs text-muted-foreground ml-auto">{selectedTemplate.sections.length} sections</span>
                </>
              ) : (
                <>
                  <HugeiconsIcon icon={FileCheckIcon} strokeWidth={2} className="size-4 text-muted-foreground" />
                  <span className="text-muted-foreground">No template</span>
                  <span className="text-xs text-muted-foreground ml-auto">Choose a format</span>
                </>
              )}
            </button>
          </div>

          <MeetingTemplateSelector
            selectedId={selectedTemplate?.id}
            onSelect={(tpl) => setSelectedTemplate(tpl)}
            open={showTemplatePicker}
            onOpenChange={setShowTemplatePicker}
          />

          {(brief || isBriefLoading) && (
            <Card className="border-primary/30">
              <CardHeader
                className="cursor-pointer select-none py-3"
                onClick={() => setShowBrief(!showBrief)}
              >
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <HugeiconsIcon icon={AiBrain01Icon} strokeWidth={2} className="size-4 text-primary" />
                    Pre-Meeting Brief
                    {isBriefLoading && (
                      <span className="inline-flex items-center gap-1 text-muted-foreground text-xs font-normal">
                        <div className="size-3 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                        generating...
                      </span>
                    )}
                  </CardTitle>
                  <Button variant="ghost" size="icon-sm" className="size-6" type="button">
                    <HugeiconsIcon icon={showBrief ? ArrowUp01Icon : ArrowDown01Icon} strokeWidth={2} className="size-3.5" />
                  </Button>
                </div>
              </CardHeader>
              {showBrief && brief && (
                <CardContent className="pt-0">
                  <div className="text-sm whitespace-pre-wrap leading-relaxed text-muted-foreground">
                    {brief}
                  </div>
                </CardContent>
              )}
            </Card>
          )}

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

          <AudioBars active={recorderState === "recording"} analyserRef={analyserRef} />

          {error && (
            <div className="text-destructive text-sm font-medium" role="alert">
              {error}
            </div>
          )}

          {recorderState === "idle" && (
            <div className="flex justify-center gap-2">
              <Button variant="outline" size="lg" onClick={handleGenerateBrief} disabled={isBriefLoading}>
                <HugeiconsIcon icon={AiBrain01Icon} strokeWidth={2} data-icon="inline-start" />
                {isBriefLoading ? "Generating..." : "Brief"}
              </Button>
              <motion.div whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }}>
              <Button size="lg" onClick={startRecording}>
                <HugeiconsIcon icon={AiVoiceIcon} strokeWidth={2} data-icon="inline-start" />
                Start Recording
              </Button>
              </motion.div>
            </div>
          )}

          {recorderState === "recording" && (
            <div className="flex justify-center">
              <motion.div
                animate={recorderState === "recording" ? { scale: [1, 1.03, 1] } : {}}
                transition={{ repeat: Infinity, duration: 1.5 }}
              >
              <Button size="lg" variant="destructive" onClick={stopRecording}>
                <HugeiconsIcon icon={StopIcon} strokeWidth={2} data-icon="inline-start" />
                Stop Recording
              </Button>
              </motion.div>
            </div>
          )}

          {(transcript || recorderState === "recording" || recorderState === "reviewing") && (
            <div className="flex flex-col gap-2">
              <label className="text-xs font-medium text-muted-foreground flex items-center gap-2">
                Transcription
                {isTranscribing && (
                  <span className="inline-flex items-center gap-1 text-primary">
                    <div className="size-2 border border-primary border-t-transparent rounded-full animate-spin" />
                    Transcribing...
                  </span>
                )}
                {!isTranscribing && recorderState === "recording" && isSpeaking && (
                  <span className="text-primary inline-flex items-center gap-1">
                    <motion.span
                      className="size-1.5 rounded-full bg-emerald-500"
                      animate={{ opacity: [1, 0.4, 1] }}
                      transition={{ repeat: Infinity, duration: 0.8 }}
                    />
                    speaking
                  </span>
                )}
                {!isTranscribing && recorderState === "recording" && !isSpeaking && (
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
        <>
          {selectedTemplate && (
            <Card>
              <CardContent className="pt-4">
                <NoteEnhancer
                  meeting={{
                    id: "preview",
                    title,
                    date: new Date().toISOString(),
                    duration,
                    transcript: transcript.trim(),
                    notes: notes.trim(),
                    templateId: selectedTemplate?.id,
                    structuredNotes: reviewStructuredNotes ?? undefined,
                  }}
                  onUpdate={(updated) => {
                    if (updated.structuredNotes) setReviewStructuredNotes(updated.structuredNotes)
                    if (updated.enhancedNotes) setReviewEnhancedNotes(updated.enhancedNotes)
                  }}
                />
              </CardContent>
            </Card>
          )}
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
        </>
      )}
    </div>
  )
}

import { useState, useRef, useCallback, useEffect } from "react"
import { motion } from "framer-motion"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
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
import { error as logError } from "@tauri-apps/plugin-log"
import { listen, emit } from "@tauri-apps/api/event"
import { invoke } from "@tauri-apps/api/core"
import {
  AiVoiceIcon,
  StopIcon,
  PlayListAddIcon,
  Mic01Icon,
  Settings02Icon,
  FileCheckIcon,
  ArrowDown01Icon,
  ArrowUp01Icon,
  Cancel01Icon,
  AiMagicIcon,
} from "@hugeicons/core-free-icons"
import { useAudioDevices } from "@/lib/use-audio-devices"
import { MeetingTemplateSelector } from "@/components/meeting-template-selector"
import { NoteEnhancer } from "@/components/note-enhancer"
import { TemplateIcon } from "@/components/template-icon"
import type { Meeting, AppSettings, MeetingTemplate, MeetingSection } from "@/types"

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}:${s.toString().padStart(2, "0")}`
}

const BAR_COUNT = 9

// Level meter driven by the `audio-level` events from the Rust capture loop.
// The backend sends a single RMS value; we shape it across BAR_COUNT bars with a
// center-weighted curve plus a little jitter so the meter feels alive.
function AudioBars({ active, level }: { active: boolean; level: number }) {
  const [levels, setLevels] = useState<number[]>(() => new Array(BAR_COUNT).fill(0))

  useEffect(() => {
    if (!active) {
      setLevels(new Array(BAR_COUNT).fill(0))
      return
    }
    const base = Math.min(1, Math.pow(level * 6, 0.7))
    const mid = (BAR_COUNT - 1) / 2
    setLevels(
      Array.from({ length: BAR_COUNT }, (_, i) => {
        const center = 1 - Math.abs(i - mid) / mid
        const jitter = 0.7 + Math.random() * 0.6
        return base * (0.5 + center * 0.5) * jitter
      })
    )
  }, [active, level])

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
  const [isTranscribing, setIsTranscribing] = useState(false)
  const [isSpeaking, setIsSpeaking] = useState(false)
  const [selectedTemplate, setSelectedTemplate] = useState<MeetingTemplate | undefined>(undefined)
  const [showTemplatePicker, setShowTemplatePicker] = useState(false)
  const [reviewStructuredNotes, setReviewStructuredNotes] = useState<MeetingSection[] | null>(null)
  const [reviewEnhancedNotes, setReviewEnhancedNotes] = useState<string | null>(null)
  const [showOptions, setShowOptions] = useState(false)
  const [quickActionResult, setQuickActionResult] = useState<string | null>(null)
  const [audioLevel, setAudioLevel] = useState(0)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const unlistenRef = useRef<Array<() => void>>([])
  const speakingDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const transcriptRef = useRef("")
  const notesRef = useRef(notes); notesRef.current = notes
  const recorderStateRef = useRef(recorderState)
  recorderStateRef.current = recorderState

  // Mirror transcript/notes into refs so async stop handlers read latest values.
  useEffect(() => { transcriptRef.current = transcript }, [transcript])
  useEffect(() => { notesRef.current = notes }, [notes])

  const {
    devices,
    selectedDevice,
    setSelectedDevice,
    audioSource,
    setAudioSource,
    getDeviceLabel,
  } = useAudioDevices()

  useEffect(() => {
    if (settings.audioSource) setAudioSource(settings.audioSource)
    if (settings.preferredDeviceId && settings.preferredDeviceId !== "default") {
      setSelectedDevice(settings.preferredDeviceId)
    }
  }, [])

  const teardownListeners = useCallback(() => {
    unlistenRef.current.forEach((u) => u())
    unlistenRef.current = []
    if (timerRef.current) {
      clearInterval(timerRef.current)
      timerRef.current = null
    }
    if (speakingDebounceRef.current) {
      clearTimeout(speakingDebounceRef.current)
      speakingDebounceRef.current = null
    }
  }, [])

  const cleanupRecording = useCallback(() => {
    teardownListeners()
    invoke("stop_continuous").catch((e) => logError(String(e)))
    window.dispatchEvent(new CustomEvent("recording-state", { detail: { recording: false } }))
    emit("recording-state", { recording: false }).catch((e) => logError(String(e)))
  }, [teardownListeners])

  const startRecording = useCallback(async () => {
    setError(null)
    setTranscript("")
    transcriptRef.current = ""
    setDuration(0)
    setIsSpeaking(false)
    setAudioLevel(0)

    try {
      // Live transcript segments and level meter come from the Rust capture loop.
      const unTranscript = await listen<{ text: string }>("transcript-segment", (e) => {
        const t = e.payload.text.trim()
        if (!t) return
        setTranscript((prev) => (prev ? prev + "\n" + t : t))
      })
      const unLevel = await listen<{ rms: number }>("audio-level", (e) => {
        const rms = e.payload.rms
        setAudioLevel(rms)
        if (rms > 0.012) {
          if (speakingDebounceRef.current) {
            clearTimeout(speakingDebounceRef.current)
            speakingDebounceRef.current = null
          }
          setIsSpeaking(true)
        } else if (!speakingDebounceRef.current) {
          speakingDebounceRef.current = setTimeout(() => {
            setIsSpeaking(false)
            speakingDebounceRef.current = null
          }, 80)
        }
      })
      const unErr = await listen<{ text: string }>("capture-error", (e) => {
        setError(`Transcription: ${e.payload.text}`)
      })
      unlistenRef.current = [unTranscript, unLevel, unErr]

      await invoke("start_continuous", { language: settings.speechLang === "auto" ? null : settings.speechLang || null, model: settings.asrModel || null, deviceId: settings.preferredDeviceId !== "default" ? getDeviceLabel(settings.preferredDeviceId) : null })

      timerRef.current = setInterval(() => {
        setDuration((d) => d + 1)
      }, 1000)

      setRecorderState("recording")
      window.dispatchEvent(new CustomEvent("recording-state", { detail: { recording: true } }))
      emit("recording-state", { recording: true }).catch((e) => logError(String(e)))
    } catch (err) {
      teardownListeners()
      const msg = err instanceof Error ? err.message : typeof err === "string" ? err : "Failed to start recording"
      setError(msg)
    }
  }, [settings.asrModel, settings.speechLang, teardownListeners])

  const stopRecording = useCallback(async () => {
    teardownListeners()
    setIsSpeaking(false)
    setAudioLevel(0)
    window.dispatchEvent(new CustomEvent("recording-state", { detail: { recording: false } }))
    emit("recording-state", { recording: false }).catch((e) => logError(String(e)))

    setIsTranscribing(true)
    try {
      await invoke("stop_continuous").catch((e) => logError(String(e)))
      // Give the backend a moment to flush + transcribe the trailing segment.
      await new Promise((r) => setTimeout(r, 1200))

      const finalTranscript = transcriptRef.current.trim()
      if (finalTranscript) {
        const { streamGenerateNotes, isAIConfigured } = await import("@/lib/ai-service")
        if (isAIConfigured()) {
          try {
            let streamed = ""
            const gen = streamGenerateNotes(notesRef.current, finalTranscript, selectedTemplate?.sections)
            for await (const chunk of gen) {
              streamed += chunk
              setNotes(streamed)
            }
          } catch {
            // silently fail — AI enhancement is optional
          }
        }
      }
    } finally {
      setIsTranscribing(false)
      setRecorderState("reviewing")
    }
  }, [teardownListeners, selectedTemplate])

  useEffect(() => {
    const handler = () => {
      if (recorderStateRef.current === "recording") {
        stopRecording()
      } else if (recorderStateRef.current === "idle") {
        startRecording()
      }
    }
    window.addEventListener("toggle-recording", handler)
    return () => window.removeEventListener("toggle-recording", handler)
  }, [startRecording, stopRecording])

  const handleSave = useCallback(() => {
    const meeting: Meeting = {
      id: crypto.randomUUID(),
      title: title || `Note ${new Date().toLocaleDateString()}`,
      date: new Date().toISOString(),
      duration,
      transcript: transcript.trim(),
      notes: notes.trim(),
      templateId: selectedTemplate?.id,
      structuredNotes: reviewStructuredNotes ?? undefined,
      enhancedNotes: reviewEnhancedNotes ?? undefined,
    }
    onSave(meeting)
  }, [title, duration, transcript, notes, selectedTemplate, reviewStructuredNotes, reviewEnhancedNotes, onSave])

  useEffect(() => {
    return () => {
      cleanupRecording()
    }
  }, [cleanupRecording])

  useEffect(() => {
    const dirty = title.trim().length > 0 || notes.trim().length > 0 || transcript.trim().length > 0
    window.dispatchEvent(new CustomEvent("recorder-dirty", { detail: { dirty } }))
  }, [title, notes, transcript])

  const handleQuickAction = useCallback(async (prompt: string, label: string) => {
    setQuickActionResult(null)
    try {
      const { executeQuickAction, isAIConfigured } = await import("@/lib/ai-service")
      if (!isAIConfigured()) {
        setError("AI is not configured. Set your API key in Settings.")
        return
      }
      const currentTranscript = transcript || "(no transcript yet — recording in progress)"
      const result = await executeQuickAction(
        currentTranscript,
        notes,
        undefined,
        { label, icon: "AiMagicIcon", prompt }
      )
      setQuickActionResult(result)
    } catch (e) {
      setError((e as Error).message)
    }
  }, [transcript, notes])

  return (
    <div className="flex flex-col h-[calc(100vh-2rem)] w-full max-w-3xl mx-auto">
      <div className="flex items-center justify-between shrink-0 py-3 px-1">
        <div className="flex items-center gap-3 min-w-0">
          {recorderState === "recording" && (
            <motion.div animate={{ opacity: [1, 0.6, 1] }} transition={{ repeat: Infinity, duration: 1 }}>
              <Badge variant="destructive" className="shrink-0">{formatDuration(duration)}</Badge>
            </motion.div>
          )}
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-sm font-medium truncate">{title || "Untitled Note"}</span>
            {recorderState === "recording" && (
              <span className="shrink-0">
                {isSpeaking ? (
                  <span className="text-primary inline-flex items-center gap-1 text-xs">
                    <motion.span className="size-1.5 rounded-full bg-emerald-500" animate={{ opacity: [1, 0.4, 1] }} transition={{ repeat: Infinity, duration: 0.8 }} />
                    speaking
                  </span>
                ) : (
                  <span className="text-muted-foreground inline-flex items-center gap-1 text-xs">
                    <span className="size-1.5 rounded-full bg-muted-foreground" />listening
                  </span>
                )}
              </span>
            )}
            {isTranscribing && (
              <span className="inline-flex items-center gap-1 text-primary text-xs shrink-0">
                <div className="size-2 border border-primary border-t-transparent rounded-full animate-spin" />Transcribing...
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {recorderState === "recording" ? (
            <Button variant="destructive" size="sm" onClick={stopRecording}>
              <HugeiconsIcon icon={StopIcon} strokeWidth={2} data-icon="inline-start" />Stop
            </Button>
          ) : (
            <Button variant="default" size="sm" onClick={startRecording}>
              <HugeiconsIcon icon={AiVoiceIcon} strokeWidth={2} data-icon="inline-start" />Record
            </Button>
          )}
          <Button variant="ghost" size="icon-sm" onClick={onSettings} title="Settings" aria-label="Settings">
            <HugeiconsIcon icon={Settings02Icon} strokeWidth={2} />
          </Button>
          <Button variant="ghost" size="sm" onClick={onCancel}>Back</Button>
        </div>
      </div>

      {recorderState === "reviewing" ? (
        <div className="flex-1 min-h-0 overflow-y-auto flex flex-col gap-4 py-4">
          <div className="flex flex-col gap-2 flex-1">
            <label className="text-xs font-semibold uppercase tracking-wider text-primary flex items-center gap-1.5 shrink-0">
              <HugeiconsIcon icon={AiMagicIcon} strokeWidth={1.5} className="size-3.5" />
              Meeting Notes
            </label>
            <Textarea
              value={notes || ""}
              onChange={(e) => setNotes(e.target.value)}
              className="flex-1 min-h-40 text-sm leading-relaxed resize-none rounded-2xl"
            />
          </div>

          {transcript && (
            <details className="shrink-0">
              <summary className="text-xs font-medium text-muted-foreground cursor-pointer hover:text-foreground transition-colors">View Transcript</summary>
              <Textarea value={transcript} onChange={(e) => setTranscript(e.target.value)} className="min-h-32 text-sm mt-2" />
            </details>
          )}

          {selectedTemplate && (
            <NoteEnhancer
              meeting={{
                id: "preview", title, date: new Date().toISOString(), duration,
                transcript: transcript.trim(), notes: notes.trim(),
                templateId: selectedTemplate?.id,
                structuredNotes: reviewStructuredNotes ?? undefined,
              }}
              onUpdate={(updated) => {
                if (updated.structuredNotes) setReviewStructuredNotes(updated.structuredNotes)
                if (updated.enhancedNotes) setReviewEnhancedNotes(updated.enhancedNotes)
              }}
            />
          )}

          <div className="flex items-center gap-2 justify-end pt-2 shrink-0">
            <Button variant="outline" onClick={() => { setTranscript(""); setDuration(0); startRecording() }}>
              <HugeiconsIcon icon={AiVoiceIcon} strokeWidth={2} data-icon="inline-start" />Record Again
            </Button>
            <Button onClick={handleSave}>
              <HugeiconsIcon icon={PlayListAddIcon} strokeWidth={2} data-icon="inline-start" />Save Meeting
            </Button>
          </div>
        </div>
      ) : (
        <>
          <div className="flex-1 min-h-0 flex flex-col gap-2">
            {recorderState === "recording" && (
              <div className="flex flex-wrap gap-1.5 shrink-0">
                {[
                  { label: "Summarize", prompt: "Summarize what's been discussed so far in 2-3 sentences." },
                  { label: "Action Items", prompt: "List any action items or to-dos mentioned so far." },
                  { label: "Key Points", prompt: "What are the key points discussed so far?" },
                ].map((action) => (
                  <Button key={action.label} variant="outline" size="sm" onClick={() => handleQuickAction(action.prompt, action.label)} className="text-xs h-7">
                    <HugeiconsIcon icon={AiMagicIcon} strokeWidth={1.5} className="size-3.5 mr-1" />{action.label}
                  </Button>
                ))}
              </div>
            )}

            {quickActionResult && (
              <div className="flex flex-col gap-1.5 bg-primary/5 rounded-2xl p-3 border border-primary/10 shrink-0">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-primary flex items-center gap-1">
                    <HugeiconsIcon icon={AiMagicIcon} strokeWidth={1.5} className="size-3" />AI Response
                  </span>
                  <Button variant="ghost" size="icon-sm" className="size-5" onClick={() => setQuickActionResult(null)}>
                    <HugeiconsIcon icon={Cancel01Icon} strokeWidth={2} className="size-3" />
                  </Button>
                </div>
                <div className="text-xs whitespace-pre-wrap leading-relaxed text-foreground max-h-32 overflow-y-auto">{quickActionResult}</div>
              </div>
            )}

            {error && (
              <div className="flex flex-col gap-2 shrink-0" role="alert">
                <div className="text-destructive text-sm font-medium">{error}</div>
              </div>
            )}

            {recorderState === "recording" && (
              <div className="flex flex-col gap-1 shrink-0 max-h-40 overflow-y-auto rounded-2xl border bg-muted/20 p-3">
                <span className="text-xs font-medium text-primary flex items-center gap-1">
                  <HugeiconsIcon icon={AiVoiceIcon} strokeWidth={1.5} className="size-3" />
                  Live Transcript
                </span>
                <p className="text-sm leading-relaxed whitespace-pre-wrap transcript-text text-foreground">
                  {transcript || <span className="text-muted-foreground">Listening… speak and pause; text appears as you go.</span>}
                </p>
              </div>
            )}

            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Start writing your notes..."
              className="flex-1 min-h-0 text-base leading-relaxed resize-none rounded-2xl"
            />

            {recorderState === "recording" && (
              <Input
                placeholder="Add a quick note & press Enter..."
                className="shrink-0"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && e.currentTarget.value.trim()) {
                    setNotes((prev) => (prev ? prev + "\n" + e.currentTarget.value : e.currentTarget.value))
                    e.currentTarget.value = ""
                  }
                }}
              />
            )}
          </div>

          <div className="shrink-0 border-t pt-3">
            <AudioBars active={recorderState === "recording"} level={audioLevel} />
          </div>

          <button
            className="flex items-center gap-2 w-full py-2 text-xs text-muted-foreground hover:text-foreground transition-colors border-t shrink-0"
            onClick={() => setShowOptions(!showOptions)}
          >
            <HugeiconsIcon icon={Settings02Icon} strokeWidth={1.5} className="size-3.5" />
            {selectedTemplate ? `${selectedTemplate.name} · ` : ""}Microphone
            {devices.length > 0 ? ` · ${devices.find((d) => d.deviceId === selectedDevice)?.label || "Default"}` : ""}
            <HugeiconsIcon icon={showOptions ? ArrowUp01Icon : ArrowDown01Icon} strokeWidth={1.5} className="size-3 ml-auto" />
          </button>

          {showOptions && (
            <div className="flex flex-col gap-3 rounded-2xl border p-3 bg-muted/30 shrink-0">
              <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Meeting title..." className="h-8 text-sm" />

              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-muted-foreground">Template</label>
                <button
                  className="flex items-center gap-2 w-full rounded-2xl border border-dashed px-3 py-2 text-sm hover:bg-muted/50 transition-colors"
                  onClick={() => setShowTemplatePicker(true)}
                >
                  {selectedTemplate ? (
                    <><TemplateIcon name={selectedTemplate.icon} className="size-4" /><span>{selectedTemplate.name}</span></>
                  ) : (
                    <><HugeiconsIcon icon={FileCheckIcon} strokeWidth={2} className="size-4 text-muted-foreground" /><span className="text-muted-foreground">No template</span></>
                  )}
                </button>
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-muted-foreground">Audio Source</label>
                <div className="flex gap-2">
                  <Button variant="default" size="sm" className="flex-1" disabled>
                    <HugeiconsIcon icon={Mic01Icon} strokeWidth={2} data-icon="inline-start" />Microphone
                  </Button>
                </div>
              </div>

              {devices.length > 0 && (
                <div className="flex flex-col gap-1">
                  <label className="text-xs font-medium text-muted-foreground">Device</label>
                  <Select value={selectedDevice} onValueChange={setSelectedDevice}>
                    <SelectTrigger size="sm"><SelectValue placeholder="Select device..." /></SelectTrigger>
                    <SelectContent><SelectGroup>{devices.map((d) => (<SelectItem key={d.deviceId} value={d.deviceId}>{d.label}</SelectItem>))}</SelectGroup></SelectContent>
                  </Select>
                </div>
              )}
            </div>
          )}

          <MeetingTemplateSelector
            selectedId={selectedTemplate?.id}
            onSelect={(tpl) => setSelectedTemplate(tpl)}
            open={showTemplatePicker}
            onOpenChange={setShowTemplatePicker}
          />
        </>
      )}
    </div>
  )
}

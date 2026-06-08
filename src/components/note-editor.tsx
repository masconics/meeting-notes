import { useState, useRef, useCallback, useEffect } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { HugeiconsIcon } from "@hugeicons/react"
import {
  AiVoiceIcon,
  Settings02Icon,
  Cancel01Icon, AiMagicIcon,
  AiChat02Icon, ArrowRight01Icon, ArrowLeft01Icon,
  MicIcon, ComputerIcon,
  Calendar01Icon, Clock01Icon,
} from "@hugeicons/core-free-icons"
import { useAudioDevices } from "@/lib/use-audio-devices"
import { error as logError } from "@tauri-apps/plugin-log"
import { listen, emit } from "@tauri-apps/api/event"
import { invoke } from "@tauri-apps/api/core"
import { MeetingTemplateSelector } from "@/components/meeting-template-selector"
import { TemplateIcon } from "@/components/template-icon"
import type { Meeting, AppSettings, MeetingTemplate, ChatMessage } from "@/types"

function createWav(audioBuffer: AudioBuffer): ArrayBuffer {
  const numChannels = 1
  const sampleRate = audioBuffer.sampleRate
  const data = audioBuffer.getChannelData(0)
  const byteRate = sampleRate * numChannels * 16 / 8
  const dataSize = data.length * 2
  const buffer = new ArrayBuffer(44 + dataSize)
  const view = new DataView(buffer)
  const ws = (o: number, s: string) => { for (let i = 0; i < s.length; i++) view.setUint8(o + i, s.charCodeAt(i)) }
  ws(0, "RIFF"); view.setUint32(4, 36 + dataSize, true); ws(8, "WAVE"); ws(12, "fmt ")
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, numChannels, true)
  view.setUint32(24, sampleRate, true); view.setUint32(28, byteRate, true)
  view.setUint16(32, numChannels * 2, true); view.setUint16(34, 16, true)
  ws(36, "data"); view.setUint32(40, dataSize, true)
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

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  })
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
  })
}

const BAR_COUNT = 9

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
    <div className="flex items-end justify-center gap-0.5 h-8" aria-hidden="true">
      {levels.map((lvl, i) => (
        <div key={i} className="w-1 bg-primary rounded-full transition-[height] duration-75 ease-out"
          style={{ height: active ? `${Math.max(6, Math.min(100, lvl * 130))}%` : "14%" }} />
      ))}
    </div>
  )
}

interface NoteEditorProps {
  note?: Meeting
  onSave: (meeting: Meeting) => void
  onCancel: () => void
  onSettings: () => void
  settings: AppSettings
}

type RecorderState = "idle" | "recording" | "reviewing"

export function NoteEditor({ note, onSave, onCancel, onSettings, settings }: NoteEditorProps) {
  const [title, setTitle] = useState(note?.title ?? settings.titlePrefix)
  const [notes, setNotes] = useState(note?.notes ?? "")
  const [transcript, setTranscript] = useState(note?.transcript ?? "")
  const [duration, setDuration] = useState(note?.duration ?? 0)
  const [recorderState, setRecorderState] = useState<RecorderState>("idle")
  const [error, setError] = useState<string | null>(null)
  const [isTranscribing, setIsTranscribing] = useState(false)
  const [isSpeaking, setIsSpeaking] = useState(false)
  const [audioLevel, setAudioLevel] = useState(0)
  const [selectedTemplate, setSelectedTemplate] = useState<MeetingTemplate | undefined>(undefined)
  const [showTemplatePicker, setShowTemplatePicker] = useState(false)
  const [showAIPanel, setShowAIPanel] = useState(false)
  const [aiInput, setAiInput] = useState("")
  const [aiMessages, setAiMessages] = useState<ChatMessage[]>([])
  const [aiStreaming, setAiStreaming] = useState(false)
  const [aiStreamContent, setAiStreamContent] = useState("")
  const [isEnhancing, setIsEnhancing] = useState(false)
  const [isTitling, setIsTitling] = useState(false)
  const [justSaved, setJustSaved] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const unlistenRef = useRef<Array<() => void>>([])
  const transcriptRef = useRef("")
  const notesRef = useRef(notes); notesRef.current = notes
  useEffect(() => { transcriptRef.current = transcript }, [transcript])
  const recorderStateRef = useRef(recorderState); recorderStateRef.current = recorderState
  const abortRef = useRef<AbortController | null>(null)
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const titleRef = useRef(title); titleRef.current = title

  const { devices, selectedDevice, setSelectedDevice, audioSource, setAudioSource } = useAudioDevices()

  useEffect(() => {
    if (settings.audioSource) setAudioSource(settings.audioSource)
    if (settings.preferredDeviceId && settings.preferredDeviceId !== "default") {
      setSelectedDevice(settings.preferredDeviceId)
    }
  }, [])

  const isDirty = title !== (note?.title ?? settings.titlePrefix) ||
    notes !== (note?.notes ?? "") ||
    transcript !== (note?.transcript ?? "")
  const isEmpty = !notes.trim() && !transcript.trim()

  const teardownListeners = useCallback(() => {
    unlistenRef.current.forEach((u) => u())
    unlistenRef.current = []
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null }
  }, [])

  const startRecording = useCallback(async () => {
    setError(null)
    setTranscript("")
    transcriptRef.current = ""
    setDuration(0)
    setIsSpeaking(false)

    try {

      const unTranscript = await listen<{ text: string }>("transcript-segment", (e) => {
        const t = e.payload.text.trim()
        if (!t) return
        setTranscript((prev) => (prev ? prev + "\n" + t : t))
      })
      const unLevel = await listen<{ rms: number }>("audio-level", (e) => {
        const rms = e.payload.rms
        setAudioLevel(rms)
        setIsSpeaking(rms > 0.012)
      })
      const unErr = await listen<{ text: string }>("capture-error", (e) => {
        setError(`Transcription: ${e.payload.text}`)
      })
      unlistenRef.current = [unTranscript, unLevel, unErr]

      await invoke("start_continuous", { language: settings.speechLang === "auto" ? null : settings.speechLang || null, model: settings.asrModel || null })

      timerRef.current = setInterval(() => setDuration(d => d + 1), 1000)
      setRecorderState("recording")
      window.dispatchEvent(new CustomEvent("recording-state", { detail: { recording: true } }))
      emit("recording-state", { recording: true }).catch((e) => logError(String(e)))
    } catch (err) {
      teardownListeners()
      setError(err instanceof Error ? err.message : typeof err === "string" ? err : "Failed to start recording")
    }
  }, [teardownListeners, settings.speechLang, settings.asrModel])

  const stopRecording = useCallback(async () => {
    setRecorderState("idle")
    setIsSpeaking(false)
    setAudioLevel(0)
    setIsTranscribing(true)

    try {
      await invoke("stop_continuous").catch((e) => logError(String(e)))
      await new Promise((r) => setTimeout(r, 800))

      teardownListeners()

      const finalTranscript = transcriptRef.current.trim()
      if (finalTranscript) {
        const { generateNotes, isAIConfigured } = await import("@/lib/ai-service")
        if (isAIConfigured()) {
          try {
            const combinedTranscript = note?.transcript ? note.transcript + "\n\n" + finalTranscript : finalTranscript
            const enhanced = await generateNotes(notesRef.current, combinedTranscript, selectedTemplate?.sections)
            setNotes((prev) => {
              if (prev && enhanced) return prev + "\n\n---\n\n" + enhanced
              return enhanced || prev
            })
          } catch {}
          try {
            const defaultTitle = titleRef.current.trim() === "" || titleRef.current === settings.titlePrefix
            if (defaultTitle) {
              const { generateTitle } = await import("@/lib/ai-service")
              const autoTitle = await generateTitle(finalTranscript, notesRef.current)
              if (autoTitle) setTitle(autoTitle)
            }
          } catch {}
        }
      }
    } finally {
      setIsTranscribing(false)
    }
    window.dispatchEvent(new CustomEvent("recording-state", { detail: { recording: false } }))
    emit("recording-state", { recording: false }).catch((e) => logError(String(e)))
  }, [teardownListeners, selectedTemplate, note])

  const handleEnhance = useCallback(async () => {
    const content = notes.trim() || transcript.trim()
    if (!content) return
    setIsEnhancing(true); setError(null)
    try {
      const { generateNotes, isAIConfigured } = await import("@/lib/ai-service")
      if (!isAIConfigured()) { setError("AI is not configured. Set your API key in Settings."); return }
      const sections = selectedTemplate?.sections
      const sourceText = transcript.trim() || notes.trim()
      const enhanced = await generateNotes(notes, sourceText, sections)
      setNotes(enhanced || notes)
    } catch (e) {
      setError(e instanceof Error ? e.message : "AI enhancement failed")
    } finally { setIsEnhancing(false) }
  }, [notes, transcript, selectedTemplate])

  const handleEnhanceTitle = useCallback(async () => {
    const content = notes.trim() || transcript.trim()
    if (!content) return
    setIsTitling(true); setError(null)
    try {
      const { generateTitle, isAIConfigured } = await import("@/lib/ai-service")
      if (!isAIConfigured()) { setError("AI is not configured. Set your API key in Settings."); return }
      const autoTitle = await generateTitle(transcript, notes)
      if (autoTitle) setTitle(autoTitle)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Title generation failed")
    } finally { setIsTitling(false) }
  }, [notes, transcript])

  useEffect(() => {
    const handler = () => { if (recorderStateRef.current === "recording") stopRecording(); else if (recorderStateRef.current === "idle") startRecording() }
    window.addEventListener("toggle-recording", handler)
    return () => window.removeEventListener("toggle-recording", handler)
  }, [startRecording, stopRecording])

  useEffect(() => () => {
    teardownListeners()
    invoke("stop_continuous").catch((e) => logError(String(e)))
    window.dispatchEvent(new CustomEvent("recording-state", { detail: { recording: false } }))
  }, [teardownListeners])

  useEffect(() => {
    const dirty = title.trim().length > 0 || notes.trim().length > 0 || transcript.trim().length > 0
    window.dispatchEvent(new CustomEvent("recorder-dirty", { detail: { dirty } }))
  }, [title, notes, transcript])

  const handleSave = useCallback(() => {
    const meeting: Meeting = {
      id: note?.id ?? crypto.randomUUID(),
      title: title || `Note ${new Date().toLocaleDateString()}`,
      date: note?.date ?? new Date().toISOString(),
      duration: note ? note.duration + duration : duration,
      transcript: transcript.trim(),
      notes: notes.trim(),
      templateId: selectedTemplate?.id ?? note?.templateId,
      structuredNotes: note?.structuredNotes,
      enhancedNotes: note?.enhancedNotes,
      chatHistory: note?.chatHistory,
      speakerLabels: note?.speakerLabels,
      transcriptSegments: note?.transcriptSegments,
      brief: note?.brief,
    }
    onSave(meeting)
    setJustSaved(true)
    if (savedTimerRef.current) clearTimeout(savedTimerRef.current)
    savedTimerRef.current = setTimeout(() => setJustSaved(false), 2000)
  }, [title, duration, transcript, notes, selectedTemplate, note, onSave])

  const handleAI = useCallback(async (prompt: string) => {
    if (!prompt.trim()) return
    setShowAIPanel(true)
    const msgs: ChatMessage[] = [...aiMessages, { role: "user", content: prompt, timestamp: new Date().toISOString() }]
    setAiMessages(msgs); setAiInput(""); setAiStreaming(true); setAiStreamContent("")
    const controller = new AbortController(); abortRef.current = controller
    try {
      const { streamChatResponse } = await import("@/lib/ai-service")
      const gen = streamChatResponse(msgs, transcript, notes, undefined, controller.signal)
      let assistantContent = ""
      for await (const chunk of gen) {
        assistantContent += chunk
        setAiStreamContent(assistantContent)
      }
      if (assistantContent) {
        setAiMessages([...msgs, { role: "assistant", content: assistantContent, timestamp: new Date().toISOString() }])
      }
    } catch (e) {
      if (!(e instanceof DOMException && e.name === "AbortError")) setError(e instanceof Error ? e.message : "AI error")
    } finally { abortRef.current = null; setAiStreaming(false); setAiStreamContent("") }
  }, [aiMessages, transcript, notes])

  useEffect(() => () => abortRef.current?.abort(), [])

  const hasTranscript = transcript.length > 0

  return (
    <div className="flex flex-col h-full w-full max-w-4xl mx-auto">
      <div data-tauri-drag-region className="flex items-center justify-between shrink-0 px-6 min-h-[40px]">
        <Button variant="ghost" size="icon-sm" onClick={onCancel} className="text-muted-foreground hover:text-foreground" aria-label="Back to dashboard">
          <HugeiconsIcon icon={ArrowLeft01Icon} strokeWidth={2} />
        </Button>
        <div className="flex items-center gap-2 pr-1">
          {isEnhancing && <span className="text-xs text-muted-foreground animate-pulse">Enhancing...</span>}
          {justSaved && <span className="text-xs text-emerald-500 font-medium">Saved</span>}
          {isDirty && !justSaved && <span className="size-1.5 rounded-full bg-amber-400" title="Unsaved changes" />}
          <Button variant="ghost" size="sm" onClick={handleSave} className="text-sm font-medium">Save</Button>
        </div>
      </div>

      <div className="flex-1 min-h-0 flex flex-col px-6">
        <div className="pt-2 pb-6 shrink-0">
          <div className="flex items-center gap-2">
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Untitled"
              aria-label="Note title"
              className="text-[32px] font-bold tracking-tight border-none shadow-none bg-transparent px-0 py-0 h-auto focus-visible:ring-0 placeholder:text-muted-foreground/30 flex-1"
            />
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={handleEnhanceTitle}
              disabled={isTitling || (!notes.trim() && !transcript.trim())}
              className="text-muted-foreground/30 hover:text-muted-foreground shrink-0"
              aria-label="AI generate title"
            >
              {isTitling ? (
                <div className="size-3 border border-muted-foreground/40 border-t-transparent rounded-full animate-spin" />
              ) : (
                <HugeiconsIcon icon={AiMagicIcon} strokeWidth={1.5} className="size-4" />
              )}
            </Button>
          </div>
        </div>

        <div className="flex items-center gap-3 text-xs text-muted-foreground/50 pb-4">
          <span className="inline-flex items-center gap-1">
            <HugeiconsIcon icon={Calendar01Icon} strokeWidth={1.5} className="size-3" />
            {formatDate(note?.date ?? new Date().toISOString())}
          </span>
          <span className="inline-flex items-center gap-1">
            <HugeiconsIcon icon={Clock01Icon} strokeWidth={1.5} className="size-3" />
            {formatTime(note?.date ?? new Date().toISOString())}
          </span>
        </div>

        {error && (
          <div className="mb-6 shrink-0 flex items-start justify-between gap-2 bg-destructive/5 rounded-lg px-3 py-2" role="alert">
            <div className="text-destructive text-sm">{error}</div>
            <div className="flex items-center gap-1 shrink-0">
              <Button variant="ghost" size="icon-sm" onClick={() => setError(null)} aria-label="Dismiss error"><HugeiconsIcon icon={Cancel01Icon} strokeWidth={2} className="size-3" /></Button>
            </div>
          </div>
        )}

        <div className="flex-1 min-h-0 flex flex-col">
          <div className="flex-1 min-h-0 overflow-y-auto">
            <div className="border-b border-border/30 mb-6" />
            <Textarea
              ref={textareaRef}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Start writing..."
              className="min-h-full field-sizing-fixed border-none shadow-none bg-transparent focus-visible:ring-0 text-[17px] placeholder:text-muted-foreground/30 resize-none p-0 leading-relaxed rounded-none"
            />

            {isEmpty && recorderState === "idle" && (
              <div className="flex flex-col items-center gap-4 py-20 text-center">
                <p className="text-base text-muted-foreground/40">Record a meeting or start typing your notes</p>
                <div className="flex items-center gap-3">
                  <Button variant="outline" size="sm" onClick={startRecording} className="text-xs">
                    <HugeiconsIcon icon={AiVoiceIcon} strokeWidth={1.5} className="size-3.5 mr-1.5" />Start Recording
                  </Button>
                  <button onClick={() => setShowTemplatePicker(true)} className="text-xs text-muted-foreground/50 hover:text-muted-foreground transition-colors">
                    Pick a template
                  </button>
                </div>
              </div>
            )}
          </div>

          <AnimatePresence>
            {showAIPanel && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                className="shrink-0 border-t border-border/40 overflow-hidden"
              >
                <div className="flex flex-col gap-3 max-h-64 overflow-y-auto pt-4 pb-2">
                  <div className="flex flex-wrap gap-1.5">
                    {[
                      { label: "Summarize", prompt: "Summarize this note in 2-3 sentences." },
                      { label: "Action Items", prompt: "List all action items or to-dos from this note." },
                      { label: "Key Points", prompt: "Extract the key points as bullet points." },
                      { label: "Next Steps", prompt: "What should the next steps be based on this?" },
                    ].map(a => (
                      <Button key={a.label} variant="ghost" size="sm" onClick={() => handleAI(a.prompt)} disabled={aiStreaming} className="text-xs h-7 text-muted-foreground hover:text-foreground">
                        <HugeiconsIcon icon={AiMagicIcon} strokeWidth={1.5} className="size-3 mr-1" />{a.label}
                      </Button>
                    ))}
                  </div>
                  {aiMessages.map((msg, i) => (
                    <div key={i} className={`text-sm ${msg.role === "user" ? "text-muted-foreground/60 italic" : "text-foreground"} whitespace-pre-wrap leading-relaxed`}>
                      {msg.content}
                    </div>
                  ))}
                  {aiStreaming && <div className="text-sm text-foreground whitespace-pre-wrap leading-relaxed">{aiStreamContent}<motion.span className="inline-block w-1.5 h-4 bg-current ml-0.5 align-middle" animate={{ opacity: [1, 0.4, 1] }} transition={{ repeat: Infinity, duration: 0.8 }} /></div>}
                  <div className="flex items-center gap-2">
                    <Input value={aiInput} onChange={e => setAiInput(e.target.value)} placeholder="Ask anything..."
                      className="flex-1 h-8 text-sm border-none shadow-none bg-transparent focus-visible:ring-0" disabled={aiStreaming}
                      onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); handleAI(aiInput) } }} />
                    <Button variant="ghost" size="icon-sm" onClick={() => handleAI(aiInput)} disabled={!aiInput.trim() || aiStreaming} className="text-muted-foreground" aria-label="Send AI message">
                      <HugeiconsIcon icon={ArrowRight01Icon} strokeWidth={2} />
                    </Button>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {hasTranscript && (
          <details className="mt-6 pb-2 group shrink-0" open={recorderState === "recording" || isTranscribing}>
            <summary className="text-xs font-medium text-muted-foreground/50 cursor-pointer hover:text-muted-foreground transition-colors select-none">Transcript</summary>
            <div className="text-xs mt-2 text-muted-foreground/60 leading-relaxed whitespace-pre-wrap transcript-text max-h-48 overflow-y-auto">{transcript}</div>
          </details>
        )}
      </div>

      <div className="shrink-0 border-t border-border/40 px-6 py-3 flex items-center">
        <div className="flex items-center gap-2">
          {recorderState === "recording" ? (
            <div className="flex items-center gap-3">
              <motion.span animate={{ opacity: [1, 0.6, 1] }} transition={{ repeat: Infinity, duration: 1 }} className="text-xs font-medium text-destructive tabular-nums">{formatDuration(duration)}</motion.span>
              <div className="min-w-16"><AudioBars active={true} level={audioLevel} /></div>
              {isSpeaking ? (
                <span className="text-[11px] text-emerald-500 font-medium">speaking</span>
              ) : (
                <span className="text-[11px] text-muted-foreground/50">listening</span>
              )}
              <Button variant="ghost" size="sm" onClick={stopRecording} className="text-destructive hover:text-destructive h-7 text-xs">Stop</Button>
            </div>
          ) : isTranscribing ? (
            <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground"><div className="size-2 border border-primary border-t-transparent rounded-full animate-spin" />Processing {formatDuration(duration)} recording...</span>
          ) : (
            <>
              <div className="flex items-center rounded-lg bg-muted/50 p-0.5">
                <button
                  className={`text-[11px] px-2 py-1 rounded-md font-medium transition-colors ${audioSource === "mic" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
                  onClick={() => setAudioSource("mic")}
                >
                  <HugeiconsIcon icon={MicIcon} strokeWidth={1.5} className="size-3 mr-1 inline" />Mic
                </button>
                <button
                  className={`text-[11px] px-2 py-1 rounded-md font-medium transition-colors ${audioSource === "system" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
                  onClick={() => setAudioSource("system")}
                >
                  <HugeiconsIcon icon={ComputerIcon} strokeWidth={1.5} className="size-3 mr-1 inline" />System
                </button>
              </div>
              {devices.length > 1 && (
                <select value={selectedDevice} onChange={e => setSelectedDevice(e.target.value)} className="text-[11px] bg-transparent outline-none text-muted-foreground border border-border/40 rounded-md px-1.5 py-1 max-w-[120px] truncate">
                  {devices.map(d => <option key={d.deviceId} value={d.deviceId}>{d.label}</option>)}
                </select>
              )}
              <Button variant="default" size="sm" onClick={startRecording} className="h-7 text-xs">
                <HugeiconsIcon icon={AiVoiceIcon} strokeWidth={1.5} className="size-3.5 mr-1" />Record
              </Button>
              <button
                onClick={() => setShowTemplatePicker(true)}
                className="text-[11px] text-muted-foreground/60 hover:text-muted-foreground transition-colors inline-flex items-center gap-1"
              >
                {selectedTemplate ? <><TemplateIcon name={selectedTemplate.icon} className="size-3" />{selectedTemplate.name}</> : "Template"}
              </button>
            </>
          )}
        </div>

        <div data-tauri-drag-region className="flex-1 self-stretch min-w-4" />

        <div className="flex items-center gap-2">
          {(notes.trim() || transcript.trim()) && (
            <Button variant="ghost" size="sm" onClick={handleEnhance} disabled={isEnhancing} className="text-muted-foreground hover:text-foreground h-7 text-xs">
              <HugeiconsIcon icon={AiMagicIcon} strokeWidth={1.5} className="size-3.5 mr-1" />Enhance
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={() => setShowAIPanel(!showAIPanel)} className={`${showAIPanel ? "text-foreground" : "text-muted-foreground"} hover:text-foreground h-7 text-xs`}>
            <HugeiconsIcon icon={AiChat02Icon} strokeWidth={1.5} className="size-3.5 mr-1" />AI
          </Button>
          <Button variant="ghost" size="icon-sm" onClick={onSettings} className="text-muted-foreground/50 hover:text-muted-foreground" aria-label="Settings">
            <HugeiconsIcon icon={Settings02Icon} strokeWidth={1.5} className="size-4" />
          </Button>
        </div>
      </div>

      <MeetingTemplateSelector selectedId={selectedTemplate?.id} onSelect={tpl => setSelectedTemplate(tpl)} open={showTemplatePicker} onOpenChange={setShowTemplatePicker} />
    </div>
  )
}

import { useState, useRef, useCallback, useEffect, useMemo } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { HugeiconsIcon } from "@hugeicons/react"
import {
  AiVoiceIcon,
  Settings02Icon,
  Cancel01Icon, AiMagicIcon,
  AiChat02Icon, ArrowRight01Icon, ArrowLeft01Icon,
  MicIcon, ComputerIcon,
  Calendar01Icon, Clock01Icon,
  Copy01Icon, Task01Icon, FileAddIcon,
} from "@hugeicons/core-free-icons"
import { useAudioDevices } from "@/lib/use-audio-devices"
import { error as logError } from "@tauri-apps/plugin-log"
import { listen, emit } from "@tauri-apps/api/event"
import { invoke } from "@tauri-apps/api/core"
import { MeetingTemplateSelector } from "@/components/meeting-template-selector"
import { TemplateIcon } from "@/components/template-icon"
import { NoteRenderer } from "@/components/note-renderer"
import { useSelectionMenu } from "@/components/selection-context-menu"
import { getTemplateById, saveTemplate as persistTemplate } from "@/lib/templates"
import type { Meeting, AppSettings, MeetingTemplate, ChatMessage } from "@/types"

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
  meetings: Meeting[]
  onSave: (meeting: Meeting) => void
  onCancel: () => void
  onSettings: () => void
  settings: AppSettings
}

type RecorderState = "idle" | "recording" | "reviewing"

export function NoteEditor({ note, meetings, onSave, onCancel, onSettings, settings }: NoteEditorProps) {
  const [title, setTitle] = useState(note?.title ?? settings.titlePrefix)
  const [notes, setNotes] = useState(note?.notes || note?.transcript || "")
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
  const [actionItems, setActionItems] = useState<string[]>([])
  const [copied, setCopied] = useState(false)
  const [silenceSeconds, setSilenceSeconds] = useState(0)
  const [isStreaming, setIsStreaming] = useState(false)
  const contentRef = useRef<HTMLDivElement>(null)

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const unlistenRef = useRef<Array<() => void>>([])
  const notesRef = useRef(notes); notesRef.current = notes
  const recorderStateRef = useRef(recorderState); recorderStateRef.current = recorderState
  const abortRef = useRef<AbortController | null>(null)
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const titleRef = useRef(title); titleRef.current = title
  const silenceTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const { devices, selectedDevice, setSelectedDevice, audioSource, setAudioSource } = useAudioDevices()

  useEffect(() => {
    if (settings.audioSource) setAudioSource(settings.audioSource)
    if (settings.preferredDeviceId && settings.preferredDeviceId !== "default") {
      setSelectedDevice(settings.preferredDeviceId)
    }
  }, [])

  const relatedMeetings = useMemo(() => {
    if (!title.trim()) return []
    const keywords = title.toLowerCase().split(/\s+/).filter(w => w.length > 2)
    if (keywords.length === 0) return []
    return meetings
      .filter(m => m.id !== note?.id)
      .map(m => {
        const text = `${m.title} ${m.templateId ? getTemplateById(m.templateId)?.name ?? "" : ""}`.toLowerCase()
        const score = keywords.filter(k => text.includes(k)).length
        return { meeting: m, score }
      })
      .filter(r => r.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 3)
      .map(r => r.meeting)
  }, [title, meetings, note?.id])

  const isDirty = title !== (note?.title ?? settings.titlePrefix) ||
    notes !== (note?.notes || note?.transcript || "")
  const isEmpty = !notes.trim()

  const teardownListeners = useCallback(() => {
    unlistenRef.current.forEach((u) => u())
    unlistenRef.current = []
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null }
    if (silenceTimerRef.current) { clearInterval(silenceTimerRef.current); silenceTimerRef.current = null }
  }, [])

  const startRecording = useCallback(async () => {
    setError(null)
    setDuration(0)
    setIsSpeaking(false)
    setSilenceSeconds(0)

    try {
      const unTranscript = await listen<{ text: string; hasBreak?: boolean }>("transcript-segment", (e) => {
        const t = e.payload.text.trim()
        if (!t) return
        setSilenceSeconds(0)
        setNotes((prev) => {
          const prefix = e.payload.hasBreak && prev ? "\n\n" : ""
          return prev ? prev + "\n" + prefix + t : t
        })
      })
      const unLevel = await listen<{ rms: number }>("audio-level", (e) => {
        const rms = e.payload.rms
        setAudioLevel(rms)
        const speaking = rms > 0.012
        setIsSpeaking(speaking)
        if (speaking) setSilenceSeconds(0)
      })
      const unErr = await listen<{ text: string }>("capture-error", (e) => {
        setError(`Transcription: ${e.payload.text}`)
      })
      unlistenRef.current = [unTranscript, unLevel, unErr]

      await invoke("start_continuous", { language: settings.speechLang === "auto" ? null : settings.speechLang || null, model: settings.asrModel || null })

      timerRef.current = setInterval(() => setDuration(d => d + 1), 1000)
      silenceTimerRef.current = setInterval(() => {
        setSilenceSeconds(s => {
          const next = s + 1
          if (next > 120) {
            setRecorderState("idle")
            setIsSpeaking(false)
            setAudioLevel(0)
            invoke("stop_continuous").catch(() => {})
            teardownListeners()
          }
          return next > 120 ? s : next
        })
      }, 1000)

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
    setSilenceSeconds(0)
    setIsTranscribing(true)

    try {
      await invoke("stop_continuous").catch((e) => logError(String(e)))
      await new Promise((r) => setTimeout(r, 800))

      teardownListeners()

      const content = notesRef.current.trim()
      if (content) {
        const { streamGenerateNotes, isAIConfigured } = await import("@/lib/ai-service")
        if (isAIConfigured()) {
          try {
            setIsStreaming(true)
            let streamed = ""
            const gen = streamGenerateNotes(content, content, selectedTemplate?.sections)
            for await (const chunk of gen) {
              streamed += chunk
              setNotes(streamed)
            }
            setIsStreaming(false)
          } catch { setIsStreaming(false) }
          try {
            const defaultTitle = titleRef.current.trim() === "" || titleRef.current === settings.titlePrefix
            if (defaultTitle) {
              const { generateTitle } = await import("@/lib/ai-service")
              const autoTitle = await generateTitle(content, content)
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
  }, [teardownListeners, selectedTemplate, settings.titlePrefix])

  const handleEnhance = useCallback(async () => {
    const content = notes.trim()
    if (!content) return
    setIsEnhancing(true); setError(null)
    try {
      const { streamGenerateNotes, isAIConfigured } = await import("@/lib/ai-service")
      if (!isAIConfigured()) { setError("AI is not configured. Set your API key in Settings."); return }
      const sections = selectedTemplate?.sections
      setIsStreaming(true)
      let streamed = ""
      const gen = streamGenerateNotes(notes, content, sections)
      for await (const chunk of gen) {
        streamed += chunk
        setNotes(streamed)
      }
      setIsStreaming(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : "AI enhancement failed")
    } finally { setIsEnhancing(false); setIsStreaming(false) }
  }, [notes, selectedTemplate])

  const handleEnhanceTitle = useCallback(async () => {
    const content = notes.trim()
    if (!content) return
    setIsTitling(true); setError(null)
    try {
      const { generateTitle, isAIConfigured } = await import("@/lib/ai-service")
      if (!isAIConfigured()) { setError("AI is not configured. Set your API key in Settings."); return }
      const autoTitle = await generateTitle(content, content)
      if (autoTitle) setTitle(autoTitle)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Title generation failed")
    } finally { setIsTitling(false) }
  }, [notes])

  const handleCopyMarkdown = useCallback(async () => {
    let md = ""
    if (title.trim()) md += `# ${title.trim()}\n\n`
    md += notes.trim()
    await navigator.clipboard.writeText(md)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }, [title, notes])

  const handleSaveAsTemplate = useCallback(async () => {
    if (!title.trim()) return
    const sections: string[] = []
    const sectionRegex = /^## (.+)$/gm
    let match: RegExpExecArray | null
    while ((match = sectionRegex.exec(notes)) !== null) {
      sections.push(match[1])
    }
    if (sections.length === 0) {
      sections.push("Key Takeaways", "Next Steps")
    }
    const template: MeetingTemplate = {
      id: crypto.randomUUID(),
      name: title.trim(),
      icon: "FileAddIcon",
      sections,
      quickActions: [
        { label: "What were the key points?", icon: "StarIcon", prompt: "Extract 3-5 key points from this meeting." },
        { label: "List action items", icon: "Task01Icon", prompt: "List all action items or to-dos from this note with owners if mentioned." },
      ],
    }
    persistTemplate(template)
    setSelectedTemplate(template)
    setError("Template saved! You can reuse it from the Template picker.")
    setTimeout(() => setError(null), 3000)
  }, [title, notes])

  const handleExtractActionItems = useCallback(async () => {
    const content = notes.trim()
    if (!content) return
    setError(null)
    try {
      const { isAIConfigured, executeQuickAction } = await import("@/lib/ai-service")
      if (!isAIConfigured()) { setError("AI is not configured."); return }
      const result = await executeQuickAction(
        content,
        content,
        note?.structuredNotes,
        { label: "actions", icon: "", prompt: "Extract all action items and to-dos as a clean checklist using markdown. For each item note who is responsible if mentioned. Return ONLY the checklist, one item per line, in this exact format:\n- [ ] Action item description @Owner Name" }
      )
      setActionItems(result.trim().split("\n").filter(line => line.trim()))
    } catch (e) {
      setError(e instanceof Error ? e.message : "Extraction failed")
    }
  }, [notes])

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
    const dirty = title.trim().length > 0 || notes.trim().length > 0
    window.dispatchEvent(new CustomEvent("recorder-dirty", { detail: { dirty } }))
  }, [title, notes])

  const handleSave = useCallback(() => {
    const meeting: Meeting = {
      id: note?.id ?? crypto.randomUUID(),
      title: title || `Note ${new Date().toLocaleDateString()}`,
      date: note?.date ?? new Date().toISOString(),
      duration: note ? note.duration + duration : duration,
      transcript: "",
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
  }, [title, duration, notes, selectedTemplate, note, onSave])

  const handleAI = useCallback(async (prompt: string) => {
    if (!prompt.trim()) return
    setShowAIPanel(true)
    setActionItems([])
    const msgs: ChatMessage[] = [...aiMessages, { role: "user", content: prompt, timestamp: new Date().toISOString() }]
    setAiMessages(msgs); setAiInput(""); setAiStreaming(true); setAiStreamContent("")
    const controller = new AbortController(); abortRef.current = controller
    try {
      const { streamChatResponse } = await import("@/lib/ai-service")
      const gen = streamChatResponse(msgs, notes, notes, undefined, controller.signal)
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
  }, [aiMessages, notes])

  useEffect(() => () => abortRef.current?.abort(), [])

  const { menuElement } = useSelectionMenu({
    containerRef: contentRef as React.RefObject<HTMLElement>,
    getSelectedText: () => window.getSelection()?.toString().trim() ?? "",
    onInsert: (text) => setNotes((prev) => prev + text),
    onError: (msg) => setError(msg),
  })

  return (
    <main className="flex h-full w-full flex-col bg-background">
      <h1 className="sr-only">{note ? `Edit note: ${note.title}` : "New note"}</h1>
      <div data-tauri-drag-region className="flex min-h-12 shrink-0 items-center justify-between border-b border-border/60 px-3">
        <Button variant="ghost" size="icon" onClick={onCancel} className="text-muted-foreground hover:text-foreground" aria-label="Back to dashboard">
          <HugeiconsIcon icon={ArrowLeft01Icon} strokeWidth={2} />
        </Button>
        <div className="flex items-center gap-2 pr-1">
          {isEnhancing && <span className="text-xs text-muted-foreground animate-pulse">Enhancing...</span>}
          {copied && <span className="text-xs font-medium text-primary">Copied</span>}
          {justSaved && <span className="text-xs font-medium text-primary">Saved</span>}
          {isDirty && !justSaved && <span className="size-1.5 rounded-full bg-muted-foreground" title="Unsaved changes" />}
          <Button variant="ghost" onClick={handleSave}>Save</Button>
        </div>
      </div>

      <div className="mx-auto flex min-h-0 w-full max-w-2xl flex-1 flex-col px-3 sm:px-4">
        <div className="shrink-0 pb-7 pt-7">
          <div className="flex items-center gap-2">
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Untitled"
              aria-label="Note title"
              className="h-auto min-w-0 flex-1 border-none bg-transparent px-0 py-0 text-3xl font-bold leading-tight tracking-tight outline-none placeholder:text-muted-foreground/45 focus-visible:ring-0"
            />
            <Button
              variant="ghost"
              size="icon"
              onClick={handleEnhanceTitle}
              disabled={isTitling || !notes.trim()}
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
          {recorderState === "recording" && silenceSeconds > 30 && (
            <span className="inline-flex items-center gap-1 text-amber-500">
              <HugeiconsIcon icon={AiVoiceIcon} strokeWidth={1.5} className="size-3" />
              Silent {silenceSeconds}s
            </span>
          )}
        </div>

        {relatedMeetings.length > 0 && (
          <div className="mb-4 shrink-0">
            <p className="text-[10px] font-medium text-muted-foreground/40 uppercase tracking-wider mb-1.5">Related</p>
            <div className="flex flex-wrap gap-1.5">
              {relatedMeetings.map(m => (
                <button
                  key={m.id}
                  type="button"
                  className="inline-flex items-center gap-1 rounded-full border border-border/60 px-2.5 py-0.5 text-xs text-muted-foreground hover:border-primary/30 hover:text-foreground transition-colors"
                  onClick={() => {
                    if (note?.id !== m.id) {
                      onSave({ id: note?.id ?? "", title, date: note?.date ?? new Date().toISOString(), duration: note ? note.duration + duration : duration, transcript: "", notes })
                      window.dispatchEvent(new CustomEvent("navigate-meeting", { detail: { id: m.id } }))
                    }
                  }}
                >
                  {m.title}
                </button>
              ))}
            </div>
          </div>
        )}

        {error && (
          <div className="mb-4 shrink-0 flex items-start justify-between gap-2 bg-destructive/5 rounded-lg px-3 py-2" role="alert">
            <div className="text-destructive text-sm">{error}</div>
            <div className="flex items-center gap-1 shrink-0">
              <Button variant="ghost" size="icon" onClick={() => setError(null)} aria-label="Dismiss error"><HugeiconsIcon icon={Cancel01Icon} strokeWidth={2} /></Button>
            </div>
          </div>
        )}

        <div ref={contentRef as React.RefObject<HTMLDivElement>} className="flex-1 min-h-0 flex flex-col">
          <div className="app-scrollbar-hidden flex-1 min-h-0 overflow-y-auto">
            <div className="border-b border-border/30 mb-6" />
            {isStreaming && (
              <div className="flex items-center gap-2 mb-4 text-xs text-primary">
                <div className="size-2 border border-primary border-t-transparent rounded-full animate-spin" />
                Enhancing...
              </div>
            )}
            <div className="min-h-[40vh] pb-20">
              <NoteRenderer content={notes} editable onChange={setNotes} />
            </div>

            {actionItems.length > 0 && (
              <div className="mt-4 mb-4 p-3 rounded-2xl bg-muted/40">
                <p className="text-xs font-medium text-muted-foreground mb-2">Action Items</p>
                <div className="flex flex-col gap-1">
                  {actionItems.map((item, i) => (
                    <label key={i} className="flex items-start gap-2 text-sm cursor-pointer hover:text-foreground transition-colors">
                      <input type="checkbox" className="mt-1 shrink-0" defaultChecked={false} />
                      <span className="text-muted-foreground leading-relaxed">{item.replace(/^-\s*\[ \]\s*/, "")}</span>
                    </label>
                  ))}
                </div>
              </div>
            )}

            {isEmpty && recorderState === "idle" && (
              <div className="flex flex-col items-center gap-4 py-20 text-center">
                <p className="text-base text-muted-foreground">Record a meeting or start typing your notes</p>
                <div className="flex items-center gap-3">
                  <Button variant="outline" onClick={startRecording}>
                    <HugeiconsIcon icon={AiVoiceIcon} strokeWidth={1.5} data-icon="inline-start" />Start Recording
                  </Button>
                  <Button variant="ghost" onClick={() => setShowTemplatePicker(true)}>
                    Pick a template
                  </Button>
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
                <div className="app-scrollbar-hidden flex flex-col gap-3 max-h-64 overflow-y-auto pt-4 pb-2">
                  <div className="flex flex-wrap gap-1.5">
                    {[
                      { label: "Summarize", prompt: "Summarize this note in 2-3 sentences. Use markdown with bold for key points." },
                      { label: "Draft email", prompt: "Draft a professional follow-up email based on this meeting. Include a thank you, recap of key points discussed, any action items, and next steps. Use markdown formatting with headings, bullet points, and bold." },
                      { label: "Action items", prompt: "List all action items or to-dos from this note with owners if mentioned. Use markdown — each item as \"- [ ] Item @Owner\"." },
                      { label: "Key decisions", prompt: "Extract all key decisions made during this meeting. List each decision clearly using markdown bullet points with bold for the decision and any context. Use markdown." },
                      { label: "Key points", prompt: "Extract the key points as bullet points using markdown. Use bold for important terms." },
                      { label: "Next steps", prompt: "What should the next steps be based on this? Use markdown — numbered list with bold for action owners." },
                    ].map(a => (
                      <Button key={a.label} variant="ghost" size="sm" onClick={() => handleAI(a.prompt)} disabled={aiStreaming} className="text-muted-foreground hover:text-foreground">
                        <HugeiconsIcon icon={AiMagicIcon} strokeWidth={1.5} data-icon="inline-start" />{a.label}
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
                    <Button variant="ghost" size="icon" onClick={() => handleAI(aiInput)} disabled={!aiInput.trim() || aiStreaming} className="text-muted-foreground" aria-label="Send AI message">
                      <HugeiconsIcon icon={ArrowRight01Icon} strokeWidth={2} />
                    </Button>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-3 border-t border-border/60 bg-card/70 px-3 py-3 backdrop-blur">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          {recorderState === "recording" ? (
            <div className="flex items-center gap-3">
              <motion.span animate={{ opacity: [1, 0.6, 1] }} transition={{ repeat: Infinity, duration: 1 }} className="text-xs font-medium text-destructive tabular-nums">{formatDuration(duration)}</motion.span>
              <div className="min-w-16"><AudioBars active={true} level={audioLevel} /></div>
              {isSpeaking ? (
                <span className="text-xs font-medium text-primary">speaking</span>
              ) : (
                <span className="text-xs text-muted-foreground/60">
                  {silenceSeconds > 10 ? `silence ${silenceSeconds}s` : "listening"}
                </span>
              )}
              <Button variant="ghost" size="sm" onClick={stopRecording} className="text-destructive hover:text-destructive">Stop</Button>
            </div>
          ) : isTranscribing ? (
            <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground"><div className="size-2 border border-primary border-t-transparent rounded-full animate-spin" />Processing {formatDuration(duration)} recording...</span>
          ) : (
            <>
              <div className="app-control-strip">
                <button
                  className="app-control-item"
                  data-active={audioSource === "mic"}
                  onClick={() => setAudioSource("mic")}
                >
                  <HugeiconsIcon icon={MicIcon} strokeWidth={1.5} className="size-3 mr-1 inline" />Mic
                </button>
                <button
                  className="app-control-item"
                  data-active={audioSource === "system"}
                  onClick={() => setAudioSource("system")}
                >
                  <HugeiconsIcon icon={ComputerIcon} strokeWidth={1.5} className="size-3 mr-1 inline" />System
                </button>
              </div>
              {devices.length > 1 && (
                <select value={selectedDevice} onChange={e => setSelectedDevice(e.target.value)} className="h-8 max-w-[160px] truncate rounded-2xl border border-border bg-background px-2.5 text-sm text-muted-foreground outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30">
                  {devices.map(d => <option key={d.deviceId} value={d.deviceId}>{d.label}</option>)}
                </select>
              )}
              <Button variant="default" onClick={startRecording}>
                <HugeiconsIcon icon={AiVoiceIcon} strokeWidth={1.5} data-icon="inline-start" />Record
              </Button>
              <Button
                variant="ghost"
                onClick={() => setShowTemplatePicker(true)}
              >
                {selectedTemplate ? <><TemplateIcon name={selectedTemplate.icon} className="size-3" />{selectedTemplate.name}</> : "Template"}
              </Button>
            </>
          )}
        </div>

        <div data-tauri-drag-region className="min-w-4 flex-1 self-stretch" />

        <div className="flex items-center gap-2">
          {notes.trim() && !isEmpty && (
            <>
              <Button variant="ghost" size="sm" onClick={handleCopyMarkdown} className="text-muted-foreground hover:text-foreground">
                <HugeiconsIcon icon={Copy01Icon} strokeWidth={1.5} data-icon="inline-start" />Copy MD
              </Button>
              <Button variant="ghost" size="sm" onClick={handleExtractActionItems} className="text-muted-foreground hover:text-foreground">
                <HugeiconsIcon icon={Task01Icon} strokeWidth={1.5} data-icon="inline-start" />Actions
              </Button>
              <Button variant="ghost" size="sm" onClick={handleSaveAsTemplate} className="text-muted-foreground hover:text-foreground">
                <HugeiconsIcon icon={FileAddIcon} strokeWidth={1.5} data-icon="inline-start" />Save Tmpl
              </Button>
            </>
          )}
          {notes.trim() && (
            <Button variant="ghost" onClick={handleEnhance} disabled={isEnhancing} className="text-muted-foreground hover:text-foreground">
              <HugeiconsIcon icon={AiMagicIcon} strokeWidth={1.5} data-icon="inline-start" />Enhance
            </Button>
          )}
          <Button variant="ghost" onClick={() => { setShowAIPanel(!showAIPanel); setActionItems([]) }} className={`${showAIPanel ? "text-foreground" : "text-muted-foreground"} hover:text-foreground`}>
            <HugeiconsIcon icon={AiChat02Icon} strokeWidth={1.5} data-icon="inline-start" />AI
          </Button>
          <Button variant="ghost" size="icon" onClick={onSettings} className="text-muted-foreground/50 hover:text-muted-foreground" aria-label="Settings">
            <HugeiconsIcon icon={Settings02Icon} strokeWidth={1.5} />
          </Button>
        </div>
      </div>

      <MeetingTemplateSelector selectedId={selectedTemplate?.id} onSelect={tpl => setSelectedTemplate(tpl)} open={showTemplatePicker} onOpenChange={setShowTemplatePicker} />
      {menuElement}
    </main>
  )
}

import { useState, useRef, useCallback, useEffect, useMemo } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { HugeiconsIcon } from "@hugeicons/react"
import {
  AiVoiceIcon,
  Settings02Icon,
  Cancel01Icon, AiMagicIcon,
  AiChat02Icon, ArrowRight01Icon, ArrowLeft01Icon,
  MicIcon, ComputerIcon,
  Calendar01Icon, Clock01Icon,
  Copy01Icon, FileAddIcon, CodeIcon,
  StopIcon, AlertCircleIcon, RefreshIcon,
  UserAdd02Icon, Add01Icon,
} from "@hugeicons/core-free-icons"
import { useAudioDevices } from "@/lib/use-audio-devices"
import { MeetingTemplateSelector } from "@/components/meeting-template-selector"
import { TemplateIcon } from "@/components/template-icon"
import { NoteRenderer } from "@/components/note-renderer"
import { MarkdownView } from "@/components/markdown-view"
import { Waveform } from "@/components/Waveform"
import { useRecording } from "@/lib/use-recording"
import { saveTemplate as persistTemplate } from "@/lib/templates"
import { saveMeetings, loadMeetings } from "@/lib/storage"
import { useChat } from "@/lib/use-chat"
import { cn } from "@/lib/utils"
import type { Meeting, AppSettings, MeetingTemplate, ChatMessage, SpeakerLabel } from "@/types"
import { findRelatedMeetings } from "@/lib/context-memory"

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

const SUGGESTED_QUESTIONS = [
  "What were the key decisions made?",
  "List all action items with owners",
  "What was their budget?",
  "What objections or concerns were raised?",
  "Summarize the main points in 3 sentences",
  "What are the next steps?",
]

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
  const [recorderState, setRecorderState] = useState<RecorderState>("idle")
  const [error, setError] = useState<string | null>(null)
  const [isTranscribing, setIsTranscribing] = useState(false)
  const [selectedTemplate, setSelectedTemplate] = useState<MeetingTemplate | undefined>(undefined)
  const [showTemplatePicker, setShowTemplatePicker] = useState(false)
  const [showAIPanel, setShowAIPanel] = useState(false)
  const [isEnhancing, setIsEnhancing] = useState(false)
  const [isTitling, setIsTitling] = useState(false)
  const [justSaved, setJustSaved] = useState(false)
  const [copied, setCopied] = useState(false)
  const [isStreaming, setIsStreaming] = useState(false)
  const [viewMode, setViewMode] = useState<"wysiwyg" | "source">("wysiwyg")
  const [isPaused, setIsPaused] = useState(false)
  const [rawTranscript, setRawTranscript] = useState(note?.transcript || "")
  const [showRawTranscript, setShowRawTranscript] = useState(false)
  const [chatWidth, setChatWidth] = useState(360)

  const [speakerLabels, setSpeakerLabels] = useState<SpeakerLabel[]>(note?.speakerLabels ?? [])
  const [isAddingSpeaker, setIsAddingSpeaker] = useState(false)
  const [newSpeakerName, setNewSpeakerName] = useState("")

  const SPEAKER_COLORS = [
    "bg-blue-500/20 text-blue-700 border-blue-500/30",
    "bg-amber-500/20 text-amber-700 border-amber-500/30",
    "bg-emerald-500/20 text-emerald-700 border-emerald-500/30",
    "bg-violet-500/20 text-violet-700 border-violet-500/30",
    "bg-rose-500/20 text-rose-700 border-rose-500/30",
    "bg-cyan-500/20 text-cyan-700 border-cyan-500/30",
  ]

  const resizeRef = useRef(false)
  const chatPanelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handleMove = (e: MouseEvent) => {
      if (!resizeRef.current) return
      const panel = chatPanelRef.current
      if (!panel) return
      const parentRect = panel.parentElement?.getBoundingClientRect()
      if (!parentRect) return
      const w = Math.max(280, Math.min(parentRect.right - e.clientX, 600))
      setChatWidth(w)
      panel.style.width = `${w}px`
    }
    const handleUp = () => { resizeRef.current = false; document.body.style.cursor = ""; document.body.style.userSelect = "" }
    document.addEventListener("mousemove", handleMove)
    document.addEventListener("mouseup", handleUp)
    return () => {
      document.removeEventListener("mousemove", handleMove)
      document.removeEventListener("mouseup", handleUp)
    }
  }, [])

  const notesRef = useRef(notes); notesRef.current = notes
  const recorderStateRef = useRef(recorderState); recorderStateRef.current = recorderState
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const titleRef = useRef(title); titleRef.current = title
  const enhancedNotesRef = useRef<string>("")
  const previousNotesRef = useRef<string>("")
  const chatHistoryRef = useRef<ChatMessage[]>(note?.chatHistory ?? [])

  const { devices, selectedDevice, setSelectedDevice, audioSource, setAudioSource } = useAudioDevices()

  useEffect(() => {
    if (settings.audioSource) setAudioSource(settings.audioSource)
    if (settings.preferredDeviceId && settings.preferredDeviceId !== "default") {
      setSelectedDevice(settings.preferredDeviceId)
    }
  }, [])

  const onSilenceLimit = useCallback(() => setRecorderState("idle"), [])
  const {
    audioLevel,
    isSpeaking,
    duration,
    silenceSeconds,
    start: startCapture,
    stop: stopCapture,
    pause: pauseCapture,
    resume: resumeCapture,
    abort: abortCapture,
  } = useRecording({
    audioSource,
    speechLang: settings.speechLang,
    setText: setNotes,
    onError: setError,
    silenceLimitSecs: 120,
    onSilenceLimit,
  })

  const relatedMeetings = useMemo(() => {
    if (!note) return []
    return findRelatedMeetings(note, meetings, 3)
      .map(r => meetings.find(m => m.id === r.meetingId))
      .filter((m): m is Meeting => Boolean(m))
  }, [note, meetings])

  const isDirty = title !== (note?.title ?? settings.titlePrefix) ||
    notes !== (note?.notes || note?.transcript || "")
  const isEmpty = !notes.trim()

  const chatMeeting = useMemo<Meeting>(() => ({
    id: note?.id ?? "",
    title,
    date: note?.date ?? new Date().toISOString(),
    duration: note?.duration ?? 0,
    transcript: rawTranscript || note?.transcript || "",
    notes,
    chatHistory: chatHistoryRef.current,
  }), [title, notes, rawTranscript, note?.id, note?.date, note?.duration, note?.transcript])

  const chatOnUpdate = useCallback((updated: Meeting) => {
    chatHistoryRef.current = updated.chatHistory ?? []
  }, [])

  const {
    messages,
    input: chatInput,
    setInput: setChatInput,
    streaming: chatStreaming,
    error: chatError,
    copiedIdx,
    scrollRef: chatScrollRef,
    sendMessage,
    stopStreaming: stopChatStreaming,
    retryLast,
    copyMessage,
    lastIsStreaming,
  } = useChat(chatMeeting, chatOnUpdate, meetings)

  const startRecording = useCallback(async () => {
    setError(null)
    setIsPaused(false)
    try {
      await startCapture()
      setRecorderState("recording")
    } catch {
      // useRecording already surfaced the error via onError.
    }
  }, [startCapture])

  const pauseRecording = useCallback(async () => {
    setIsPaused(true)
    await pauseCapture()
  }, [pauseCapture])

  const resumeRecording = useCallback(async () => {
    setIsPaused(false)
    try {
      await resumeCapture()
    } catch {
      // useRecording already surfaced the error via onError.
    }
  }, [resumeCapture])

  const autoDetectSpeakers = useCallback(async (transcript: string) => {
    if (speakerLabels.length > 0) return
    try {
      const { detectSpeakers, isAIConfigured } = await import("@/lib/ai-service")
      if (!isAIConfigured()) return
      const names = await detectSpeakers(transcript)
      if (names.length > 0) {
        setSpeakerLabels((prev) => {
          const existing = new Set(prev.map((s) => s.name.toLowerCase()))
          const newLabels = names
            .filter((n) => !existing.has(n.toLowerCase()))
            .map((name, i) => ({
              name,
              color: SPEAKER_COLORS[(prev.length + i) % SPEAKER_COLORS.length],
            }))
          return [...prev, ...newLabels]
        })
      }
    } catch { /* silent */ }
  }, [speakerLabels.length])

  const stopRecording = useCallback(async () => {
    setRecorderState("idle")
    setIsPaused(false)
    setIsTranscribing(true)

    try {
      await stopCapture(800)

      // The live transcript is written directly — no automatic AI rewrite of the
      // note text. Enhancement stays opt-in via the Enhance button.
      const content = notesRef.current.trim()
      if (content) {
        setRawTranscript(content)
        previousNotesRef.current = notesRef.current

        const { isAIConfigured } = await import("@/lib/ai-service")
        if (isAIConfigured()) {
          try {
            const defaultTitle = titleRef.current.trim() === "" || titleRef.current === settings.titlePrefix
            if (defaultTitle) {
              const { generateTitle } = await import("@/lib/ai-service")
              const autoTitle = await generateTitle(content, content)
              if (autoTitle) setTitle(autoTitle)
            }
          } catch { /* ignore title generation failure */ }
        }
        autoDetectSpeakers(content)
      }
    } finally {
      setIsTranscribing(false)
    }
  }, [stopCapture, settings.titlePrefix, autoDetectSpeakers])

  const handleEnhance = useCallback(async () => {
    const content = notes.trim()
    if (!content) return
    previousNotesRef.current = notesRef.current
    setIsEnhancing(true); setError(null)
    try {
      const { streamGenerateNotes, isAIConfigured } = await import("@/lib/ai-service")
      if (!isAIConfigured()) { setError("AI is not configured. Set your API key in Settings."); return }
      const sections = selectedTemplate?.sections
      setIsStreaming(true)
      let streamed = ""
      const gen = streamGenerateNotes(content, content, sections)
      for await (const chunk of gen) {
        streamed += chunk
        setNotes(streamed)
      }
      enhancedNotesRef.current = streamed
      setIsStreaming(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : "AI enhancement failed")
    } finally { setIsEnhancing(false); setIsStreaming(false) }

    autoDetectSpeakers(content)
  }, [notes, selectedTemplate, autoDetectSpeakers])

  const handleUndoEnhance = useCallback(() => {
    if (!previousNotesRef.current) return
    setNotes(previousNotesRef.current)
    notesRef.current = previousNotesRef.current
    previousNotesRef.current = ""
  }, [])

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

  const handleAddSpeaker = useCallback(() => {
    if (!newSpeakerName.trim()) return
    const colorIdx = speakerLabels.length % SPEAKER_COLORS.length
    setSpeakerLabels([...speakerLabels, { name: newSpeakerName.trim(), color: SPEAKER_COLORS[colorIdx] }])
    setNewSpeakerName("")
    setIsAddingSpeaker(false)
  }, [newSpeakerName, speakerLabels])

  const handleRemoveSpeaker = useCallback((idx: number) => {
    setSpeakerLabels(speakerLabels.filter((_, i) => i !== idx))
  }, [speakerLabels])

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

  const handleSave = useCallback(() => {
    const meeting: Meeting = {
      id: note?.id ?? crypto.randomUUID(),
      title: title || `Note ${new Date().toLocaleDateString()}`,
      date: note?.date ?? new Date().toISOString(),
      duration: (note?.duration ?? 0) + duration,
      transcript: rawTranscript || note?.transcript || "",
      notes: notes.trim(),
      templateId: selectedTemplate?.id ?? note?.templateId,
      structuredNotes: note?.structuredNotes,
      enhancedNotes: note?.enhancedNotes,
      chatHistory: chatHistoryRef.current.length > 0 ? chatHistoryRef.current : note?.chatHistory,
      speakerLabels: speakerLabels.length > 0 ? speakerLabels : note?.speakerLabels,
      transcriptSegments: note?.transcriptSegments,
      brief: note?.brief,
    }
    onSave(meeting)
    setJustSaved(true)
    if (savedTimerRef.current) clearTimeout(savedTimerRef.current)
    savedTimerRef.current = setTimeout(() => setJustSaved(false), 2000)
  }, [title, duration, notes, selectedTemplate, note, onSave, rawTranscript])

  const handleSaveAndNew = useCallback(() => {
    const meetings = loadMeetings()
    const meeting: Meeting = {
      id: note?.id ?? crypto.randomUUID(),
      title: title || `Note ${new Date().toLocaleDateString()}`,
      date: note?.date ?? new Date().toISOString(),
      duration: (note?.duration ?? 0) + duration,
      transcript: rawTranscript || note?.transcript || "",
      notes: notes.trim(),
      templateId: selectedTemplate?.id ?? note?.templateId,
      structuredNotes: note?.structuredNotes,
      enhancedNotes: note?.enhancedNotes,
      chatHistory: chatHistoryRef.current.length > 0 ? chatHistoryRef.current : note?.chatHistory,
      speakerLabels: speakerLabels.length > 0 ? speakerLabels : note?.speakerLabels,
      transcriptSegments: note?.transcriptSegments,
      brief: note?.brief,
    }
    const updated = note?.id
      ? meetings.map(m => m.id === note.id ? meeting : m)
      : [...meetings, meeting]
    saveMeetings(updated)
    setTitle(settings.titlePrefix)
    setNotes("")
    setRawTranscript("")
    setShowRawTranscript(false)
    setSelectedTemplate(undefined)
    notesRef.current = ""
    enhancedNotesRef.current = ""
    previousNotesRef.current = ""
    chatHistoryRef.current = []
    setRecorderState("idle")
    setIsPaused(false)
    setError(null)
    setJustSaved(true)
    if (savedTimerRef.current) clearTimeout(savedTimerRef.current)
    savedTimerRef.current = setTimeout(() => setJustSaved(false), 2000)
  }, [title, duration, notes, selectedTemplate, note, settings.titlePrefix, rawTranscript])

  useEffect(() => {
    const handler = () => { if (recorderStateRef.current === "recording") stopRecording(); else if (recorderStateRef.current === "idle") startRecording() }
    window.addEventListener("toggle-recording", handler)
    return () => window.removeEventListener("toggle-recording", handler)
  }, [startRecording, stopRecording])

  useEffect(() => () => {
    abortCapture()
  }, [abortCapture])

  useEffect(() => {
    const originalTitle = note?.title ?? settings.titlePrefix
    const originalNotes = note?.notes || note?.transcript || ""
    const titleChanged = title !== originalTitle
    const notesChanged = notes !== originalNotes
    const dirty = titleChanged || notesChanged
    window.dispatchEvent(new CustomEvent("recorder-dirty", { detail: { dirty } }))
  }, [title, notes, note?.title, note?.notes, note?.transcript, settings.titlePrefix])

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
          <Button variant="ghost" onClick={handleSaveAndNew}>Save & New</Button>
          <Button variant="ghost" onClick={handleSave}>Save</Button>
        </div>
      </div>

      <div className="flex min-h-0 w-full flex-1 flex-col px-6 sm:px-8 lg:px-12">
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

        <div className="flex items-center gap-2 flex-wrap pb-4">
          {speakerLabels.map((label, i) => (
            <span key={i} className={cn("inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border", label.color)}>
              <span className="size-1.5 rounded-full bg-current opacity-60 shrink-0" />
              {label.name}
              <button type="button" onClick={() => handleRemoveSpeaker(i)} className="p-0.5 rounded-full hover:bg-black/10 transition-colors">
                <HugeiconsIcon icon={Cancel01Icon} strokeWidth={2} className="size-2.5" />
              </button>
            </span>
          ))}
          {isAddingSpeaker ? (
            <div className="flex items-center gap-1">
              <Input value={newSpeakerName} onChange={(e) => setNewSpeakerName(e.target.value)} placeholder="Name" className="h-7 w-24 text-xs" autoFocus
                onKeyDown={(e) => { if (e.key === "Enter") handleAddSpeaker(); if (e.key === "Escape") { setIsAddingSpeaker(false); setNewSpeakerName("") } }} />
              <Button size="icon-sm" variant="ghost" onClick={handleAddSpeaker}><HugeiconsIcon icon={Add01Icon} strokeWidth={2} /></Button>
              <Button size="icon-sm" variant="ghost" onClick={() => { setIsAddingSpeaker(false); setNewSpeakerName("") }}><HugeiconsIcon icon={Cancel01Icon} strokeWidth={2} /></Button>
            </div>
          ) : (
            <Button variant="ghost" size="sm" onClick={() => setIsAddingSpeaker(true)} className="text-muted-foreground hover:text-foreground">
              <HugeiconsIcon icon={UserAdd02Icon} strokeWidth={1.5} data-icon="inline-start" />Add Speaker
            </Button>
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
                      onSave({ id: note?.id ?? "", title, date: note?.date ?? new Date().toISOString(), duration: (note?.duration ?? 0) + duration, transcript: "", notes })
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

        <div className={cn("flex-1 min-h-0 flex", showAIPanel && "flex-row")}>
          <div className="flex-1 min-w-0 flex flex-col">
            <div className="app-scrollbar-hidden flex flex-1 min-h-0 flex-col overflow-y-auto">
            <div className="border-b border-border/30 mb-6" />
            {isStreaming && (
              <div className="flex items-center gap-2 mb-4 text-xs text-primary">
                <div className="size-2 border border-primary border-t-transparent rounded-full animate-spin" />
                Enhancing...
              </div>
            )}

            {rawTranscript && (
              <div className="mb-4">
                <button
                  onClick={() => setShowRawTranscript(!showRawTranscript)}
                  className="text-xs text-muted-foreground hover:text-foreground transition-colors inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-border/60 hover:border-primary/30"
                >
                  <HugeiconsIcon icon={CodeIcon} strokeWidth={1.5} className="size-3" />
                  {showRawTranscript ? "Show Enhanced Notes" : "Show Original Transcript"}
                </button>
              </div>
            )}

            <div className={`flex min-h-0 flex-1 flex-col ${viewMode === "source" ? "pb-0" : "pb-20"}`}>
                {showRawTranscript && rawTranscript ? (
                  <pre className="flex-1 min-h-0 whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground overflow-y-auto" style={{ fontFamily: "inherit" }}>{rawTranscript}</pre>
                ) : (
                  <NoteRenderer
                    content={notes}
                    editable
                    onChange={setNotes}
                    viewMode={viewMode}
                  />
                )}
              </div>

              {isEmpty && recorderState === "idle" && viewMode !== "source" && (
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
          </div>

          <AnimatePresence initial={false}>
            {showAIPanel && (
              <motion.div
                ref={chatPanelRef}
                initial={{ width: 0 }}
                animate={{ width: chatWidth }}
                exit={{ width: 0 }}
                transition={{ duration: 0.2, ease: "easeOut" }}
                className="shrink-0 overflow-hidden border-l border-border/40 flex flex-col relative"
              >
                <div
                  className="absolute left-0 top-0 bottom-0 w-2 z-10 cursor-col-resize hover:bg-primary/30 active:bg-primary/50 -ml-1"
                  onMouseDown={(e) => {
                    e.preventDefault()
                    resizeRef.current = true
                    document.body.style.cursor = "col-resize"
                    document.body.style.userSelect = "none"
                  }}
                />
                <div className="flex items-center justify-between px-4 py-3 border-b border-border/40 shrink-0">
                  <span className="text-sm font-medium flex items-center gap-2">
                    <HugeiconsIcon icon={AiChat02Icon} strokeWidth={2} className="size-4" />
                    AI Chat
                  </span>
                  <Button variant="ghost" size="icon-sm" onClick={() => setShowAIPanel(false)} aria-label="Close AI panel">
                    <HugeiconsIcon icon={Cancel01Icon} strokeWidth={2} />
                  </Button>
                </div>
                <div className="flex-1 min-h-0 flex flex-col">
                  <div ref={chatScrollRef} className="flex-1 overflow-y-auto px-4 py-3 flex flex-col gap-3">
                    {messages.length === 0 && (
                      <div className="flex flex-col gap-2">
                        <p className="text-xs text-muted-foreground">Suggested questions</p>
                        {SUGGESTED_QUESTIONS.map((q) => (
                          <button
                            key={q}
                            className="text-sm text-left px-3 py-2 rounded-2xl border border-dashed hover:bg-muted/50 hover:border-border transition-colors disabled:opacity-50"
                            onClick={() => sendMessage(q)}
                            disabled={chatStreaming}
                          >
                            {q}
                          </button>
                        ))}
                      </div>
                    )}
                    {messages.map((msg, i) => {
                      const isLast = i === messages.length - 1
                      return (
                        <div
                          key={i}
                          className={`group flex flex-col gap-1 ${msg.role === "user" ? "items-end" : "items-start"}`}
                        >
                          {msg.role === "user" ? (
                            <div className="max-w-[85%] rounded-2xl rounded-br-md px-3 py-2 text-sm whitespace-pre-wrap break-words bg-primary text-primary-foreground">
                              {msg.content}
                            </div>
                          ) : (
                            <div className="max-w-[85%] rounded-2xl rounded-bl-md px-3 py-2 bg-muted">
                              <MarkdownView markdown={msg.content || (isLast && lastIsStreaming ? "" : "")} />
                              {isLast && lastIsStreaming && (
                                <span className="inline-block w-1.5 h-4 bg-current ml-0.5 animate-pulse align-middle" />
                              )}
                            </div>
                          )}
                          {msg.role === "assistant" && msg.content && !(isLast && lastIsStreaming) && (
                            <button
                              onClick={() => copyMessage(msg.content, i)}
                              className="text-[11px] text-muted-foreground/50 hover:text-foreground inline-flex items-center gap-1"
                            >
                              {copiedIdx === i ? (
                                <span className="text-emerald-500">Copied</span>
                              ) : (
                                <>
                                  <HugeiconsIcon icon={Copy01Icon} strokeWidth={2} className="size-3" />
                                  Copy
                                </>
                              )}
                            </button>
                          )}
                        </div>
                      )
                    })}
                    {chatError && (
                      <div className="flex flex-col items-center gap-2 py-2">
                        <div className="text-destructive text-sm text-center inline-flex items-center gap-1.5" role="alert">
                          <HugeiconsIcon icon={AlertCircleIcon} strokeWidth={2} className="size-4" />
                          {chatError}
                        </div>
                        <Button variant="outline" size="sm" onClick={retryLast}>
                          <HugeiconsIcon icon={RefreshIcon} strokeWidth={2} data-icon="inline-start" />
                          Retry
                        </Button>
                      </div>
                    )}
                  </div>
                  <div className="shrink-0 p-3 border-t border-border flex items-end gap-2">
                    <Input
                      value={chatInput}
                      onChange={(e) => setChatInput(e.target.value)}
                      placeholder="Ask about this meeting..."
                      className="flex-1 h-9 text-sm"
                      disabled={chatStreaming}
                      onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); sendMessage(chatInput) } }}
                    />
                    {chatStreaming ? (
                      <Button size="icon" variant="destructive" onClick={stopChatStreaming} aria-label="Stop generating" title="Stop generating">
                        <HugeiconsIcon icon={StopIcon} strokeWidth={2} />
                      </Button>
                    ) : (
                      <Button
                        size="icon"
                        onClick={() => sendMessage(chatInput)}
                        disabled={!chatInput.trim()}
                        aria-label="Send message"
                        title="Send message"
                      >
                        <HugeiconsIcon icon={ArrowRight01Icon} strokeWidth={2} />
                      </Button>
                    )}
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
              {isPaused ? (
                <>
                  <motion.span animate={{ opacity: [1, 0.6, 1] }} transition={{ repeat: Infinity, duration: 1 }} className="text-xs font-medium text-destructive tabular-nums">{formatDuration((note?.duration ?? 0) + duration)}</motion.span>
                  <span className="text-xs font-medium text-amber-500">Paused</span>
                  <Button variant="ghost" size="sm" onClick={resumeRecording} className="text-amber-500 hover:text-amber-600">Resume</Button>
                  <Button variant="ghost" size="sm" onClick={stopRecording} className="text-destructive hover:text-destructive">Stop</Button>
                </>
              ) : (
                <>
                  <motion.span animate={{ opacity: [1, 0.6, 1] }} transition={{ repeat: Infinity, duration: 1 }} className="text-xs font-medium text-destructive tabular-nums">{formatDuration((note?.duration ?? 0) + duration)}</motion.span>
                  <Waveform active={true} level={audioLevel} className="min-w-[160px]" />
                  {isSpeaking ? (
                    <span className="text-xs font-medium text-primary">speaking</span>
                  ) : (
                    <span className="text-xs text-muted-foreground/60">
                      {silenceSeconds > 10 ? `silence ${silenceSeconds}s` : "listening"}
                    </span>
                  )}
                  <Button variant="ghost" size="sm" onClick={pauseRecording} className="text-amber-500 hover:text-amber-600">Pause</Button>
                  <Button variant="ghost" size="sm" onClick={stopRecording} className="text-destructive hover:text-destructive">Stop</Button>
                </>
              )}
            </div>
          ) : isTranscribing ? (
            <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground"><div className="size-2 border border-primary border-t-transparent rounded-full animate-spin" />Processing {formatDuration((note?.duration ?? 0) + duration)} recording...</span>
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
                <button
                  className="app-control-item"
                  data-active={audioSource === "both"}
                  onClick={() => setAudioSource("both")}
                >
                  Both
                </button>
              </div>
              {audioSource !== "system" && devices.length > 1 && (
                <Select value={selectedDevice} onValueChange={setSelectedDevice}>
                  <SelectTrigger className="h-8 max-w-[160px] rounded-2xl border-border bg-background text-sm text-muted-foreground">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {devices.map(d => <SelectItem key={d.deviceId} value={d.deviceId}>{d.label}</SelectItem>)}
                  </SelectContent>
                </Select>
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
          <Button variant="ghost" size="sm" onClick={() => setViewMode(viewMode === "wysiwyg" ? "source" : "wysiwyg")} className="text-muted-foreground hover:text-foreground">
            <HugeiconsIcon icon={CodeIcon} strokeWidth={1.5} data-icon="inline-start" />{viewMode === "wysiwyg" ? "WYSIWYG" : "Source"}
          </Button>
          {notes.trim() && !isEmpty && (
            <>
              <Button variant="ghost" size="sm" onClick={handleCopyMarkdown} className="text-muted-foreground hover:text-foreground">
                <HugeiconsIcon icon={Copy01Icon} strokeWidth={1.5} data-icon="inline-start" />Copy MD
              </Button>
              <Button variant="ghost" size="sm" onClick={handleSaveAsTemplate} className="text-muted-foreground hover:text-foreground">
                <HugeiconsIcon icon={FileAddIcon} strokeWidth={1.5} data-icon="inline-start" />Save as Template
              </Button>
            </>
          )}
          {previousNotesRef.current && (
            <Button variant="ghost" size="sm" onClick={handleUndoEnhance} className="text-amber-500 hover:text-amber-600">
              Undo Enhance
            </Button>
          )}
          {notes.trim() && (
            <Button variant="ghost" onClick={handleEnhance} disabled={isEnhancing} className="text-muted-foreground hover:text-foreground">
              <HugeiconsIcon icon={AiMagicIcon} strokeWidth={1.5} data-icon="inline-start" />Enhance
            </Button>
          )}
          <Button variant="ghost" onClick={() => { setShowAIPanel(!showAIPanel) }} className={`${showAIPanel ? "text-foreground" : "text-muted-foreground"} hover:text-foreground`}>
            <HugeiconsIcon icon={AiChat02Icon} strokeWidth={1.5} data-icon="inline-start" />AI
          </Button>
          <Button variant="ghost" size="icon" onClick={onSettings} className="text-muted-foreground/50 hover:text-muted-foreground" aria-label="Settings">
            <HugeiconsIcon icon={Settings02Icon} strokeWidth={1.5} />
          </Button>
        </div>
      </div>

      <MeetingTemplateSelector selectedId={selectedTemplate?.id} onSelect={tpl => setSelectedTemplate(tpl)} open={showTemplatePicker} onOpenChange={setShowTemplatePicker} />
    </main>
  )
}

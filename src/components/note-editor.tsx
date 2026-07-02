import { useState, useRef, useCallback, useEffect, useMemo } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
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
  MoreHorizontalIcon, SaveIcon,
} from "@hugeicons/core-free-icons"
import { useAudioDevices } from "@/lib/use-audio-devices"
import { MeetingTemplateSelector } from "@/components/meeting-template-selector"
import { TemplateIcon } from "@/components/template-icon"
import { NoteRenderer } from "@/components/note-renderer"
import { MarkdownView } from "@/components/markdown-view"
import { Waveform } from "@/components/Waveform"
import { useRecording } from "@/lib/use-recording"
import { saveTemplate as persistTemplate } from "@/lib/templates"
import { useChat } from "@/lib/use-chat"
import { cn } from "@/lib/utils"
import { formatDate, formatTime, formatTimer, stripMarkdown, stripMarkdownFence } from "@/lib/format"
import { SPEAKER_TAILWIND_COLORS } from "@/lib/constants"
import type { Meeting, AppSettings, MeetingTemplate, ChatMessage, SpeakerLabel } from "@/types"
import { findRelatedMeetings } from "@/lib/context-memory"

interface NoteEditorProps {
  note?: Meeting
  meetings: Meeting[]
  onSave: (meeting: Meeting, stayOnEditor?: boolean) => void
  onCancel: () => void
  onSettings: () => void
  settings: AppSettings
}

type RecorderState = "idle" | "recording" | "reviewing"

// Derive a readable title from the first meaningful line of the body, so a note
// saved without an explicit title beats a bare "Note <date>". Strips leading
// markdown markers (heading hashes, list bullets, emphasis) and truncates.
function deriveTitle(notes: string): string {
  const line = notes
    .split("\n")
    .map((l) =>
      l
        .replace(/^\s{0,3}#{1,6}\s+/, "")
        .replace(/^\s*[-*+]\s+/, "")
        .replace(/[*_`~]/g, "")
        .trim()
    )
    .find((l) => l.length > 0)
  if (!line) return `Note ${new Date().toLocaleDateString()}`
  return line.length > 60 ? `${line.slice(0, 60).trimEnd()}…` : line
}

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
  // Snapshot of the last-persisted title/notes. Drives the dirty indicator and
  // lets it clear correctly after a save (manual or auto), instead of comparing
  // against the never-updated `note` prop.
  const [savedSnapshot, setSavedSnapshot] = useState(() => ({
    title: note?.title ?? settings.titlePrefix,
    notes: note?.notes || note?.transcript || "",
  }))

  const [speakerLabels, setSpeakerLabels] = useState<SpeakerLabel[]>(note?.speakerLabels ?? [])
  const [isAddingSpeaker, setIsAddingSpeaker] = useState(false)
  const [newSpeakerName, setNewSpeakerName] = useState("")

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

  // Mirrors of fast-changing state for callbacks that must read the latest
  // value without re-binding (recording pipeline, autosave, window events).
  // Updated in effects, not during render, per the react-hooks/refs rule.
  const notesRef = useRef(notes)
  useEffect(() => { notesRef.current = notes }, [notes])
  const recorderStateRef = useRef(recorderState)
  useEffect(() => { recorderStateRef.current = recorderState }, [recorderState])
  const titleRef = useRef(title)
  useEffect(() => { titleRef.current = title }, [title])
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const errorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Note body from before the last AI enhance/transcription, so the user can
  // back out. State (not a ref) because it controls the Undo button's render.
  const [previousNotes, setPreviousNotes] = useState("")
  // Chat prompts derived from this meeting's actual content. Generated after
  // an enhancement completes; the chat panel shows nothing suggested before
  // that, so suggestions always relate to the real transcript.
  const [suggestedQuestions, setSuggestedQuestions] = useState<string[]>([])
  const chatHistoryRef = useRef<ChatMessage[]>(note?.chatHistory ?? [])

  const { devices, selectedDevice, setSelectedDevice, audioSource, setAudioSource } = useAudioDevices()

  // Apply the persisted audio preferences once on mount; after that the user's
  // in-editor choices win, so settings changes must not re-run this.
  useEffect(() => {
    if (settings.audioSource) setAudioSource(settings.audioSource)
    if (settings.preferredDeviceId && settings.preferredDeviceId !== "default") {
      setSelectedDevice(settings.preferredDeviceId)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    transcriptionModel: settings.transcriptionModel,
    setText: setNotes,
    getText: () => notesRef.current,
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

  const isDirty = title !== savedSnapshot.title || notes !== savedSnapshot.notes
  const isEmpty = !notes.trim()

  // Word count + reading time for the note body. stripMarkdown removes the
  // heaviest syntax so the count reflects prose. ~200 wpm reading speed.
  const noteStats = useMemo(() => {
    const plain = stripMarkdown(notes)
    const words = plain ? plain.split(/\s+/).filter(Boolean).length : 0
    return { words, minutes: Math.max(1, Math.round(words / 200)) }
  }, [notes])

  const chatMeeting = useMemo<Meeting>(() => ({
    id: note?.id ?? "",
    title,
    date: note?.date ?? new Date().toISOString(),
    duration: note?.duration ?? 0,
    transcript: rawTranscript || note?.transcript || "",
    notes,
    // useChat only reads chatHistory to seed its message state on mount, and
    // at mount chatHistoryRef still equals the persisted history — so use the
    // prop directly instead of reading a ref during render.
    chatHistory: note?.chatHistory ?? [],
  }), [title, notes, rawTranscript, note?.id, note?.date, note?.duration, note?.transcript, note?.chatHistory])

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
    resetChat,
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
              color: SPEAKER_TAILWIND_COLORS[(prev.length + i) % SPEAKER_TAILWIND_COLORS.length],
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
        setPreviousNotes(notesRef.current)

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
    setPreviousNotes(notesRef.current)
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
      // Models sometimes wrap the whole answer in a ```markdown fence; the
      // read views strip it at render time but the editor shows it literally,
      // so normalize the stored note once the stream is complete.
      const cleaned = stripMarkdownFence(streamed)
      setNotes(cleaned)
      setIsStreaming(false)
      // Fire-and-forget: derive chat suggestions from the transcript that was
      // just enhanced. `content` is the pre-enhance text (the raw transcript),
      // which grounds the questions in what was actually said.
      import("@/lib/ai-service")
        .then(({ suggestQuestions }) => suggestQuestions(rawTranscript || content, cleaned))
        .then(setSuggestedQuestions)
        .catch(() => { /* suggestions are optional */ })
    } catch (e) {
      setError(e instanceof Error ? e.message : "AI enhancement failed")
    } finally { setIsEnhancing(false); setIsStreaming(false) }

    autoDetectSpeakers(content)
  }, [notes, rawTranscript, selectedTemplate, autoDetectSpeakers])

  const handleUndoEnhance = useCallback(() => {
    if (!previousNotes) return
    setNotes(previousNotes)
    notesRef.current = previousNotes
    setPreviousNotes("")
  }, [previousNotes])

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
    const colorIdx = speakerLabels.length % SPEAKER_TAILWIND_COLORS.length
    setSpeakerLabels([...speakerLabels, { name: newSpeakerName.trim(), color: SPEAKER_TAILWIND_COLORS[colorIdx] }])
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
    const sectionRegex = /^#{1,3} (.+)$/gm
    let match: RegExpExecArray | null
    while ((match = sectionRegex.exec(notes)) !== null) {
      sections.push(match[1].replace(/[#*_~`]/g, "").trim())
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
    if (errorTimerRef.current) clearTimeout(errorTimerRef.current)
    errorTimerRef.current = setTimeout(() => setError(null), 3000)
  }, [title, notes])

  // Build the Meeting payload from the current editor state for a given id.
  // Shared by manual save, save-and-new, and autosave so they never drift.
  const buildMeeting = useCallback((id: string): Meeting => ({
    id,
    title: title.trim() || deriveTitle(notes),
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
  }), [title, note, duration, rawTranscript, notes, selectedTemplate, speakerLabels])

  const handleSave = useCallback(() => {
    const meeting = buildMeeting(note?.id ?? crypto.randomUUID())
    onSave(meeting)
    setSavedSnapshot({ title, notes })
    setJustSaved(true)
    if (savedTimerRef.current) clearTimeout(savedTimerRef.current)
    savedTimerRef.current = setTimeout(() => setJustSaved(false), 2000)
  }, [title, notes, note, onSave, buildMeeting])

  const handleSaveAndNew = useCallback(() => {
    onSave(buildMeeting(note?.id ?? crypto.randomUUID()), true)
    setTitle(settings.titlePrefix)
    setNotes("")
    setRawTranscript("")
    setShowRawTranscript(false)
    setSelectedTemplate(undefined)
    notesRef.current = ""
    setPreviousNotes("")
    setSuggestedQuestions([])
    chatHistoryRef.current = []
    // The chat hook keeps its own message state; clear it too so the fresh
    // note doesn't show the previous note's conversation.
    resetChat()
    setRecorderState("idle")
    setIsPaused(false)
    setError(null)
    // Fresh form is a clean slate, not dirty against the note we just saved.
    setSavedSnapshot({ title: settings.titlePrefix, notes: "" })
    setJustSaved(true)
    if (savedTimerRef.current) clearTimeout(savedTimerRef.current)
    savedTimerRef.current = setTimeout(() => setJustSaved(false), 2000)
  }, [note, settings.titlePrefix, onSave, buildMeeting, resetChat])

  useEffect(() => {
    const handler = () => { if (recorderStateRef.current === "recording") stopRecording(); else if (recorderStateRef.current === "idle") startRecording() }
    window.addEventListener("toggle-recording", handler)
    return () => window.removeEventListener("toggle-recording", handler)
  }, [startRecording, stopRecording])

  // ⌘S / Ctrl+S force-saves immediately — the reflex users expect even though
  // existing notes already autosave. Suppresses the webview's default save dialog.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.altKey && (e.key === "s" || e.key === "S")) {
        e.preventDefault()
        handleSave()
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [handleSave])

  useEffect(() => () => {
    abortCapture()
    if (savedTimerRef.current) clearTimeout(savedTimerRef.current)
    if (errorTimerRef.current) clearTimeout(errorTimerRef.current)
  }, [abortCapture])

  useEffect(() => {
    const dirty = title !== savedSnapshot.title || notes !== savedSnapshot.notes
    window.dispatchEvent(new CustomEvent("recorder-dirty", { detail: { dirty } }))
  }, [title, notes, savedSnapshot])

  // Autosave existing notes after a short idle. Scoped to existing notes only:
  // the id is real and stable, onSave upserts by id (no duplicate), and the
  // stayOnEditor flag suppresses navigation. New notes keep explicit save so we
  // don't mint a draft meeting on the first keystroke. Skipped while AI is
  // streaming/enhancing/titling to avoid persisting half-generated content.
  const autosaveRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    if (!note || !isDirty || isStreaming || isEnhancing || isTitling) return
    if (autosaveRef.current) clearTimeout(autosaveRef.current)
    autosaveRef.current = setTimeout(() => {
      onSave(buildMeeting(note.id), true)
      setSavedSnapshot({ title: titleRef.current, notes: notesRef.current })
      setJustSaved(true)
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current)
      savedTimerRef.current = setTimeout(() => setJustSaved(false), 2000)
    }, 1200)
    return () => { if (autosaveRef.current) clearTimeout(autosaveRef.current) }
  }, [notes, title, note, isDirty, isStreaming, isEnhancing, isTitling, onSave, buildMeeting])

  // Flush a pending autosave if the editor unmounts (navigates away / closes)
  // within the debounce window, so the last edits to an existing note are never
  // dropped. The closure is refreshed each render via an effect (not during
  // render) and read only in the unmount cleanup.
  const flushSaveRef = useRef<() => void>(() => {})
  useEffect(() => {
    flushSaveRef.current = () => {
      if (note && isDirty && !isStreaming && !isEnhancing && !isTitling) {
        onSave(buildMeeting(note.id), true)
      }
    }
  })
  useEffect(() => () => { flushSaveRef.current() }, [])

  return (
    <main className="flex h-full w-full flex-col bg-muted/35">
      <h1 className="sr-only">{note ? `Edit note: ${note.title}` : "New note"}</h1>
      <header data-tauri-drag-region className="flex min-h-14 shrink-0 items-center justify-between gap-4 border-b border-border/70 bg-background/90 px-4 backdrop-blur">
        <div className="flex min-w-0 items-center gap-3">
          <Button variant="ghost" size="icon" onClick={onCancel} className="text-muted-foreground hover:text-foreground" aria-label="Back to dashboard">
            <HugeiconsIcon icon={ArrowLeft01Icon} strokeWidth={2} />
          </Button>
          <div className="h-5 w-px bg-border" aria-hidden="true" />
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">{note ? "Meeting note" : "New meeting note"}</p>
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground" aria-live="polite">
              {isEnhancing ? (
                <><span className="size-1.5 rounded-full bg-primary animate-pulse" />Enhancing note</>
              ) : copied ? (
                <>Markdown copied</>
              ) : justSaved ? (
                <>All changes saved</>
              ) : isDirty ? (
                <><span className="size-1.5 rounded-full bg-amber-500" />Unsaved changes</>
              ) : (
                <>{note ? "Autosave is on" : "Ready to write"}</>
              )}
            </div>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button variant="ghost" onClick={handleSaveAndNew}>Save & New</Button>
          <Button onClick={handleSave} title="Save (⌘S)">
            <HugeiconsIcon icon={SaveIcon} strokeWidth={1.8} data-icon="inline-start" />
            Save
          </Button>
        </div>
      </header>

      <div className="relative flex min-h-0 flex-1 gap-3 overflow-hidden p-3">
        <section className="mx-auto flex min-w-0 max-w-5xl flex-1 flex-col overflow-hidden rounded-2xl border border-border/70 bg-card shadow-sm">
          <div className="app-scrollbar-hidden min-h-0 flex-1 overflow-y-auto">
            <div className="mx-auto flex min-h-full w-full max-w-3xl flex-col px-8 pb-16 pt-10 sm:px-12">
              <div className="flex items-start gap-3">
                <input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Untitled meeting"
                  aria-label="Note title"
                  className="h-auto min-w-0 flex-1 border-none bg-transparent px-0 py-0 text-4xl font-bold leading-tight tracking-tight outline-none placeholder:text-muted-foreground/35 focus-visible:ring-0"
                />
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={handleEnhanceTitle}
                  disabled={isTitling || !notes.trim()}
                  className="mt-1 shrink-0 text-muted-foreground/50 hover:text-foreground"
                  aria-label="AI generate title"
                >
                  {isTitling ? (
                    <div className="size-3 rounded-full border border-muted-foreground/40 border-t-transparent animate-spin" />
                  ) : (
                    <HugeiconsIcon icon={AiMagicIcon} strokeWidth={1.5} />
                  )}
                </Button>
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                <span className="inline-flex items-center gap-1.5">
                  <HugeiconsIcon icon={Calendar01Icon} strokeWidth={1.5} className="size-3" />
                  {formatDate(note?.date ?? new Date().toISOString())}
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <HugeiconsIcon icon={Clock01Icon} strokeWidth={1.5} className="size-3" />
                  {formatTime(note?.date ?? new Date().toISOString())}
                </span>
                {noteStats.words > 0 && (
                  <span title={`${noteStats.words.toLocaleString()} words · ~${noteStats.minutes} min read`}>
                    {noteStats.words.toLocaleString()} {noteStats.words === 1 ? "word" : "words"} · {noteStats.minutes} min read
                  </span>
                )}
                {recorderState === "recording" && silenceSeconds > 30 && (
                  <span className="inline-flex items-center gap-1 text-amber-500">
                    <HugeiconsIcon icon={AiVoiceIcon} strokeWidth={1.5} className="size-3" />
                    Silent {silenceSeconds}s
                  </span>
                )}
              </div>

              <div className="mt-5 flex flex-wrap items-center gap-2">
                {speakerLabels.map((label, i) => (
                  <span key={i} className={cn("inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium", label.color)}>
                    <span className="size-1.5 shrink-0 rounded-full bg-current opacity-60" />
                    {label.name}
                    <button type="button" onClick={() => handleRemoveSpeaker(i)} className="rounded-full p-0.5 transition-colors hover:bg-foreground/10" aria-label={`Remove ${label.name}`}>
                      <HugeiconsIcon icon={Cancel01Icon} strokeWidth={2} className="size-2.5" />
                    </button>
                  </span>
                ))}
                {isAddingSpeaker ? (
                  <div className="flex items-center gap-1">
                    <Input value={newSpeakerName} onChange={(e) => setNewSpeakerName(e.target.value)} placeholder="Speaker name" className="h-7 w-32 text-xs" autoFocus
                      onKeyDown={(e) => { if (e.key === "Enter") handleAddSpeaker(); if (e.key === "Escape") { setIsAddingSpeaker(false); setNewSpeakerName("") } }} />
                    <Button size="icon-sm" variant="ghost" onClick={handleAddSpeaker} aria-label="Add speaker"><HugeiconsIcon icon={Add01Icon} strokeWidth={2} /></Button>
                    <Button size="icon-sm" variant="ghost" onClick={() => { setIsAddingSpeaker(false); setNewSpeakerName("") }} aria-label="Cancel adding speaker"><HugeiconsIcon icon={Cancel01Icon} strokeWidth={2} /></Button>
                  </div>
                ) : (
                  <Button variant="ghost" size="sm" onClick={() => setIsAddingSpeaker(true)} className="text-muted-foreground hover:text-foreground">
                    <HugeiconsIcon icon={UserAdd02Icon} strokeWidth={1.5} data-icon="inline-start" />Add speaker
                  </Button>
                )}
              </div>

              {relatedMeetings.length > 0 && (
                <div className="mt-4 flex flex-wrap items-center gap-2">
                  <span className="text-xs font-medium text-muted-foreground">Related</span>
                  {relatedMeetings.map(m => (
                    <button
                      key={m.id}
                      type="button"
                      className="inline-flex items-center rounded-full border border-border/70 px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                      onClick={() => {
                        if (note?.id !== m.id) {
                          window.dispatchEvent(new CustomEvent("navigate-meeting", { detail: { id: m.id } }))
                        }
                      }}
                    >
                      {m.title}
                    </button>
                  ))}
                </div>
              )}

              {error && (
                <div className="mt-5 flex shrink-0 items-start justify-between gap-2 rounded-xl border border-destructive/15 bg-destructive/5 px-3 py-2" role="alert">
                  <div className="text-sm text-destructive">{error}</div>
                  <Button variant="ghost" size="icon-sm" onClick={() => setError(null)} aria-label="Dismiss error"><HugeiconsIcon icon={Cancel01Icon} strokeWidth={2} /></Button>
                </div>
              )}

              <div className="mt-7 flex min-h-[28rem] flex-1 flex-col border-t border-border/70 pt-3">
                {isStreaming && (
                  <div className="mb-3 flex items-center gap-2 text-xs text-primary">
                    <div className="size-2 rounded-full border border-primary border-t-transparent animate-spin" />
                    Enhancing note…
                  </div>
                )}

                <div className={cn("flex min-h-0 flex-1 flex-col", viewMode === "wysiwyg" && "pb-10")}>
                  {showRawTranscript && rawTranscript ? (
                    <pre className="min-h-[24rem] flex-1 whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground" style={{ fontFamily: "inherit" }}>{rawTranscript}</pre>
                  ) : (
                    <NoteRenderer
                      content={notes}
                      editable
                      onChange={setNotes}
                      viewMode={viewMode}
                      toolbar={viewMode === "wysiwyg"}
                      className="min-h-[24rem]"
                    />
                  )}
                </div>

                {isEmpty && recorderState === "idle" && viewMode !== "source" && (
                  <div className="mt-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-dashed border-border bg-muted/35 px-4 py-3">
                    <div>
                      <p className="text-sm font-medium">Start with a recording or a template</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">You can also click above and begin typing.</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button variant="outline" size="sm" onClick={startRecording}>
                        <HugeiconsIcon icon={AiVoiceIcon} strokeWidth={1.5} data-icon="inline-start" />Start recording
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => setShowTemplatePicker(true)}>Choose template</Button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </section>
          <AnimatePresence initial={false}>
            {showAIPanel && (
              <motion.div
                ref={chatPanelRef}
                initial={{ width: 0 }}
                animate={{ width: chatWidth }}
                exit={{ width: 0 }}
                transition={{ duration: 0.2, ease: "easeOut" }}
                className="relative flex shrink-0 flex-col overflow-hidden rounded-2xl border border-border/70 bg-card shadow-sm max-md:absolute max-md:bottom-3 max-md:right-3 max-md:top-3 max-md:z-20 max-md:shadow-2xl"
              >
                <div
                  className="absolute bottom-0 left-0 top-0 z-10 -ml-1 w-2 cursor-col-resize hover:bg-primary/20 active:bg-primary/30"
                  onMouseDown={(e) => {
                    e.preventDefault()
                    resizeRef.current = true
                    document.body.style.cursor = "col-resize"
                    document.body.style.userSelect = "none"
                  }}
                />
                <div className="flex shrink-0 items-center justify-between border-b border-border/70 px-4 py-3">
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
                      suggestedQuestions.length > 0 ? (
                        <div className="flex flex-col gap-2">
                          <p className="text-xs text-muted-foreground">Suggested questions</p>
                          {suggestedQuestions.map((q) => (
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
                      ) : (
                        <p className="text-xs text-muted-foreground">
                          Ask anything about this note. Enhance the transcript to get suggested questions based on what was discussed.
                        </p>
                      )
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
                              <MarkdownView markdown={msg.content} />
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
                  <div className="flex shrink-0 items-end gap-2 border-t border-border p-3">
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

      <footer className="flex min-h-16 shrink-0 flex-wrap items-center gap-3 border-t border-border/70 bg-background/95 px-4 py-2.5 shadow-[0_-8px_24px_-20px_rgba(0,0,0,0.45)] backdrop-blur">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          {recorderState === "recording" ? (
            <div className="flex items-center gap-3 rounded-xl border border-border bg-card px-3 py-1.5">
              {isPaused ? (
                <>
                  <motion.span animate={{ opacity: [1, 0.6, 1] }} transition={{ repeat: Infinity, duration: 1 }} className="text-xs font-medium text-destructive tabular-nums">{formatTimer((note?.duration ?? 0) + duration)}</motion.span>
                  <span className="text-xs font-medium text-amber-500">Paused</span>
                  <Button variant="ghost" size="sm" onClick={resumeRecording} className="text-amber-500 hover:text-amber-600">Resume</Button>
                  <Button variant="ghost" size="sm" onClick={stopRecording} className="text-destructive hover:text-destructive">Stop</Button>
                </>
              ) : (
                <>
                  <motion.span animate={{ opacity: [1, 0.6, 1] }} transition={{ repeat: Infinity, duration: 1 }} className="text-xs font-medium text-destructive tabular-nums">{formatTimer((note?.duration ?? 0) + duration)}</motion.span>
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
            <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground"><div className="size-2 rounded-full border border-primary border-t-transparent animate-spin" />Processing {formatTimer((note?.duration ?? 0) + duration)} recording…</span>
          ) : (
            <>
              <span className="hidden text-xs font-medium text-muted-foreground lg:inline">Capture from</span>
              <div className="app-control-strip">
                <button
                  className="app-control-item"
                  data-active={audioSource === "mic"}
                  aria-pressed={audioSource === "mic"}
                  onClick={() => setAudioSource("mic")}
                >
                  <HugeiconsIcon icon={MicIcon} strokeWidth={1.5} className="size-3 mr-1 inline" />Mic
                </button>
                <button
                  className="app-control-item"
                  data-active={audioSource === "system"}
                  aria-pressed={audioSource === "system"}
                  onClick={() => setAudioSource("system")}
                >
                  <HugeiconsIcon icon={ComputerIcon} strokeWidth={1.5} className="size-3 mr-1 inline" />System
                </button>
                <button
                  className="app-control-item"
                  data-active={audioSource === "both"}
                  aria-pressed={audioSource === "both"}
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
                    <SelectGroup>
                      {devices.map(d => <SelectItem key={d.deviceId} value={d.deviceId}>{d.label}</SelectItem>)}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              )}
              <Button variant="default" onClick={startRecording}>
                <HugeiconsIcon icon={AiVoiceIcon} strokeWidth={1.5} data-icon="inline-start" />Record
              </Button>
              <Button
                variant="outline"
                onClick={() => setShowTemplatePicker(true)}
              >
                {selectedTemplate ? <><TemplateIcon name={selectedTemplate.icon} className="size-3" />{selectedTemplate.name}</> : "Template"}
              </Button>
            </>
          )}
        </div>

        <div data-tauri-drag-region className="min-w-4 flex-1 self-stretch" />

        <div className="flex items-center gap-2">
          {previousNotes && (
            <Button variant="ghost" size="sm" onClick={handleUndoEnhance} className="text-amber-500 hover:text-amber-600">
              Undo enhance
            </Button>
          )}
          {notes.trim() && (
            <Button variant="outline" onClick={handleEnhance} disabled={isEnhancing}>
              <HugeiconsIcon icon={AiMagicIcon} strokeWidth={1.5} data-icon="inline-start" />Enhance
            </Button>
          )}
          <Button variant={showAIPanel ? "secondary" : "outline"} onClick={() => { setShowAIPanel(!showAIPanel) }}>
            <HugeiconsIcon icon={AiChat02Icon} strokeWidth={1.5} data-icon="inline-start" />AI chat
          </Button>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" aria-label="More note actions">
                <HugeiconsIcon icon={MoreHorizontalIcon} strokeWidth={1.8} />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-52">
              <DropdownMenuLabel>Note actions</DropdownMenuLabel>
              <DropdownMenuGroup>
                <DropdownMenuItem onSelect={() => setViewMode(viewMode === "wysiwyg" ? "source" : "wysiwyg")}>
                  <HugeiconsIcon icon={CodeIcon} strokeWidth={1.5} />
                  {viewMode === "wysiwyg" ? "Edit Markdown source" : "Return to rich text"}
                </DropdownMenuItem>
                {rawTranscript && (
                  <DropdownMenuItem onSelect={() => setShowRawTranscript(!showRawTranscript)}>
                    <HugeiconsIcon icon={AiVoiceIcon} strokeWidth={1.5} />
                    {showRawTranscript ? "Show enhanced notes" : "Show original transcript"}
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem disabled={!notes.trim()} onSelect={handleCopyMarkdown}>
                  <HugeiconsIcon icon={Copy01Icon} strokeWidth={1.5} />
                  Copy Markdown
                </DropdownMenuItem>
                <DropdownMenuItem disabled={!notes.trim() || isEmpty} onSelect={handleSaveAsTemplate}>
                  <HugeiconsIcon icon={FileAddIcon} strokeWidth={1.5} />
                  Save as template
                </DropdownMenuItem>
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>

          <Button variant="ghost" size="icon" onClick={onSettings} className="text-muted-foreground hover:text-foreground" aria-label="Settings">
            <HugeiconsIcon icon={Settings02Icon} strokeWidth={1.5} />
          </Button>
        </div>
      </footer>

      <MeetingTemplateSelector selectedId={selectedTemplate?.id} onSelect={tpl => setSelectedTemplate(tpl)} open={showTemplatePicker} onOpenChange={setShowTemplatePicker} />
    </main>
  )
}

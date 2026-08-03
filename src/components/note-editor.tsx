import { useState, useRef, useCallback, useEffect, useMemo } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { messageVariants, transitions } from "@/lib/motion"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { HugeiconsIcon } from "@hugeicons/react"
import {
  AiVoiceIcon,
  Settings02Icon,
  Cancel01Icon, AiMagicIcon,
  AiChat02Icon, ArrowRight01Icon, ArrowLeft01Icon,
  MicIcon, ComputerIcon,
  Copy01Icon, FileAddIcon, CodeIcon, FileExportIcon, FileImportIcon,
  StopIcon, AlertCircleIcon, RefreshIcon,
  MoreHorizontalIcon, SaveIcon,
  CenterFocusIcon,
  AlignBoxMiddleLeftIcon,
  PauseIcon,
  PlayIcon,
  ArrowDown01Icon,
} from "@hugeicons/core-free-icons"
import { toast } from "@/components/ui/toaster"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { copyRichText, exportMeetingMarkdown } from "@/lib/export"
import { useAudioDevices } from "@/lib/use-audio-devices"
import { MeetingTemplateSelector } from "@/components/meeting-template-selector"
import { TemplateIcon } from "@/components/template-icon"
import { NoteRenderer } from "@/components/note-renderer"
import { MarkdownView } from "@/components/markdown-view"
import { EditorInfoSidebar } from "@/components/editor-info-sidebar"
import { EditorArtifacts, ARTIFACT_RECIPE_IDS } from "@/components/editor-artifacts"
import { buildSidebarPeople } from "@/lib/sidebar-people"
import { Waveform } from "@/components/Waveform"
import { useRecording } from "@/lib/use-recording"
import { saveTemplate as persistTemplate } from "@/lib/templates"
import { useChat } from "@/lib/use-chat"
import { cn } from "@/lib/utils"
import { formatDate, formatTime, formatTimer, stripMarkdown, stripMarkdownFence } from "@/lib/format"
import { SPEAKER_TAILWIND_COLORS } from "@/lib/constants"
import type { Meeting, AppSettings, MeetingTemplate, ChatMessage, SpeakerLabel, Recipe } from "@/types"
import { findRelatedMeetings } from "@/lib/context-memory"
import { correctWithSavedDictionary } from "@/lib/dictionary"
import { replaceKnowledgeForMeeting, loadKnowledgeGraph, addKnowledgeEdges, loadRecipes, updateMeeting as persistMeetingFields, linkPeopleFromMeeting, loadPeople, updateKnowledgeItem } from "@/lib/storage"
import { shareViaEmail, shareExportToFolder, shareViaSlack } from "@/lib/share"
import { getPrepContext } from "@/lib/meeting-brief"

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
  const [isTranscribing, setIsTranscribing] = useState(false)
  const [selectedTemplate, setSelectedTemplate] = useState<MeetingTemplate | undefined>(undefined)
  const [showTemplatePicker, setShowTemplatePicker] = useState(false)
  // Side panels: hidden by default; user opens via header toggles. Focus mode hides both.
  const [showInfoPanel, setShowInfoPanel] = useState(false)
  const [showAIPanel, setShowAIPanel] = useState(false)
  const [isEnhancing, setIsEnhancing] = useState(false)
  const [isTitling, setIsTitling] = useState(false)
  const [justSaved, setJustSaved] = useState(false)
  const [isStreaming, setIsStreaming] = useState(false)
  const [viewMode, setViewMode] = useState<"wysiwyg" | "source">("wysiwyg")
  // Distraction-free writing (⌘⇧F): side panels + capture chrome recede so
  // only title + text remain. An active recording stays reachable.
  const [focusMode, setFocusMode] = useState(false)
  const focusModeRef = useRef(focusMode)
  useEffect(() => { focusModeRef.current = focusMode }, [focusMode])
  const [isPaused, setIsPaused] = useState(false)
  const [rawTranscript, setRawTranscript] = useState(note?.transcript || "")
  const [showRawTranscript, setShowRawTranscript] = useState(false)
  const [chatWidth, setChatWidth] = useState(320)
  const [infoWidth] = useState(296)
  // Snapshot of the last-persisted title/notes. Drives the dirty indicator and
  // lets it clear correctly after a save (manual or auto), instead of comparing
  // against the never-updated `note` prop.
  const [savedSnapshot, setSavedSnapshot] = useState(() => ({
    title: note?.title ?? settings.titlePrefix,
    notes: note?.notes || note?.transcript || "",
    description: note?.description ?? "",
  }))

  const [speakerLabels, setSpeakerLabels] = useState<SpeakerLabel[]>(note?.speakerLabels ?? [])
  const [isAddingSpeaker, setIsAddingSpeaker] = useState(false)
  const [newSpeakerName, setNewSpeakerName] = useState("")
  const [manualNotes, setManualNotes] = useState(note?.manualNotes ?? "")
  /** Plain-text list blurb — editable; AI may overwrite on Enhance. */
  const [description, setDescription] = useState(note?.description ?? "")
  /** Concept tags — local so autosave/buildMeeting never wipe AI or manual tags. */
  const [folderIds, setFolderIds] = useState<string[]>(() => note?.folderIds ?? [])
  const folderIdsRef = useRef(folderIds)
  useEffect(() => { folderIdsRef.current = folderIds }, [folderIds])
  useEffect(() => {
    setFolderIds(note?.folderIds ?? [])
  }, [note?.id, note?.folderIds])
  const [dualFocus, setDualFocus] = useState<"notes" | "transcript" | "split">("split")
  const [recipeOutputs, setRecipeOutputs] = useState<Record<string, string>>(note?.recipeOutputs ?? {})
  const [activeArtifactId, setActiveArtifactId] = useState<string | null>(() => {
    const outs = note?.recipeOutputs ?? {}
    return ARTIFACT_RECIPE_IDS.find((id) => outs[id]?.trim()) ?? null
  })
  const [runningRecipeId, setRunningRecipeId] = useState<string | null>(null)
  /** Bumps after enhance so open loops re-read the knowledge graph. */
  const [prepTick, setPrepTick] = useState(0)
  const manualNotesRef = useRef(manualNotes)
  useEffect(() => { manualNotesRef.current = manualNotes }, [manualNotes])
  const autoEnhanceRanRef = useRef(false)
  const pendingAutoEnhanceRef = useRef(false)

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
  const titleInputRef = useRef<HTMLTextAreaElement | null>(null)
  useEffect(() => { titleRef.current = title }, [title])
  // Auto-grow the title field so long titles wrap instead of clipping.
  useEffect(() => {
    const el = titleInputRef.current
    if (!el) return
    el.style.height = "0px"
    el.style.height = `${el.scrollHeight}px`
  }, [title])
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
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
    prewarm: prewarmCapture,
  } = useRecording({
    audioSource,
    speechLang: settings.speechLang,
    transcriptionModel: settings.transcriptionModel,
    setText: setNotes,
    getText: () => notesRef.current,
    onError: toast.error,
    silenceLimitSecs: 120,
    onSilenceLimit,
  })

  // Pre-load the ASR model in a parked sidecar as soon as the editor opens (and
  // whenever the source/model choice changes), so pressing record starts
  // capturing immediately instead of waiting through the model load.
  useEffect(() => {
    prewarmCapture()
  }, [prewarmCapture])

  const relatedMeetings = useMemo(() => {
    if (!note) return []
    return findRelatedMeetings(note, meetings, 3)
      .map(r => meetings.find(m => m.id === r.meetingId))
      .filter((m): m is Meeting => Boolean(m))
  }, [note, meetings])

  // Speakers first, then memory links, then calendar invitees (de-duped).
  const sidebarPeople = useMemo(() => {
    const people = loadPeople()
    const byId = new Set(note?.personIds ?? [])
    const fromGraph = people.filter((p) => byId.has(p.id))
    return buildSidebarPeople(speakerLabels, note?.attendees, fromGraph)
  }, [note?.personIds, note?.attendees, speakerLabels])

  // Open loops from knowledge graph — real carry-over work, not an AI essay.
  // prepTick intentionally invalidates after enhance so the graph re-reads.
  const openLoops = useMemo(() => {
    void prepTick
    return getPrepContext({
      title: title || note?.title || "Meeting",
      attendees: note?.attendees,
      calendarEventId: note?.calendarEventId,
      meetingId: note?.id,
    }).openLoops
  }, [title, note?.title, note?.attendees, note?.calendarEventId, note?.id, prepTick])

  const isDirty =
    title !== savedSnapshot.title ||
    notes !== savedSnapshot.notes ||
    manualNotes !== (note?.manualNotes ?? "") ||
    description !== savedSnapshot.description
  const isEmpty = !notes.trim() && !manualNotes.trim()
  const sidePanelsVisible = !focusMode
  const infoOpen = sidePanelsVisible && showInfoPanel
  const chatOpen = sidePanelsVisible && showAIPanel

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

  const autoDetectSpeakers = useCallback(async (transcript: string): Promise<SpeakerLabel[]> => {
    if (speakerLabels.length > 0) return speakerLabels
    try {
      const { detectSpeakers, isAIConfigured } = await import("@/lib/ai-service")
      if (!isAIConfigured()) return []
      const names = await detectSpeakers(transcript)
      if (names.length === 0) return []
      const newLabels = names.map((name, i) => ({
        name,
        color: SPEAKER_TAILWIND_COLORS[i % SPEAKER_TAILWIND_COLORS.length],
      }))
      setSpeakerLabels((prev) => {
        const existing = new Set(prev.map((s) => s.name.toLowerCase()))
        const extra = newLabels.filter((s) => !existing.has(s.name.toLowerCase()))
        return extra.length === 0 ? prev : [...prev, ...extra]
      })
      return newLabels
    } catch {
      return []
    }
  }, [speakerLabels])

  const stopRecording = useCallback(async () => {
    setRecorderState("idle")
    setIsPaused(false)
    setIsTranscribing(true)
    autoEnhanceRanRef.current = false
    pendingAutoEnhanceRef.current = true

    try {
      await stopCapture(800)

      // Live captions land in `notes` during recording; treat that as the
      // transcript. User shorthand lives in `manualNotes` and is merged on Enhance.
      const content = notesRef.current.trim()
      if (content) {
        setPreviousNotes(notesRef.current)
        // Protect People + this meeting's attendees/speakers so e.g. "Christy"
        // is not force-rewritten to "Christian" when both are real names.
        const corrected = correctWithSavedDictionary(content, {
          protectNames: [
            ...(note?.attendees?.map((a) => a.name) ?? []),
            ...speakerLabels.map((s) => s.name),
          ],
        })
        if (corrected !== content) {
          setNotes(corrected)
          notesRef.current = corrected
        }
        setRawTranscript(corrected)

        const { isAIConfigured } = await import("@/lib/ai-service")
        if (isAIConfigured()) {
          try {
            const defaultTitle = titleRef.current.trim() === "" || titleRef.current === settings.titlePrefix
            if (defaultTitle) {
              const { generateTitle } = await import("@/lib/ai-service")
              const seed = `${manualNotesRef.current}\n${corrected}`.trim()
              const autoTitle = await generateTitle(seed, corrected)
              if (autoTitle) setTitle(autoTitle)
            }
          } catch { /* ignore title generation failure */ }
        }
        autoDetectSpeakers(corrected)
      }
    } finally {
      setIsTranscribing(false)
    }
  }, [stopCapture, settings.titlePrefix, autoDetectSpeakers, note?.attendees, speakerLabels])

  // Import an existing audio file and append its transcript to this note,
  // mirroring the live-recording stop flow (dictionary corrections, undo via
  // previousNotes, speaker detection). Progress lives in a sticky toast that
  // the outcome toast replaces (same id).
  const handleImportAudio = useCallback(async () => {
    toast("Transcribing audio file…", { id: "import-audio", duration: 0 })
    try {
      const { pickAndTranscribeAudio } = await import("@/lib/import-audio")
      const result = await pickAndTranscribeAudio()
      if (!result) { toast.dismiss("import-audio"); return }
      if (!result.text) { toast.error("No speech detected in that file", { id: "import-audio" }); return }
      setPreviousNotes(notesRef.current)
      const corrected = correctWithSavedDictionary(result.text, {
        protectNames: [
          ...(note?.attendees?.map((a) => a.name) ?? []),
          ...speakerLabels.map((s) => s.name),
        ],
      })
      const base = notesRef.current.trim()
      const next = base ? `${base}\n\n${corrected}` : corrected
      setNotes(next)
      notesRef.current = next
      setRawTranscript((prev) => (prev ? `${prev}\n\n${corrected}` : corrected))
      toast.success("Audio transcribed", { id: "import-audio", description: result.fileName })
      autoDetectSpeakers(corrected)
    } catch (e) {
      toast.error("Import failed", { id: "import-audio", description: e instanceof Error ? e.message : "Transcription failed" })
    }
  }, [autoDetectSpeakers, note?.attendees, speakerLabels])

  const handleEnhance = useCallback(async () => {
    const transcript = (rawTranscript || notes).trim()
    const primary = (manualNotesRef.current || notes).trim()
    if (!primary && !transcript) return
    setPreviousNotes(notesRef.current)
    setIsEnhancing(true)
    setIsStreaming(true)
    try {
      const { streamGenerateNotes, isAIConfigured, runRecipe, generateMeetingDescription } = await import("@/lib/ai-service")
      if (!isAIConfigured()) {
        toast.error("AI is not configured", { description: "Set your API key in Settings.", action: { label: "Open Settings", onClick: onSettings } })
        return
      }
      const sections = selectedTemplate?.sections
      let streamed = ""
      const gen = streamGenerateNotes(primary || transcript, transcript, sections, selectedTemplate?.id)
      const viaEditor = viewMode === "wysiwyg" && recorderState !== "recording"
      let pending = ""
      let headDecided = false
      let fenced = false
      const TAIL_HOLD = 10
      const flush = (final = false) => {
        if (!viaEditor) return
        if (!headDecided) {
          const nl = pending.indexOf("\n")
          if (!final && nl === -1 && pending.length < 40) return
          const firstLine = (nl === -1 ? pending : pending.slice(0, nl)).trim()
          fenced = /^```(?:markdown|md)?$/i.test(firstLine)
          headDecided = true
          if (fenced) pending = nl === -1 ? "" : pending.slice(nl + 1)
        }
        const pushLen = final ? pending.length : Math.max(0, pending.length - TAIL_HOLD)
        if (pushLen > 0) {
          window.dispatchEvent(new CustomEvent("editor-stream-chunk", { detail: pending.slice(0, pushLen) }))
          pending = pending.slice(pushLen)
        }
      }
      if (viaEditor) window.dispatchEvent(new CustomEvent("editor-stream-start"))
      for await (const chunk of gen) {
        streamed += chunk
        if (viaEditor) {
          pending += chunk
          flush()
        } else {
          setNotes(streamed)
        }
      }
      if (viaEditor) {
        if (fenced) pending = pending.replace(/\n?```\s*$/i, "")
        flush(true)
        window.dispatchEvent(new CustomEvent("editor-stream-end"))
      }
      const cleaned = stripMarkdownFence(streamed)
      setNotes(cleaned)
      notesRef.current = cleaned
      // Writing is done — clear stream busy UI immediately (before recipes / knowledge).
      setIsStreaming(false)
      import("@/lib/ai-service")
        .then(({ suggestQuestions }) => suggestQuestions(transcript || primary, cleaned))
        .then(setSuggestedQuestions)
        .catch(() => { /* suggestions are optional */ })

      // Always use a stable meeting id. New notes mint one and persist via onSave
      // so knowledge items / people attach to a real meeting that exists in App state.
      const meetingId = note?.id ?? crypto.randomUUID()
      const enhancedAt = new Date().toISOString()
      const meetingTitle = titleRef.current.trim() || deriveTitle(cleaned || manualNotesRef.current)

      // Plain-text list blurb — not the markdown note body.
      let nextDescription = description
      try {
        const generated = await generateMeetingDescription(cleaned, transcript, meetingTitle)
        if (generated) {
          nextDescription = generated
          setDescription(generated)
        }
      } catch {
        /* description is optional; card falls back to empty */
      }

      let meetingForKnowledge: Meeting = {
        id: meetingId,
        title: meetingTitle,
        date: note?.date ?? new Date().toISOString(),
        duration: (note?.duration ?? 0) + duration,
        transcript,
        notes: cleaned,
        manualNotes: manualNotesRef.current || undefined,
        description: nextDescription || undefined,
        templateId: selectedTemplate?.id ?? note?.templateId,
        speakerLabels: speakerLabels.length > 0 ? speakerLabels : note?.speakerLabels,
        attendees: note?.attendees,
        personIds: note?.personIds,
        folderIds: folderIdsRef.current.length > 0 ? folderIdsRef.current : undefined,
        calendarEventId: note?.calendarEventId,
        chatHistory: chatHistoryRef.current.length > 0 ? chatHistoryRef.current : note?.chatHistory,
        autoEnhancedAt: enhancedAt,
        recipeOutputs: Object.keys(recipeOutputs).length > 0 ? recipeOutputs : note?.recipeOutputs,
      }
      // Persist before knowledge so updateMeeting / dashboard lookups succeed for new notes.
      onSave(meetingForKnowledge, true)
      setSavedSnapshot({ title: titleRef.current, notes: cleaned, description: nextDescription })

      // Recipes first — action digest feeds knowledge fallback when extract is thin.
      const outputs = { ...(meetingForKnowledge.recipeOutputs ?? {}) }
      const recipes = loadRecipes().filter((r) => r.runOnStop)
      if (recipes.length > 0 && isAIConfigured()) {
        for (const recipe of recipes) {
          try {
            const out = await runRecipe(recipe.prompt, cleaned, transcript, titleRef.current)
            outputs[recipe.id] = out
          } catch { /* recipe optional */ }
        }
        setRecipeOutputs(outputs)
        const firstArtifact = ARTIFACT_RECIPE_IDS.find((id) => outputs[id]?.trim())
        if (firstArtifact) setActiveArtifactId(firstArtifact)
      }

      // Detect speakers before people-link so names land in People memory.
      const detectedSpeakers = await autoDetectSpeakers(transcript || primary)
      if (detectedSpeakers.length > 0) {
        meetingForKnowledge = {
          ...meetingForKnowledge,
          speakerLabels: detectedSpeakers,
        }
      }

      // Awaited knowledge + people so home Actions/People tabs see data after enhance.
      try {
        const { extractKnowledgeItems, knowledgeItemsFromActionDigest } = await import(
          "@/lib/knowledge-extract"
        )
        let items = await extractKnowledgeItems(meetingForKnowledge, cleaned)
        const digest = outputs["recipe-action-digest"]
        const hasActionItems = items.some((i) => i.kind === "action_item")
        if (digest?.trim() && !hasActionItems) {
          items = [...items, ...knowledgeItemsFromActionDigest(meetingId, digest)]
        }
        if (items.length > 0) {
          try {
            const { embedBatch } = await import("@/lib/embedding")
            const vectors = await embedBatch(items.map((i) => i.text))
            items.forEach((item, i) => {
              if (vectors[i]) item.embedding = vectors[i]
            })
          } catch { /* embeddings are optional */ }
          replaceKnowledgeForMeeting(meetingId, items)
          try {
            const { findLinkCandidates, linkKnowledgeItems } = await import("@/lib/knowledge-link")
            const existing = loadKnowledgeGraph().items.filter((i) => i.meetingId !== meetingId)
            if (existing.length > 0) {
              const candidates = findLinkCandidates(items, existing)
              if (candidates.size > 0) {
                const edges = await linkKnowledgeItems(items, candidates, meetings)
                if (edges.length > 0) addKnowledgeEdges(edges)
              }
            }
          } catch { /* cross-meeting linking is optional */ }
        }
        // Always link attendees / speakers / assignees (even when extract is empty).
        linkPeopleFromMeeting({ ...meetingForKnowledge, recipeOutputs: outputs })
      } catch { /* knowledge extraction is optional */ }

      // Concept tags from content — reuses existing tags so similar meetings cluster.
      let nextFolderIds = meetingForKnowledge.folderIds ?? folderIdsRef.current
      if (settings.autoTagOnEnhance !== false && isAIConfigured()) {
        try {
          const { autoTagMeeting } = await import("@/lib/auto-tag")
          const tagResult = await autoTagMeeting({
            ...meetingForKnowledge,
            notes: cleaned,
            folderIds: nextFolderIds,
          })
          nextFolderIds = tagResult.folderIds
          setFolderIds(nextFolderIds)
          folderIdsRef.current = nextFolderIds
          if (tagResult.applied.length > 0) {
            toast.success("Tagged meeting", {
              description: tagResult.applied.join(" · "),
            })
          }
        } catch { /* auto-tag optional */ }
      }

      onSave(
        {
          ...meetingForKnowledge,
          notes: cleaned,
          description: nextDescription || undefined,
          folderIds: nextFolderIds.length > 0 ? nextFolderIds : undefined,
          recipeOutputs: Object.keys(outputs).length > 0 ? outputs : meetingForKnowledge.recipeOutputs,
          autoEnhancedAt: enhancedAt,
        },
        true,
      )
    } catch (e) {
      window.dispatchEvent(new CustomEvent("editor-stream-abort"))
      toast.error(e instanceof Error ? e.message : "AI enhancement failed")
    } finally {
      setIsEnhancing(false)
      setIsStreaming(false)
      setPrepTick((t) => t + 1)
    }
  }, [
    notes,
    description,
    rawTranscript,
    selectedTemplate,
    autoDetectSpeakers,
    note,
    meetings,
    onSettings,
    onSave,
    settings.autoTagOnEnhance,
    viewMode,
    recorderState,
    recipeOutputs,
    duration,
    speakerLabels,
  ])

  // Auto-enhance after recording stops when the setting is on and AI is configured.
  useEffect(() => {
    if (isTranscribing) return
    if (recorderState !== "idle") return
    if (!settings.autoEnhanceOnStop) return
    if (!pendingAutoEnhanceRef.current) return
    if (autoEnhanceRanRef.current) return
    const hasContent = Boolean((rawTranscript || notes).trim() || manualNotes.trim())
    if (!hasContent) {
      pendingAutoEnhanceRef.current = false
      return
    }
    autoEnhanceRanRef.current = true
    pendingAutoEnhanceRef.current = false
    void handleEnhance()
  }, [isTranscribing, recorderState, settings.autoEnhanceOnStop, rawTranscript, notes, manualNotes, handleEnhance])

  const handleRunRecipe = useCallback(async (recipe: Recipe) => {
    setRunningRecipeId(recipe.id)
    setActiveArtifactId(recipe.id)
    try {
      const { runRecipe, isAIConfigured } = await import("@/lib/ai-service")
      if (!isAIConfigured()) {
        toast.error("AI is not configured", { action: { label: "Open Settings", onClick: onSettings } })
        return
      }
      const out = await runRecipe(
        recipe.prompt,
        notes.trim() || manualNotes,
        rawTranscript || notes,
        title,
      )
      const next = { ...recipeOutputs, [recipe.id]: out }
      setRecipeOutputs(next)

      // Ensure a real meeting id so digests can land in home Actions / People.
      const meetingId = note?.id ?? crypto.randomUUID()
      const meeting: Meeting = {
        id: meetingId,
        title: title.trim() || deriveTitle(notes || manualNotes),
        date: note?.date ?? new Date().toISOString(),
        duration: (note?.duration ?? 0) + duration,
        transcript: rawTranscript || note?.transcript || "",
        notes: notes.trim(),
        manualNotes: manualNotes.trim() || undefined,
        templateId: selectedTemplate?.id ?? note?.templateId,
        speakerLabels: speakerLabels.length > 0 ? speakerLabels : note?.speakerLabels,
        attendees: note?.attendees,
        personIds: note?.personIds,
        folderIds: note?.folderIds,
        calendarEventId: note?.calendarEventId,
        chatHistory: chatHistoryRef.current.length > 0 ? chatHistoryRef.current : note?.chatHistory,
        recipeOutputs: next,
      }
      onSave(meeting, true)

      if (recipe.id === "recipe-action-digest" && out.trim()) {
        try {
          const { knowledgeItemsFromActionDigest } = await import("@/lib/knowledge-extract")
          const graph = loadKnowledgeGraph()
          const existing = graph.items.filter((i) => i.meetingId === meetingId)
          const hasOpenActions = existing.some(
            (i) => i.kind === "action_item" && (i.status === "open" || i.status === "unknown"),
          )
          if (!hasOpenActions) {
            const fromDigest = knowledgeItemsFromActionDigest(meetingId, out)
            if (fromDigest.length > 0) {
              replaceKnowledgeForMeeting(meetingId, [
                ...existing.filter((i) => i.kind !== "action_item"),
                ...fromDigest,
              ])
            }
          }
          linkPeopleFromMeeting(meeting)
          setPrepTick((t) => t + 1)
        } catch { /* optional */ }
      }

      toast.success(`${recipe.name} ready`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Recipe failed")
    } finally {
      setRunningRecipeId(null)
    }
  }, [
    notes,
    manualNotes,
    rawTranscript,
    title,
    recipeOutputs,
    note,
    onSettings,
    onSave,
    duration,
    selectedTemplate,
    speakerLabels,
  ])

  const handleUndoEnhance = useCallback(() => {
    if (!previousNotes) return
    setNotes(previousNotes)
    notesRef.current = previousNotes
    setPreviousNotes("")
  }, [previousNotes])

  const handleToggleLoop = useCallback((id: string, resolved: boolean) => {
    updateKnowledgeItem(id, { status: resolved ? "resolved" : "open" })
    setPrepTick((t) => t + 1)
  }, [])

  const handleUpdateArtifactOutput = useCallback((recipeId: string, markdown: string) => {
    setRecipeOutputs((prev) => {
      const next = { ...prev, [recipeId]: markdown }
      if (note?.id) persistMeetingFields(note.id, { recipeOutputs: next })
      return next
    })
  }, [note])

  const handleEnhanceTitle = useCallback(async () => {
    const content = notes.trim()
    if (!content) return
    setIsTitling(true)
    try {
      const { generateTitle, isAIConfigured } = await import("@/lib/ai-service")
      if (!isAIConfigured()) { toast.error("AI is not configured", { description: "Set your API key in Settings.", action: { label: "Open Settings", onClick: onSettings } }); return }
      const autoTitle = await generateTitle(content, content)
      if (autoTitle) setTitle(autoTitle)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Title generation failed")
    } finally { setIsTitling(false) }
  }, [notes, onSettings])

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
    toast.success("Markdown copied")
  }, [title, notes])

  const handleCopyRichText = useCallback(async () => {
    let md = ""
    if (title.trim()) md += `# ${title.trim()}\n\n`
    md += notes.trim()
    const ok = await copyRichText(md)
    if (ok) {
      toast.success("Rich text copied", { description: "Paste into Slack, Docs, or Mail with formatting." })
    } else {
      toast.error("Copy failed", { description: "Clipboard access was blocked." })
    }
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
    toast.success("Template saved", { description: "Reuse it from the Template picker." })
  }, [title, notes])

  // Build the Meeting payload from the current editor state for a given id.
  // Shared by manual save, save-and-new, and autosave so they never drift.
  const buildMeeting = useCallback((id: string): Meeting => ({
    id,
    title: title.trim() || deriveTitle(notes || manualNotes),
    date: note?.date ?? new Date().toISOString(),
    duration: (note?.duration ?? 0) + duration,
    transcript: rawTranscript || note?.transcript || "",
    notes: notes.trim(),
    manualNotes: manualNotes.trim() || undefined,
    description: description.trim() || undefined,
    templateId: selectedTemplate?.id ?? note?.templateId,
    structuredNotes: note?.structuredNotes,
    enhancedNotes: note?.enhancedNotes,
    chatHistory: chatHistoryRef.current.length > 0 ? chatHistoryRef.current : note?.chatHistory,
    speakerLabels: speakerLabels.length > 0 ? speakerLabels : note?.speakerLabels,
    transcriptSegments: note?.transcriptSegments,
    // Legacy field — no longer generated in-editor; preserve if present.
    brief: note?.brief,
    folderIds: folderIds.length > 0 ? folderIds : undefined,
    calendarEventId: note?.calendarEventId,
    attendees: note?.attendees,
    personIds: note?.personIds,
    autoEnhancedAt: note?.autoEnhancedAt,
    recipeOutputs: Object.keys(recipeOutputs).length > 0 ? recipeOutputs : note?.recipeOutputs,
  }), [title, note, duration, rawTranscript, notes, manualNotes, description, selectedTemplate, speakerLabels, recipeOutputs, folderIds])

  const handleShareEmail = useCallback(async () => {
    try {
      await shareViaEmail(title, notes)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not open Mail")
    }
  }, [title, notes])

  const handleShareFolder = useCallback(async () => {
    try {
      const ok = await shareExportToFolder(buildMeeting(note?.id ?? "draft"))
      if (ok) toast.success("Exported to folder")
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Export failed")
    }
  }, [buildMeeting, note])

  const handleShareSlack = useCallback(async () => {
    try {
      await shareViaSlack(title, notes)
      toast.success("Sent to Slack")
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Slack share failed")
    }
  }, [title, notes])

  const handleExportMarkdown = useCallback(async () => {
    try {
      const exported = await exportMeetingMarkdown(buildMeeting(note?.id ?? "draft"))
      if (exported) toast.success("Note exported")
      // false = save dialog cancelled, nothing to report
    } catch (e) {
      toast.error("Export failed", { description: e instanceof Error ? e.message : undefined })
    }
  }, [buildMeeting, note])

  const handleSave = useCallback(() => {
    const meeting = buildMeeting(note?.id ?? crypto.randomUUID())
    onSave(meeting)
    setSavedSnapshot({ title, notes, description })
    setJustSaved(true)
    if (savedTimerRef.current) clearTimeout(savedTimerRef.current)
    savedTimerRef.current = setTimeout(() => setJustSaved(false), 2000)
  }, [title, notes, description, note, onSave, buildMeeting])

  const handleSaveAndNew = useCallback(() => {
    onSave(buildMeeting(note?.id ?? crypto.randomUUID()), true)
    setTitle(settings.titlePrefix)
    setNotes("")
    setDescription("")
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
    // Fresh form is a clean slate, not dirty against the note we just saved.
    setSavedSnapshot({ title: settings.titlePrefix, notes: "", description: "" })
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

  // ⌘⇧F toggles focus mode; Esc exits it. We can't rely on e.defaultPrevented
  // here: ProseMirror's base keymap handles Escape (selectParentNode) and
  // preventDefaults even when nothing visible consumed it. Instead skip the
  // exit only when a nearer control demonstrably owns this Escape — a focused
  // input (find bar, link/AI fields, palette), an open slash menu (listbox),
  // or the floating AI popup.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && (e.key === "f" || e.key === "F")) {
        e.preventDefault()
        setFocusMode((v) => !v)
        return
      }
      if (e.key !== "Escape" || !focusModeRef.current) return
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return
      if (document.querySelector('[role="listbox"], .fixed.z-50')) return
      setFocusMode(false)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])

  useEffect(() => () => {
    abortCapture()
    if (savedTimerRef.current) clearTimeout(savedTimerRef.current)
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
      setSavedSnapshot({
        title: titleRef.current,
        notes: notesRef.current,
        description,
      })
      setJustSaved(true)
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current)
      savedTimerRef.current = setTimeout(() => setJustSaved(false), 2000)
    }, 1200)
    return () => { if (autosaveRef.current) clearTimeout(autosaveRef.current) }
  }, [notes, title, description, note, isDirty, isStreaming, isEnhancing, isTitling, onSave, buildMeeting])

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

  // AI chrome: "Enhancing" only while tokens are streaming.
  // isEnhancing may stay true for quieter post-work (recipes, knowledge) —
  // that must not keep the busy label/button after writing ends.
  const aiPhase: "idle" | "enhance" | "titling" = isStreaming
    ? "enhance"
    : isTitling
      ? "titling"
      : "idle"
  const aiBusy = aiPhase !== "idle"
  const enhanceBusy = isStreaming
  const chatAiState = chatStreaming ? "busy" : showAIPanel ? "active" : "idle"

  const statusLabel = aiPhase === "enhance"
    ? "Enhancing"
    : aiPhase === "titling"
      ? "Naming"
      : justSaved
        ? "Saved"
        : isDirty
          ? "Unsaved"
          : note
            ? "Autosave on"
            : "Ready"

  const audioSourceMeta = {
    mic: { label: "Mic", icon: MicIcon },
    system: { label: "System", icon: ComputerIcon },
    both: { label: "Both", icon: AiVoiceIcon },
  } as const
  const activeSource = audioSourceMeta[audioSource]
  const captureDockState =
    recorderState === "recording" ? (isPaused ? "paused" : "live") : isTranscribing ? "processing" : "idle"

  return (
    <TooltipProvider delayDuration={280}>
      <main className="editor-shell">
        <h1 className="sr-only">{note ? `Edit note: ${note.title}` : "New note"}</h1>

        <header data-tauri-drag-region className="editor-header">
          {/* Left — navigate + identity */}
          <div className="flex min-w-0 flex-1 items-center gap-1.5 sm:gap-2">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={onCancel}
                  className="size-8 shrink-0 rounded-xl text-muted-foreground hover:text-foreground"
                  aria-label="Back to dashboard"
                >
                  <HugeiconsIcon icon={ArrowLeft01Icon} strokeWidth={2} />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">Back</TooltipContent>
            </Tooltip>

            <div className="min-w-0 flex-1">
              <div className="flex min-w-0 items-center gap-2">
                <p className="truncate text-[13px] font-medium leading-tight tracking-tight">
                  {title.trim() || (note ? "Meeting note" : "New note")}
                </p>
                <span
                  className="editor-header-status shrink-0"
                  data-state={aiBusy ? "busy" : justSaved ? "saved" : isDirty ? "dirty" : undefined}
                  aria-live="polite"
                >
                  {aiBusy ? (
                    <>
                      <span className="ai-dot" data-ai="busy" />
                      <span className="ai-label" data-ai="busy">{statusLabel}</span>
                    </>
                  ) : (
                    <>
                      {isDirty ? (
                        <span className="size-1.5 shrink-0 rounded-full bg-amber-500" />
                      ) : justSaved ? (
                        <span className="size-1.5 shrink-0 rounded-full bg-emerald-500/80" />
                      ) : (
                        <span className="size-1.5 shrink-0 rounded-full bg-muted-foreground/30" />
                      )}
                      <span>{statusLabel}</span>
                    </>
                  )}
                </span>
              </div>
              <p className="mt-0.5 hidden truncate text-[11px] text-muted-foreground sm:block">
                {note ? "Meeting note" : "New note"}
                {selectedTemplate ? ` · ${selectedTemplate.name}` : ""}
              </p>
            </div>
          </div>

          {/* Right — tools cluster + save */}
          <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
            <div className="editor-header-cluster" role="toolbar" aria-label="Editor tools">
              {!focusMode && (
                <>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => setShowInfoPanel((v) => !v)}
                        aria-label={showInfoPanel ? "Hide info panel" : "Show info panel"}
                        aria-pressed={showInfoPanel}
                        className={cn(
                          "size-8 rounded-xl text-muted-foreground hover:text-foreground",
                          showInfoPanel && "bg-background text-foreground shadow-sm",
                        )}
                      >
                        <HugeiconsIcon icon={AlignBoxMiddleLeftIcon} strokeWidth={1.8} />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side="bottom">{showInfoPanel ? "Hide info" : "Show info"}</TooltipContent>
                  </Tooltip>

                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => setShowAIPanel((v) => !v)}
                        aria-label={showAIPanel ? "Hide chat" : "Show chat"}
                        aria-pressed={showAIPanel}
                        data-ai={chatAiState}
                        className={cn(
                          "size-8 rounded-xl",
                          chatAiState === "idle"
                            ? "text-muted-foreground hover:text-foreground"
                            : "text-brand",
                          (showAIPanel || chatStreaming) && "bg-background shadow-sm",
                          chatAiState !== "idle" && "ai-ring",
                        )}
                      >
                        <HugeiconsIcon
                          icon={AiChat02Icon}
                          strokeWidth={1.8}
                          className={chatAiState !== "idle" ? "ai-icon" : undefined}
                        />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side="bottom">{showAIPanel ? "Hide chat" : "Show chat"}</TooltipContent>
                  </Tooltip>

                  <div className="mx-0.5 h-4 w-px shrink-0 bg-border/70" aria-hidden />
                </>
              )}

              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setFocusMode((v) => !v)}
                    aria-label={focusMode ? "Exit focus mode" : "Enter focus mode"}
                    aria-pressed={focusMode}
                    className={cn(
                      "size-8 rounded-xl text-muted-foreground hover:text-foreground",
                      focusMode && "bg-background text-foreground shadow-sm",
                    )}
                  >
                    <HugeiconsIcon icon={CenterFocusIcon} strokeWidth={1.8} />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">{focusMode ? "Exit focus · ⌘⇧F" : "Focus mode · ⌘⇧F"}</TooltipContent>
              </Tooltip>
            </div>

            {!focusMode && (
              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleSaveAndNew}
                  className="hidden h-8 rounded-xl px-2.5 text-muted-foreground sm:inline-flex"
                >
                  Save &amp; new
                </Button>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      size="sm"
                      onClick={handleSave}
                      aria-label="Save note"
                      className="h-8 gap-1.5 rounded-xl px-3 active:scale-[0.96]"
                    >
                      <HugeiconsIcon icon={SaveIcon} strokeWidth={1.8} data-icon="inline-start" className="size-3.5" />
                      Save
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">Save · ⌘S</TooltipContent>
                </Tooltip>
              </div>
            )}
          </div>
        </header>

        <div className="editor-layout">
          {/* ── Left: meeting info, people, brief ───────────────────── */}
          <AnimatePresence initial={false}>
            {infoOpen && (
              <motion.aside
                key="info-panel"
                initial={{ width: 0, opacity: 0 }}
                animate={{ width: infoWidth, opacity: 1 }}
                exit={{ width: 0, opacity: 0 }}
                transition={transitions.width}
                className="editor-col-info overflow-hidden"
                aria-label="Meeting details"
              >
                <EditorInfoSidebar
                  dateIso={note?.date ?? new Date().toISOString()}
                  wordCount={noteStats.words}
                  template={selectedTemplate}
                  people={sidebarPeople}
                  related={relatedMeetings}
                  openLoops={openLoops}
                  isAddingSpeaker={isAddingSpeaker}
                  newSpeakerName={newSpeakerName}
                  onClose={() => setShowInfoPanel(false)}
                  onTemplateClick={() => setShowTemplatePicker(true)}
                  onAddSpeakerStart={() => setIsAddingSpeaker(true)}
                  onAddSpeakerConfirm={handleAddSpeaker}
                  onAddSpeakerCancel={() => {
                    setIsAddingSpeaker(false)
                    setNewSpeakerName("")
                  }}
                  onNewSpeakerNameChange={setNewSpeakerName}
                  onRemoveSpeaker={handleRemoveSpeaker}
                  onOpenRelated={(id) => {
                    if (note?.id !== id) {
                      window.dispatchEvent(new CustomEvent("navigate-meeting", { detail: { id } }))
                    }
                  }}
                  onToggleLoop={handleToggleLoop}
                />
              </motion.aside>
            )}
          </AnimatePresence>

          {/* ── Center: writing surface ─────────────────────────────── */}
          <section className="editor-col-main">
            <div className="scroll-fade min-h-0 flex-1 overflow-y-auto">
              <div className="editor-canvas">
                <div className="editor-title-row">
                  <textarea
                    ref={titleInputRef}
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    onKeyDown={(e) => {
                      // Titles wrap visually; keep Enter from inserting hard line breaks.
                      if (e.key === "Enter") e.preventDefault()
                    }}
                    rows={1}
                    placeholder="Untitled meeting"
                    aria-label="Note title"
                    className="editor-title-input"
                  />
                  {!focusMode && (
                    <div className="editor-title-action">
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={handleEnhanceTitle}
                            disabled={aiBusy || !notes.trim()}
                            aria-busy={aiPhase === "titling"}
                            data-ai={aiPhase === "titling" ? "busy" : "idle"}
                            className={cn(
                              "size-8 rounded-xl",
                              aiPhase === "titling" ? "text-brand" : "text-muted-foreground/45 hover:text-foreground",
                            )}
                            aria-label="Generate title with AI"
                          >
                            {aiPhase === "titling" ? (
                              <span className="size-3.5 animate-spin rounded-full border-2 border-brand/30 border-t-brand" />
                            ) : (
                              <HugeiconsIcon icon={AiMagicIcon} strokeWidth={1.5} className="opacity-70" />
                            )}
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent side="bottom">Generate title</TooltipContent>
                      </Tooltip>
                    </div>
                  )}
                </div>
                {!focusMode && (
                  <textarea
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    rows={2}
                    maxLength={280}
                    placeholder="Short description for the notes list…"
                    aria-label="Meeting description"
                    className="editor-description-input"
                  />
                )}

                <div className="editor-meta">
                  <span className="tabular-nums">
                    {formatDate(note?.date ?? new Date().toISOString())}
                  </span>
                  <span className="editor-meta-sep" aria-hidden>·</span>
                  <span className="tabular-nums">
                    {formatTime(note?.date ?? new Date().toISOString())}
                  </span>
                  {noteStats.words > 0 && (
                    <>
                      <span className="editor-meta-sep" aria-hidden>·</span>
                      <span title={`${noteStats.words.toLocaleString()} words`}>
                        {noteStats.words.toLocaleString()} {noteStats.words === 1 ? "word" : "words"}
                        <span className="text-muted-foreground/70"> · {noteStats.minutes} min</span>
                      </span>
                    </>
                  )}
                  {recorderState === "recording" && (
                    <>
                      <span className="editor-meta-sep" aria-hidden>·</span>
                      <Tabs
                        value={dualFocus}
                        onValueChange={(v) =>
                          setDualFocus(v as "notes" | "transcript" | "split")
                        }
                        variant="segment"
                        size="sm"
                      >
                        <TabsList aria-label="Recording layout">
                          <TabsTrigger value="notes">Notes</TabsTrigger>
                          <TabsTrigger value="split">Split</TabsTrigger>
                          <TabsTrigger value="transcript">Live</TabsTrigger>
                        </TabsList>
                      </Tabs>
                    </>
                  )}
                  {recorderState === "recording" && silenceSeconds > 30 && (
                    <>
                      <span className="editor-meta-sep" aria-hidden>·</span>
                      <span className="text-amber-600 dark:text-amber-400">Silent {silenceSeconds}s</span>
                    </>
                  )}
                </div>

                {/* Action digest / Standup / Follow-up — first-class, not under ⋯ */}
                {recorderState !== "recording" &&
                  !focusMode &&
                  (notes.trim() || manualNotes.trim() || Object.keys(recipeOutputs).length > 0) && (
                    <EditorArtifacts
                      recipes={loadRecipes()}
                      outputs={recipeOutputs}
                      activeId={activeArtifactId}
                      onActiveChange={setActiveArtifactId}
                      runningId={runningRecipeId}
                      onRun={(recipe) => void handleRunRecipe(recipe)}
                      onUpdateOutput={handleUpdateArtifactOutput}
                      canRun={Boolean(notes.trim() || manualNotes.trim() || rawTranscript.trim())}
                    />
                  )}

                <div className="mt-6 flex min-h-[28rem] flex-1 flex-col">
                  {enhanceBusy && (
                    <div className="ai-status mb-4" data-ai="busy">
                      <span className="size-3 animate-spin rounded-full border-2 border-brand/30 border-t-brand" />
                      <span className="ai-status-text">Enhancing note…</span>
                    </div>
                  )}

                  {recorderState === "recording" ? (
                    <div
                      className={cn(
                        "grid min-h-[24rem] flex-1 gap-3",
                        dualFocus === "split" ? "md:grid-cols-2" : "grid-cols-1",
                      )}
                    >
                      {(dualFocus === "notes" || dualFocus === "split") && (
                        <div className="editor-pane">
                          <div className="editor-pane-header border-b border-border/40">
                            <span>My notes</span>
                            <span className="font-normal text-muted-foreground/70">Private shorthand</span>
                          </div>
                          <textarea
                            className="min-h-[22rem] flex-1 resize-none bg-transparent px-3.5 py-3 text-sm leading-relaxed text-foreground outline-none placeholder:text-muted-foreground/60"
                            value={manualNotes}
                            onChange={(e) => setManualNotes(e.target.value)}
                            placeholder="Decisions, names, follow-ups…"
                            aria-label="My notes during recording"
                          />
                        </div>
                      )}
                      {(dualFocus === "transcript" || dualFocus === "split") && (
                        <div className="editor-pane bg-muted/20">
                          <div className="editor-pane-header border-b border-border/40">
                            <span>Live transcript</span>
                            <span className="inline-flex items-center gap-1.5 font-normal text-muted-foreground/70">
                              <span className="size-1.5 animate-pulse rounded-full bg-destructive" />
                              Auto
                            </span>
                          </div>
                          <pre className="scroll-fade min-h-[22rem] flex-1 overflow-y-auto whitespace-pre-wrap px-3.5 py-3 font-sans text-sm leading-relaxed text-muted-foreground">
                            {notes || "Listening…"}
                          </pre>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className={cn("flex min-h-0 flex-1 flex-col", viewMode === "wysiwyg" && "pb-10")}>
                      {showRawTranscript && rawTranscript ? (
                        <pre className="min-h-[24rem] flex-1 whitespace-pre-wrap font-sans text-sm leading-relaxed text-muted-foreground">
                          {rawTranscript}
                        </pre>
                      ) : (
                        <NoteRenderer
                          content={notes}
                          editable
                          onChange={setNotes}
                          viewMode={viewMode}
                          aiPopup={settings.aiSelectionPopup}
                          className="min-h-[24rem]"
                        />
                      )}
                      {manualNotes.trim() && !showRawTranscript && (
                        <details className="editor-pane mt-4 text-sm open:pb-1">
                          <summary className="cursor-pointer px-3.5 py-2.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground">
                            My notes from recording
                          </summary>
                          <pre className="whitespace-pre-wrap border-t border-border/40 px-3.5 py-2.5 font-sans text-sm leading-relaxed text-foreground">
                            {manualNotes}
                          </pre>
                        </details>
                      )}
                      {/* Custom recipes (non-artifact) still listed compactly */}
                      {Object.entries(recipeOutputs).some(
                        ([id]) => !(ARTIFACT_RECIPE_IDS as readonly string[]).includes(id),
                      ) && (
                        <div className="mt-4 flex flex-col gap-2">
                          <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                            Other recipes
                          </p>
                          {Object.entries(recipeOutputs)
                            .filter(([id]) => !(ARTIFACT_RECIPE_IDS as readonly string[]).includes(id))
                            .map(([id, out]) => {
                              const recipe = loadRecipes().find((r) => r.id === id)
                              return (
                                <details key={id} className="editor-pane text-sm open:pb-1">
                                  <summary className="cursor-pointer px-3.5 py-2.5 text-xs font-medium transition-colors hover:text-foreground">
                                    {recipe?.name ?? "Recipe"}
                                  </summary>
                                  <div className="border-t border-border/40 px-3.5 py-2.5">
                                    <MarkdownView markdown={out} />
                                  </div>
                                </details>
                              )
                            })}
                        </div>
                      )}
                    </div>
                  )}

                  {isEmpty && recorderState === "idle" && viewMode !== "source" && !focusMode && !enhanceBusy && (
                    <div className="mt-8 rounded-2xl bg-muted/40 px-4 py-4 ring-1 ring-foreground/5 dark:ring-foreground/10">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <p className="text-sm font-medium tracking-tight">Start capturing</p>
                          <p className="mt-0.5 text-xs text-muted-foreground">
                            Record the room, pick a template, or just start typing.
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          <Button variant="default" size="sm" onClick={startRecording}>
                            <HugeiconsIcon icon={AiVoiceIcon} strokeWidth={1.5} data-icon="inline-start" />
                            Record
                          </Button>
                          <Button variant="ghost" size="sm" onClick={() => setShowTemplatePicker(true)}>
                            Template
                          </Button>
                        </div>
                      </div>
                      <p className="mt-3 border-t border-border/40 pt-3 text-[11px] leading-relaxed text-muted-foreground/75">
                        <kbd className="rounded-md bg-background/80 px-1.5 py-0.5 font-sans ring-1 ring-border/60">/</kbd>{" "}
                        blocks · select text for format / AI ·{" "}
                        <kbd className="rounded-md bg-background/80 px-1.5 py-0.5 font-sans ring-1 ring-border/60">⌘⇧F</kbd>{" "}
                        focus ·{" "}
                        <kbd className="rounded-md bg-background/80 px-1.5 py-0.5 font-sans ring-1 ring-border/60">;trigger</kbd>{" "}
                        snippets ·{" "}
                        <button
                          type="button"
                          onClick={onSettings}
                          className="underline decoration-border underline-offset-2 transition-colors hover:text-foreground"
                        >
                          Settings
                        </button>
                      </p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </section>

          {/* ── Right: AI chat ──────────────────────────────────────── */}
          <AnimatePresence initial={false}>
            {chatOpen && (
              <motion.aside
                ref={chatPanelRef}
                key="chat-panel"
                initial={{ width: 0, opacity: 0.5 }}
                animate={{ width: chatWidth, opacity: 1 }}
                exit={{ width: 0, opacity: 0 }}
                transition={transitions.width}
                className="editor-col-chat overflow-hidden"
                aria-label="AI chat"
              >
                <div
                  className="absolute bottom-0 left-0 top-0 z-10 -ml-1 w-2 cursor-col-resize hover:bg-brand/15 active:bg-brand/25"
                  onMouseDown={(e) => {
                    e.preventDefault()
                    resizeRef.current = true
                    document.body.style.cursor = "col-resize"
                    document.body.style.userSelect = "none"
                  }}
                />
                <div className="flex shrink-0 items-center justify-between px-3.5 py-2.5">
                  <span className="flex items-center gap-2 text-sm font-medium tracking-tight">
                    <span className="ai-mark" data-ai={chatStreaming ? "busy" : "active"}>
                      <HugeiconsIcon icon={AiChat02Icon} strokeWidth={2} className="size-3.5 text-white" />
                    </span>
                    <span className="ai-label" data-ai={chatStreaming ? "busy" : "idle"}>
                      Chat
                    </span>
                  </span>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => setShowAIPanel(false)}
                    aria-label="Close chat"
                    className="text-muted-foreground"
                  >
                    <HugeiconsIcon icon={Cancel01Icon} strokeWidth={2} />
                  </Button>
                </div>
                <div className="flex min-h-0 flex-1 flex-col border-t border-border/40">
                  <div ref={chatScrollRef} className="scroll-fade flex flex-1 flex-col gap-3 overflow-y-auto px-3.5 py-3">
                    {messages.length === 0 && (
                      suggestedQuestions.length > 0 ? (
                        <div className="flex flex-col gap-2">
                          <p className="editor-side-label">Suggested</p>
                          {suggestedQuestions.map((q) => (
                            <button
                              key={q}
                              type="button"
                              className="rounded-xl bg-muted/50 px-3 py-2.5 text-left text-sm transition-colors hover:bg-muted disabled:opacity-50"
                              onClick={() => sendMessage(q)}
                              disabled={chatStreaming}
                            >
                              {q}
                            </button>
                          ))}
                        </div>
                      ) : (
                        <div className="app-empty py-10">
                          <p className="max-w-[15rem] text-sm text-muted-foreground">
                            Ask about decisions, owners, or open loops in this note.
                          </p>
                        </div>
                      )
                    )}
                    {messages.map((msg, i) => {
                      const isLast = i === messages.length - 1
                      return (
                        <motion.div
                          key={i}
                          variants={messageVariants}
                          initial="initial"
                          animate="animate"
                          transition={transitions.item}
                          className={cn(
                            "group flex flex-col gap-1",
                            msg.role === "user" ? "items-end" : "items-start",
                          )}
                        >
                          {msg.role === "user" ? (
                            <div className="max-w-[88%] whitespace-pre-wrap break-words rounded-2xl rounded-br-md bg-primary px-3 py-2 text-sm text-primary-foreground">
                              {msg.content}
                            </div>
                          ) : (
                            <div className="max-w-[92%] rounded-2xl rounded-bl-md bg-muted/70 px-3 py-2">
                              <MarkdownView markdown={msg.content} />
                              {isLast && lastIsStreaming && (
                                <span className="ml-0.5 inline-block h-4 w-1.5 animate-pulse bg-current align-middle" />
                              )}
                            </div>
                          )}
                          {msg.role === "assistant" && msg.content && !(isLast && lastIsStreaming) && (
                            <button
                              type="button"
                              onClick={() => copyMessage(msg.content, i)}
                              className="inline-flex items-center gap-1 text-[11px] text-muted-foreground/50 transition-colors duration-150 hover:text-foreground"
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
                        </motion.div>
                      )
                    })}
                    {chatError && (
                      <div className="flex flex-col items-center gap-2 py-2">
                        <div className="inline-flex items-center gap-1.5 text-center text-sm text-destructive" role="alert">
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
                  <div className="flex shrink-0 items-end gap-2 border-t border-border/40 p-3">
                    <Input
                      value={chatInput}
                      onChange={(e) => setChatInput(e.target.value)}
                      placeholder="Ask about this meeting…"
                      className="h-9 flex-1 rounded-2xl text-sm"
                      disabled={chatStreaming}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault()
                          sendMessage(chatInput)
                        }
                      }}
                    />
                    {chatStreaming ? (
                      <Button size="icon" variant="destructive" onClick={stopChatStreaming} aria-label="Stop generating">
                        <HugeiconsIcon icon={StopIcon} strokeWidth={2} />
                      </Button>
                    ) : (
                      <Button
                        size="icon"
                        onClick={() => sendMessage(chatInput)}
                        disabled={!chatInput.trim()}
                        aria-label="Send message"
                      >
                        <HugeiconsIcon icon={ArrowRight01Icon} strokeWidth={2} />
                      </Button>
                    )}
                  </div>
                </div>
              </motion.aside>
            )}
          </AnimatePresence>
        </div>

        {/* Floating capture dock — reachable during live recording even in focus mode */}
        {(!focusMode || recorderState === "recording" || isTranscribing) && (
          <footer className="editor-capture" data-state={captureDockState}>
            <div className="editor-capture-inner">
              <div
                className="editor-dock"
                data-state={captureDockState}
                role={recorderState === "recording" || isTranscribing ? "status" : undefined}
                aria-live={recorderState === "recording" || isTranscribing ? "polite" : undefined}
              >
                {recorderState === "recording" && isPaused && (
                  <>
                    <div className="editor-dock-status">
                      <span className="inline-flex size-2 shrink-0 rounded-full bg-amber-500" aria-hidden />
                      <span className="text-sm font-medium tabular-nums text-foreground">
                        {formatTimer((note?.duration ?? 0) + duration)}
                      </span>
                      <span className="text-xs font-medium text-amber-600 dark:text-amber-400">Paused</span>
                    </div>
                    <Button variant="secondary" size="sm" onClick={resumeRecording} className="h-9 shrink-0 gap-1.5 rounded-2xl px-3">
                      <HugeiconsIcon icon={PlayIcon} strokeWidth={2} className="size-3.5" />
                      Resume
                    </Button>
                    <Button variant="destructive" size="sm" onClick={stopRecording} className="h-9 shrink-0 gap-1.5 rounded-2xl px-3">
                      <HugeiconsIcon icon={StopIcon} strokeWidth={2} className="size-3.5" />
                      Stop
                    </Button>
                  </>
                )}

                {recorderState === "recording" && !isPaused && (
                  <>
                    <div className="editor-dock-status">
                      <span className="relative flex size-2 shrink-0" aria-hidden>
                        <span className="absolute inline-flex size-full animate-ping rounded-full bg-destructive/45 opacity-70" />
                        <span className="relative inline-flex size-2 rounded-full bg-destructive" />
                      </span>
                      <span className="text-[11px] font-semibold uppercase tracking-wide text-destructive">Rec</span>
                      <span className="text-sm font-medium tabular-nums text-foreground">
                        {formatTimer((note?.duration ?? 0) + duration)}
                      </span>
                      <Waveform active level={audioLevel} className="text-destructive" width={120} height={26} />
                      <span className="hidden text-xs text-muted-foreground md:inline">
                        {isSpeaking ? "Speaking" : silenceSeconds > 10 ? `Silent ${silenceSeconds}s` : "Listening"}
                      </span>
                    </div>
                    <div className="editor-dock-divider" aria-hidden />
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={pauseRecording}
                          className="size-9 shrink-0 rounded-2xl text-muted-foreground"
                          aria-label="Pause recording"
                        >
                          <HugeiconsIcon icon={PauseIcon} strokeWidth={2} />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent side="top">Pause</TooltipContent>
                    </Tooltip>
                    <Button variant="destructive" size="sm" onClick={stopRecording} className="h-9 shrink-0 gap-1.5 rounded-2xl px-3.5">
                      <HugeiconsIcon icon={StopIcon} strokeWidth={2} className="size-3.5" />
                      Stop
                    </Button>
                  </>
                )}

                {isTranscribing && (
                  <div className="editor-dock-status py-0.5">
                    <span className="size-3.5 animate-spin rounded-full border-2 border-brand/30 border-t-brand" />
                    <span className="text-sm text-muted-foreground">
                      Processing
                      <span className="ml-1.5 tabular-nums text-foreground">
                        {formatTimer((note?.duration ?? 0) + duration)}
                      </span>
                    </span>
                  </div>
                )}

                {recorderState === "idle" && !isTranscribing && (
                  <>
                    {/* Collapsed audio source: one control, full options in menu */}
                    <DropdownMenu>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-9 gap-1.5 rounded-2xl px-2.5 text-muted-foreground"
                              aria-label={`Audio source: ${activeSource.label}`}
                            >
                              <HugeiconsIcon icon={activeSource.icon} strokeWidth={1.6} className="size-3.5" />
                              <span className="hidden text-sm sm:inline">{activeSource.label}</span>
                              <HugeiconsIcon icon={ArrowDown01Icon} strokeWidth={2} className="size-3 opacity-50" />
                            </Button>
                          </DropdownMenuTrigger>
                        </TooltipTrigger>
                        <TooltipContent side="top">Audio source</TooltipContent>
                      </Tooltip>
                      <DropdownMenuContent align="start" className="min-w-48" side="top" sideOffset={8}>
                        <DropdownMenuLabel>Capture from</DropdownMenuLabel>
                        <DropdownMenuRadioGroup
                          value={audioSource}
                          onValueChange={(v) => setAudioSource(v as typeof audioSource)}
                        >
                          <DropdownMenuRadioItem value="mic">
                            <HugeiconsIcon icon={MicIcon} strokeWidth={1.6} className="size-3.5" />
                            Microphone
                          </DropdownMenuRadioItem>
                          <DropdownMenuRadioItem value="system">
                            <HugeiconsIcon icon={ComputerIcon} strokeWidth={1.6} className="size-3.5" />
                            System audio
                          </DropdownMenuRadioItem>
                          <DropdownMenuRadioItem value="both">
                            <HugeiconsIcon icon={AiVoiceIcon} strokeWidth={1.6} className="size-3.5" />
                            Both
                          </DropdownMenuRadioItem>
                        </DropdownMenuRadioGroup>
                        {audioSource !== "system" && devices.length > 1 && (
                          <>
                            <DropdownMenuSeparator />
                            <DropdownMenuLabel>Microphone</DropdownMenuLabel>
                            <DropdownMenuRadioGroup value={selectedDevice} onValueChange={setSelectedDevice}>
                              {devices.map((d) => (
                                <DropdownMenuRadioItem key={d.deviceId} value={d.deviceId}>
                                  <span className="truncate">{d.label}</span>
                                </DropdownMenuRadioItem>
                              ))}
                            </DropdownMenuRadioGroup>
                          </>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>

                    <div className="editor-dock-divider" aria-hidden />

                    <Button
                      variant="default"
                      onClick={startRecording}
                      className="h-9 gap-1.5 rounded-2xl px-4 active:scale-[0.96]"
                    >
                      <HugeiconsIcon icon={AiVoiceIcon} strokeWidth={1.5} data-icon="inline-start" />
                      Record
                    </Button>

                    {!focusMode && (
                      <>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => setShowTemplatePicker(true)}
                              className="h-9 gap-1.5 rounded-2xl px-2.5 text-muted-foreground"
                            >
                              {selectedTemplate ? (
                                <>
                                  <TemplateIcon name={selectedTemplate.icon} className="size-3.5" />
                                  <span className="hidden max-w-[6.5rem] truncate sm:inline">{selectedTemplate.name}</span>
                                </>
                              ) : (
                                <span className="hidden sm:inline">Template</span>
                              )}
                              {!selectedTemplate && (
                                <HugeiconsIcon icon={FileAddIcon} strokeWidth={1.5} className="size-3.5 sm:hidden" />
                              )}
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent side="top">Template for enhance</TooltipContent>
                        </Tooltip>

                        {/* Only after enhance finishes — not while the API is still running */}
                        {previousNotes && !enhanceBusy && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={handleUndoEnhance}
                            className="h-9 rounded-2xl px-2.5 text-amber-600 hover:text-amber-700"
                          >
                            Undo
                          </Button>
                        )}

                        {/* Glass orb enhance — coral→violet gradient from brand AI mark */}
                        {(notes.trim() || manualNotes.trim() || enhanceBusy) && (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={handleEnhance}
                                disabled={enhanceBusy}
                                aria-busy={enhanceBusy}
                                aria-label={enhanceBusy ? "Enhancing note" : "Enhance note"}
                                data-ai={enhanceBusy ? "busy" : "idle"}
                                className="ai-control ai-control--orb active:scale-[0.96] hover:bg-transparent dark:hover:bg-transparent"
                              >
                                <HugeiconsIcon
                                  icon={AiMagicIcon}
                                  strokeWidth={1.75}
                                  className="size-4 text-white drop-shadow-[0_0_6px_rgba(255,255,255,0.45)]"
                                />
                                <span className="ai-control-label">
                                  {enhanceBusy ? "Enhancing…" : "Enhance"}
                                </span>
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent side="top">
                              {enhanceBusy ? "Enhancing this note" : "Structure transcript into notes"}
                            </TooltipContent>
                          </Tooltip>
                        )}

                        <div className="editor-dock-divider" aria-hidden />

                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="size-9 rounded-2xl" aria-label="More note actions">
                              <HugeiconsIcon icon={MoreHorizontalIcon} strokeWidth={1.8} />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="min-w-56" side="top" sideOffset={8}>
                            <DropdownMenuLabel>Note</DropdownMenuLabel>
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
                              <DropdownMenuItem disabled={!notes.trim()} onSelect={handleCopyRichText}>
                                <HugeiconsIcon icon={Copy01Icon} strokeWidth={1.5} />
                                Copy rich text
                              </DropdownMenuItem>
                            </DropdownMenuGroup>
                            <DropdownMenuSeparator />
                            <DropdownMenuLabel>Share</DropdownMenuLabel>
                            <DropdownMenuGroup>
                              <DropdownMenuItem disabled={!notes.trim()} onSelect={handleShareEmail}>
                                <HugeiconsIcon icon={FileExportIcon} strokeWidth={1.5} />
                                Email draft…
                              </DropdownMenuItem>
                              <DropdownMenuItem disabled={!notes.trim()} onSelect={handleShareFolder}>
                                <HugeiconsIcon icon={FileExportIcon} strokeWidth={1.5} />
                                Export to folder
                              </DropdownMenuItem>
                              <DropdownMenuItem disabled={!notes.trim()} onSelect={handleShareSlack}>
                                <HugeiconsIcon icon={FileExportIcon} strokeWidth={1.5} />
                                Share to Slack
                              </DropdownMenuItem>
                              <DropdownMenuItem disabled={!notes.trim()} onSelect={handleExportMarkdown}>
                                <HugeiconsIcon icon={FileExportIcon} strokeWidth={1.5} />
                                Export as Markdown
                              </DropdownMenuItem>
                            </DropdownMenuGroup>
                            {loadRecipes().length > 0 && (
                              <>
                                <DropdownMenuSeparator />
                                <DropdownMenuLabel>Recipes</DropdownMenuLabel>
                                <DropdownMenuGroup>
                                  {loadRecipes().map((recipe) => (
                                    <DropdownMenuItem
                                      key={recipe.id}
                                      disabled={(!notes.trim() && !manualNotes.trim()) || runningRecipeId === recipe.id}
                                      onSelect={() => void handleRunRecipe(recipe)}
                                    >
                                      <HugeiconsIcon icon={AiMagicIcon} strokeWidth={1.5} />
                                      {runningRecipeId === recipe.id ? `Running ${recipe.name}…` : recipe.name}
                                    </DropdownMenuItem>
                                  ))}
                                </DropdownMenuGroup>
                              </>
                            )}
                            <DropdownMenuSeparator />
                            <DropdownMenuGroup>
                              <DropdownMenuItem onSelect={handleImportAudio}>
                                <HugeiconsIcon icon={FileImportIcon} strokeWidth={1.5} />
                                Import audio…
                              </DropdownMenuItem>
                              <DropdownMenuItem disabled={!notes.trim() || isEmpty} onSelect={handleSaveAsTemplate}>
                                <HugeiconsIcon icon={FileAddIcon} strokeWidth={1.5} />
                                Save as template
                              </DropdownMenuItem>
                              <DropdownMenuItem onSelect={() => setShowTemplatePicker(true)}>
                                <HugeiconsIcon icon={FileAddIcon} strokeWidth={1.5} />
                                Choose template…
                              </DropdownMenuItem>
                            </DropdownMenuGroup>
                          </DropdownMenuContent>
                        </DropdownMenu>

                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={onSettings}
                              className="size-9 rounded-2xl text-muted-foreground hover:text-foreground"
                              aria-label="Settings"
                            >
                              <HugeiconsIcon icon={Settings02Icon} strokeWidth={1.5} />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent side="top">Settings</TooltipContent>
                        </Tooltip>
                      </>
                    )}
                  </>
                )}
              </div>
            </div>
          </footer>
        )}

        {focusMode && recorderState !== "recording" && !isTranscribing && (
          <button
            type="button"
            onClick={() => setFocusMode(false)}
            className="fixed bottom-5 right-5 z-30 rounded-full bg-card/95 px-3.5 py-2 text-xs text-muted-foreground shadow-lg ring-1 ring-foreground/10 backdrop-blur transition-colors hover:text-foreground active:scale-[0.96]"
          >
            Focus · ⌘⇧F
          </button>
        )}

        <MeetingTemplateSelector
          selectedId={selectedTemplate?.id}
          onSelect={(tpl) => setSelectedTemplate(tpl)}
          open={showTemplatePicker}
          onOpenChange={setShowTemplatePicker}
        />
      </main>
    </TooltipProvider>
  )
}

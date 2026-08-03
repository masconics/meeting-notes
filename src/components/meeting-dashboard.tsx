import { Button } from "@/components/ui/button"
import {
  InputGroup,
  InputGroupInput,
  InputGroupButton,
} from "@/components/ui/input-group"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { HugeiconsIcon } from "@hugeicons/react"
import { cn } from "@/lib/utils"
import { formatTime, formatDuration, relativeDate } from "@/lib/format"
import {
  PlayListAddIcon,
  Cancel01Icon,
  FolderOpenIcon,
  DeleteIcon,
  Settings02Icon,
  AiMagicIcon,
  AiChat02Icon,
  Search01Icon,
  SortingAZIcon,
  ArrowDown01Icon,
  Bookmark01Icon,
  UserGroupIcon,
  CheckmarkCircle02Icon,
  FileImportIcon,
} from "@hugeicons/core-free-icons"
import type { Meeting } from "@/types"
import { useState, useMemo, useCallback, useRef, useEffect } from "react"
import { AnimatePresence, motion } from "framer-motion"
import { getTemplateById } from "@/lib/templates"
import { loadKnowledgeGraph, loadSavedSearches, saveSavedSearches, saveSortPreference } from "@/lib/storage"
import { toast } from "@/components/ui/toaster"
import { GlobalChat } from "@/components/global-chat"
import { MynaLogo } from "@/components/myna-logo"
import {
  listContainerVariants,
  listItemVariants,
  paneVariants,
  transitions,
} from "@/lib/motion"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  ActionsInbox,
  FolderChips,
  MeetingFolderMenu,
  PeopleMemory,
  UpcomingEvents,
  type DashboardPane,
} from "@/components/dashboard-views"

type SortKey = "date-desc" | "date-asc" | "duration-desc" | "duration-asc" | "title-asc" | "title-desc"

const SORT_LABELS: Record<SortKey, string> = {
  "date-desc": "Newest first",
  "date-asc": "Oldest first",
  "duration-desc": "Longest",
  "duration-asc": "Shortest",
  "title-asc": "A – Z",
  "title-desc": "Z – A",
}

function sortMeetings(meetings: Meeting[], key: SortKey): Meeting[] {
  const sorted = [...meetings]
  switch (key) {
    case "date-desc": return sorted.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
    case "date-asc": return sorted.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
    case "duration-desc": return sorted.sort((a, b) => b.duration - a.duration)
    case "duration-asc": return sorted.sort((a, b) => a.duration - b.duration)
    case "title-asc": return sorted.sort((a, b) => a.title.localeCompare(b.title))
    case "title-desc": return sorted.sort((a, b) => b.title.localeCompare(a.title))
    default: return sorted
  }
}

function getSearchableText(meeting: Meeting): string {
  const parts = [
    meeting.title,
    meeting.description,
    meeting.transcript,
    meeting.notes,
    meeting.enhancedNotes,
    ...(meeting.structuredNotes?.map((s) => `${s.title} ${s.content}`) ?? []),
  ]
  return parts.filter(Boolean).join(" ")
}

/** Granola-style day buckets for the notes list. */
function dayGroupLabel(dateStr: string): string {
  const date = new Date(dateStr)
  if (Number.isNaN(date.getTime())) return "Earlier"
  const now = new Date()
  const startOf = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  const day = startOf(date)
  const today = startOf(now)
  const diffDays = Math.round((today - day) / 86_400_000)
  if (diffDays === 0) return "Today"
  if (diffDays === 1) return "Yesterday"
  if (diffDays > 1 && diffDays < 7) return "This week"
  if (diffDays >= 7 && diffDays < 30) return "This month"
  return date.toLocaleDateString(undefined, { month: "long", year: "numeric" })
}

function groupMeetingsByDay(meetings: Meeting[]): { label: string; items: Meeting[] }[] {
  const order: string[] = []
  const map = new Map<string, Meeting[]>()
  for (const m of meetings) {
    const label = dayGroupLabel(m.date)
    if (!map.has(label)) {
      map.set(label, [])
      order.push(label)
    }
    map.get(label)!.push(m)
  }
  return order.map((label) => ({ label, items: map.get(label)! }))
}

function highlightMatches(text: string | null | undefined, query: string): React.ReactNode {
  if (!text || !query) return text ?? ""

  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  const regex = new RegExp(escaped, "gi")
  const parts: React.ReactNode[] = []
  let lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = regex.exec(text)) !== null) {
    const offset = match.index
    if (offset > lastIndex) {
      parts.push(text.slice(lastIndex, offset))
    }
    parts.push(<mark key={offset}>{match[0]}</mark>)
    lastIndex = offset + match[0].length
  }

  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex))
  }

  return parts.length > 0 ? <>{parts}</> : text
}

interface MeetingDashboardProps {
  meetings: Meeting[]
  onNewMeeting: () => void
  onImportMeeting: (meeting: Meeting) => void
  onDeleteMeeting: (id: string) => void
  onUpdateMeeting: (id: string, patch: Partial<Meeting>) => void
  onViewMeeting: (meeting: Meeting) => void
  onSettings: () => void
}

export function MeetingDashboard({
  meetings,
  onNewMeeting,
  onImportMeeting,
  onDeleteMeeting,
  onUpdateMeeting,
  onViewMeeting,
  onSettings,
}: MeetingDashboardProps) {
  const [searchQuery, setSearchQuery] = useState("")
  const [debouncedQuery, setDebouncedQuery] = useState("")
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const searchInputRef = useRef<HTMLInputElement | null>(null)
  const [pane, setPane] = useState<DashboardPane>(() => {
    try {
      const saved = sessionStorage.getItem("dashboard-pane") as DashboardPane | null
      if (saved === "actions" || saved === "people" || saved === "notes") {
        sessionStorage.removeItem("dashboard-pane")
        return saved
      }
    } catch { /* ignore */ }
    return "notes"
  })
  const [folderFilter, setFolderFilter] = useState<string | null>(null)
  const [folderTick, setFolderTick] = useState(0)
  const [chatFolderId, setChatFolderId] = useState<string | undefined>()

  // ⌘F on the dashboard jumps straight to search (dispatched from App).
  useEffect(() => {
    const handler = () => { searchInputRef.current?.focus(); searchInputRef.current?.select() }
    window.addEventListener("focus-dashboard-search", handler)
    return () => window.removeEventListener("focus-dashboard-search", handler)
  }, [])
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as { pane?: DashboardPane }
      if (detail?.pane === "actions" || detail?.pane === "people" || detail?.pane === "notes") {
        setPane(detail.pane)
      }
    }
    window.addEventListener("dashboard-pane", handler)
    return () => window.removeEventListener("dashboard-pane", handler)
  }, [])
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null)
  const [sortKey, setSortKey] = useState<SortKey>(() => {
    const saved = localStorage.getItem("meeting-notes-sort-pref")
    return (saved as SortKey) || "date-desc"
  })
  const [batchMode, setBatchMode] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [speakerFilter, setSpeakerFilter] = useState<string | null>(null)
  const [importing, setImporting] = useState(false)

  // Unique speaker names across all meetings, for the filter dropdown.
  const allSpeakers = useMemo(() => {
    const names = new Set<string>()
    for (const m of meetings) for (const s of m.speakerLabels ?? []) names.add(s.name)
    return [...names].sort((a, b) => a.localeCompare(b))
  }, [meetings])

  // Open action-item counts per meeting, from the knowledge graph.
  const openActionsByMeeting = useMemo(() => {
    const map = new Map<string, number>()
    for (const item of loadKnowledgeGraph().items) {
      if (item.kind === "action_item" && item.status === "open") {
        map.set(item.meetingId, (map.get(item.meetingId) ?? 0) + 1)
      }
    }
    return map
    // meetings is the practical recompute trigger (delete/undo re-renders here)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meetings])
  const [batchDeleteConfirm, setBatchDeleteConfirm] = useState(false)
  const [editingTitleId, setEditingTitleId] = useState<string | null>(null)
  const [editTitleText, setEditTitleText] = useState("")
  const [editingDescriptionId, setEditingDescriptionId] = useState<string | null>(null)
  const [editDescriptionText, setEditDescriptionText] = useState("")
  const [showGlobalChat, setShowGlobalChat] = useState(false)
  const [savedSearches, setSavedSearches] = useState<string[]>(() => loadSavedSearches())

  const sorted = useMemo(() => sortMeetings(meetings, sortKey), [meetings, sortKey])

  const filteredMeetings = useMemo(() => {
    let result = sorted
    if (folderFilter) {
      result = result.filter((m) => m.folderIds?.includes(folderFilter))
    }
    if (debouncedQuery.trim()) {
      const q = debouncedQuery.toLowerCase()
      result = result.filter((m) => getSearchableText(m).toLowerCase().includes(q))
    }
    if (speakerFilter) {
      result = result.filter((m) => m.speakerLabels?.some(s => s.name === speakerFilter))
    }
    return result
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sorted, debouncedQuery, speakerFilter, folderFilter, folderTick])

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      setDebouncedQuery(searchQuery)
    }, 250)
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current) }
  }, [searchQuery])

  const hasQuery = searchQuery.trim().length > 0

  const toggleSelect = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }, [])

  const handleSortChange = useCallback((key: SortKey) => {
    setSortKey(key)
    saveSortPreference(key)
  }, [])

  // Import an existing audio file → transcribe → create a note and open it.
  // Progress lives in a sticky toast the outcome toast replaces (same id).
  const handleImportAudio = useCallback(async () => {
    setImporting(true)
    toast("Transcribing audio file…", { id: "import-audio", duration: 0 })
    try {
      const { pickAndTranscribeAudio } = await import("@/lib/import-audio")
      const result = await pickAndTranscribeAudio()
      if (!result) { toast.dismiss("import-audio"); return }
      if (!result.text) { toast.error("No speech detected in that file", { id: "import-audio" }); return }
      const { correctWithSavedDictionary } = await import("@/lib/dictionary")
      const transcript = correctWithSavedDictionary(result.text)
      const meeting: Meeting = {
        id: crypto.randomUUID(),
        title: result.fileName.replace(/\.[^.]+$/, ""),
        date: new Date().toISOString(),
        duration: 0,
        transcript,
        notes: transcript,
      }
      toast.success("Audio transcribed", { id: "import-audio", description: result.fileName })
      onImportMeeting(meeting)
    } catch (e) {
      toast.error("Import failed", { id: "import-audio", description: e instanceof Error ? e.message : "Transcription failed" })
    } finally {
      setImporting(false)
    }
  }, [onImportMeeting])

  const handleSaveSearch = useCallback(() => {
    const trimmed = searchQuery.trim()
    if (!trimmed) return
    setSavedSearches((prev) => {
      if (prev.includes(trimmed)) return prev
      const next = [trimmed, ...prev]
      saveSavedSearches(next)
      return next
    })
  }, [searchQuery])

  const handleRemoveSavedSearch = useCallback((q: string) => {
    setSavedSearches((prev) => {
      const next = prev.filter((s) => s !== q)
      saveSavedSearches(next)
      return next
    })
  }, [])

  const handleSelectSavedSearch = useCallback((q: string) => {
    setSearchQuery(q)
    setDebouncedQuery(q)
    if (debounceRef.current) { clearTimeout(debounceRef.current); debounceRef.current = null }
  }, [])

  const selectAll = useCallback(() => {
    if (selected.size === filteredMeetings.length) {
      setSelected(new Set())
    } else {
      setSelected(new Set(filteredMeetings.map((m) => m.id)))
    }
  }, [filteredMeetings, selected.size])

  const handleBatchDelete = useCallback(() => {
    const ids = new Set(selected)
    setSelected(new Set())
    setBatchDeleteConfirm(false)
    setBatchMode(false)
    ids.forEach((id) => onDeleteMeeting(id))
  }, [selected, onDeleteMeeting])

  const handleTitleEditStart = useCallback((meeting: Meeting) => {
    setEditingDescriptionId(null)
    setEditingTitleId(meeting.id)
    setEditTitleText(meeting.title)
  }, [])

  const handleTitleEditSave = useCallback(() => {
    if (editingTitleId && editTitleText.trim()) {
      onUpdateMeeting(editingTitleId, { title: editTitleText.trim() })
    }
    setEditingTitleId(null)
    setEditTitleText("")
  }, [editingTitleId, editTitleText, onUpdateMeeting])

  const handleDescriptionEditStart = useCallback((meeting: Meeting) => {
    setEditingTitleId(null)
    setEditingDescriptionId(meeting.id)
    setEditDescriptionText(meeting.description ?? "")
  }, [])

  const handleDescriptionEditSave = useCallback(() => {
    if (editingDescriptionId) {
      const next = editDescriptionText.trim()
      onUpdateMeeting(editingDescriptionId, {
        description: next || undefined,
      })
    }
    setEditingDescriptionId(null)
    setEditDescriptionText("")
  }, [editingDescriptionId, editDescriptionText, onUpdateMeeting])

  const handleDescriptionEditCancel = useCallback(() => {
    setEditingDescriptionId(null)
    setEditDescriptionText("")
  }, [])

  const meetingGroups = useMemo(
    () => groupMeetingsByDay(filteredMeetings),
    [filteredMeetings],
  )

  return (
    <div className="dashboard-shell">
      {/* Granola-style top bar: nav center, actions right */}
      <header className="dashboard-topbar">
        <div className="dashboard-topbar-inner">
          <div className="flex min-w-0 items-center">
            <MynaLogo className="size-6 text-foreground" title="Myna Notes" />
          </div>

          <Tabs
            value={pane}
            onValueChange={(v) => setPane(v as DashboardPane)}
            variant="pill"
          >
            <TabsList aria-label="Dashboard views">
              <TabsTrigger value="notes">Notes</TabsTrigger>
              <TabsTrigger value="actions">Actions</TabsTrigger>
              <TabsTrigger value="people">People</TabsTrigger>
            </TabsList>
          </Tabs>

          <div className="flex items-center justify-end gap-1 sm:gap-1.5">
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => {
                setChatFolderId(folderFilter ?? undefined)
                setShowGlobalChat(true)
              }}
              title="Ask about all meetings"
              aria-label="Ask about all meetings"
              className="text-brand hover:text-brand"
            >
              <HugeiconsIcon icon={AiChat02Icon} strokeWidth={2} className="ai-icon" />
            </Button>
            <Button variant="ghost" size="icon-sm" onClick={onSettings} title="Settings" aria-label="Settings">
              <HugeiconsIcon icon={Settings02Icon} strokeWidth={2} />
            </Button>
            {pane === "notes" && (
              <>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={handleImportAudio}
                  disabled={importing}
                  title="Import audio"
                  aria-label="Import audio"
                  className="hidden sm:inline-flex"
                >
                  {importing ? (
                    <span className="size-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />
                  ) : (
                    <HugeiconsIcon icon={FileImportIcon} strokeWidth={2} />
                  )}
                </Button>
                <Button size="sm" onClick={onNewMeeting} className="ml-0.5">
                  <HugeiconsIcon icon={PlayListAddIcon} strokeWidth={2} data-icon="inline-start" />
                  New note
                </Button>
              </>
            )}
          </div>
        </div>
      </header>

      <div className="dashboard-body">
        <AnimatePresence mode="wait" initial={false}>
        {pane === "actions" ? (
          <motion.div
            key="actions"
            variants={paneVariants}
            initial="initial"
            animate="animate"
            exit="exit"
            transition={transitions.enter}
            className="flex min-h-0 flex-1 flex-col"
          >
            <ActionsInbox meetings={meetings} onOpenMeeting={onViewMeeting} />
          </motion.div>
        ) : pane === "people" ? (
          <motion.div
            key="people"
            variants={paneVariants}
            initial="initial"
            animate="animate"
            exit="exit"
            transition={transitions.enter}
            className="flex min-h-0 flex-1 flex-col"
          >
            <PeopleMemory meetings={meetings} onOpenMeeting={onViewMeeting} />
          </motion.div>
        ) : (
          <motion.div
            key="notes"
            variants={paneVariants}
            initial="initial"
            animate="animate"
            exit="exit"
            transition={transitions.enter}
            className="flex min-h-0 flex-1 flex-col gap-5"
          >
            <UpcomingEvents
              onStartFromEvent={(meeting) => {
                onImportMeeting(meeting)
              }}
            />
            {/* Search + filters — Linear-style: tags live in the toolbar, not a pill rail */}
            <div className="dashboard-filters">
              <div className="flex items-center gap-1.5">
                <InputGroup className="h-9 min-w-0 flex-1 border-0 bg-muted/40 shadow-none ring-1 ring-border/50">
                  <InputGroupInput
                    ref={searchInputRef}
                    type="search"
                    placeholder="Search notes…"
                    aria-label="Search notes"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                  />
                  {hasQuery ? (
                    <InputGroupButton
                      size="icon-sm"
                      onClick={() => {
                        setSearchQuery("")
                        setDebouncedQuery("")
                      }}
                      aria-label="Clear search"
                    >
                      <HugeiconsIcon icon={Cancel01Icon} strokeWidth={2} />
                    </InputGroupButton>
                  ) : (
                    <InputGroupButton
                      size="icon-sm"
                      tabIndex={-1}
                      className="pointer-events-none"
                      aria-label="Search notes"
                    >
                      <HugeiconsIcon icon={Search01Icon} strokeWidth={2} />
                    </InputGroupButton>
                  )}
                </InputGroup>
                <FolderChips
                  meetings={meetings}
                  folderFilter={folderFilter}
                  onFilter={setFolderFilter}
                  onFoldersChanged={() => setFolderTick((t) => t + 1)}
                  refreshKey={folderTick}
                />
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={handleSaveSearch}
                  disabled={!hasQuery}
                  title="Save search"
                  aria-label="Save search"
                >
                  <HugeiconsIcon icon={Bookmark01Icon} strokeWidth={2} />
                </Button>
                {allSpeakers.length > 0 && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant={speakerFilter ? "secondary" : "ghost"}
                        size="icon-sm"
                        title={speakerFilter ?? "Filter by speaker"}
                        aria-label="Filter by speaker"
                      >
                        <HugeiconsIcon icon={UserGroupIcon} strokeWidth={2} />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => setSpeakerFilter(null)}>
                        All speakers
                        {!speakerFilter && (
                          <HugeiconsIcon
                            icon={CheckmarkCircle02Icon}
                            strokeWidth={2}
                            className="ml-auto size-4"
                          />
                        )}
                      </DropdownMenuItem>
                      {allSpeakers.map((name) => (
                        <DropdownMenuItem key={name} onClick={() => setSpeakerFilter(name)}>
                          {name}
                          {name === speakerFilter && (
                            <HugeiconsIcon
                              icon={CheckmarkCircle02Icon}
                              strokeWidth={2}
                              className="ml-auto size-4"
                            />
                          )}
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon-sm" title={SORT_LABELS[sortKey]} aria-label="Sort notes">
                      <HugeiconsIcon icon={SortingAZIcon} strokeWidth={2} />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    {(Object.keys(SORT_LABELS) as SortKey[]).map((key) => (
                      <DropdownMenuItem key={key} onClick={() => handleSortChange(key)}>
                        {SORT_LABELS[key]}
                        {key === sortKey && (
                          <HugeiconsIcon icon={ArrowDown01Icon} strokeWidth={2} className="ml-auto size-4" />
                        )}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
              {savedSearches.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5">
                  {savedSearches.map((q) => (
                    <button
                      key={q}
                      type="button"
                      className="inline-flex items-center gap-1 rounded-full bg-muted/60 px-2.5 py-0.5 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                      onClick={() => handleSelectSavedSearch(q)}
                    >
                      {q}
                      <span
                        className="inline-flex size-3.5 items-center justify-center rounded-full hover:bg-muted-foreground/20"
                        onClick={(e) => {
                          e.stopPropagation()
                          handleRemoveSavedSearch(q)
                        }}
                        role="button"
                        aria-label={`Remove saved search "${q}"`}
                      >
                        <HugeiconsIcon icon={Cancel01Icon} strokeWidth={2} className="size-2.5" />
                      </span>
                    </button>
                  ))}
                </div>
              )}
              {meetings.length > 0 && filteredMeetings.length > 0 && (
                <div className="flex items-center justify-between pt-0.5">
                  <p className="text-[12px] tabular-nums text-muted-foreground">
                    {hasQuery
                      ? `${filteredMeetings.length} of ${meetings.length}`
                      : `${meetings.length} note${meetings.length === 1 ? "" : "s"}`}
                  </p>
                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="xs"
                      className="text-muted-foreground"
                      onClick={() => {
                        setBatchMode(!batchMode)
                        setSelected(new Set())
                      }}
                    >
                      {batchMode ? "Done" : "Select"}
                    </Button>
                    {batchMode && (
                      <>
                        <Button variant="ghost" size="xs" onClick={selectAll}>
                          {selected.size === filteredMeetings.length ? "Deselect all" : "Select all"}
                        </Button>
                        <Button
                          variant="destructive"
                          size="xs"
                          disabled={selected.size === 0}
                          onClick={() => setBatchDeleteConfirm(true)}
                        >
                          Delete ({selected.size})
                        </Button>
                      </>
                    )}
                  </div>
                </div>
              )}
            </div>

            {meetings.length === 0 ? (
              <div className="dashboard-empty">
                <div className="inline-flex size-12 items-center justify-center rounded-3xl bg-muted/70">
                  <HugeiconsIcon icon={FolderOpenIcon} strokeWidth={1.75} className="size-6 text-muted-foreground" />
                </div>
                <div className="max-w-sm text-center">
                  <p className="text-base font-medium">No notes yet</p>
                  <p className="mt-1 text-sm text-pretty text-muted-foreground">
                    Start a note, record mic or system audio, then Enhance for structured notes, tags, and actions.
                    Speech stays on this Mac.
                  </p>
                </div>
                <Button onClick={onNewMeeting}>
                  <HugeiconsIcon icon={PlayListAddIcon} strokeWidth={2} data-icon="inline-start" />
                  New note
                </Button>
              </div>
            ) : filteredMeetings.length === 0 ? (
              <div className="dashboard-empty">
                <p className="text-sm text-muted-foreground">
                  {folderFilter && !hasQuery
                    ? "No notes with this concept tag yet"
                    : hasQuery
                      ? `No notes match “${searchQuery}”`
                      : "No notes match these filters"}
                </p>
                <div className="flex flex-wrap items-center justify-center gap-2">
                  {folderFilter && (
                    <Button variant="outline" size="sm" onClick={() => setFolderFilter(null)}>
                      Clear tag filter
                    </Button>
                  )}
                  {hasQuery && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setSearchQuery("")
                        setDebouncedQuery("")
                      }}
                    >
                      Clear search
                    </Button>
                  )}
                </div>
              </div>
            ) : (
              <div
                className="flex flex-col gap-6"
                key={`list-${folderFilter ?? "all"}`}
              >
                {meetingGroups.map((group) => (
                  <section key={group.label} className="flex flex-col gap-2">
                    <h2 className="dashboard-day-label">{group.label}</h2>
                    <motion.ul
                      className="flex flex-col gap-2"
                      variants={listContainerVariants}
                      initial="initial"
                      animate="animate"
                    >
                      {group.items.map((meeting) => {
                        const template = meeting.templateId
                          ? getTemplateById(meeting.templateId)
                          : undefined
                        const previewText = meeting.description?.trim() || ""
                        const isEditing = editingTitleId === meeting.id
                        const isEditingDescription = editingDescriptionId === meeting.id
                        const isSelected = selected.has(meeting.id)
                        const openActions = openActionsByMeeting.get(meeting.id) ?? 0
                        const enhanced =
                          Boolean(meeting.autoEnhancedAt) ||
                          Boolean(meeting.structuredNotes?.length) ||
                          Boolean(meeting.description)

                        return (
                          <motion.li
                            key={meeting.id}
                            variants={listItemVariants}
                            transition={transitions.item}
                            layout={false}
                          >
                            <div
                              role="button"
                              tabIndex={0}
                              className={cn(
                                "dashboard-note-row group",
                                isSelected && "bg-primary/5 ring-1 ring-primary/25",
                              )}
                              onClick={() => {
                                if (batchMode) toggleSelect(meeting.id)
                                else onViewMeeting(meeting)
                              }}
                              onKeyDown={(e) => {
                                if (e.key === "Enter" || e.key === " ") {
                                  e.preventDefault()
                                  if (batchMode) toggleSelect(meeting.id)
                                  else onViewMeeting(meeting)
                                }
                              }}
                            >
                              {batchMode && (
                                <input
                                  type="checkbox"
                                  checked={isSelected}
                                  onChange={() => toggleSelect(meeting.id)}
                                  className="mt-1 size-4 shrink-0 rounded border-border"
                                  onClick={(e) => e.stopPropagation()}
                                  aria-label={`Select ${meeting.title}`}
                                />
                              )}
                              <div className="min-w-0 flex-1">
                                {isEditing ? (
                                  <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                                    <Input
                                      value={editTitleText}
                                      onChange={(e) => setEditTitleText(e.target.value)}
                                      className="h-8 text-[15px] font-semibold"
                                      autoFocus
                                      onKeyDown={(e) => {
                                        if (e.key === "Enter") handleTitleEditSave()
                                        if (e.key === "Escape") {
                                          setEditingTitleId(null)
                                          setEditTitleText("")
                                        }
                                      }}
                                    />
                                    <Button size="xs" variant="secondary" onClick={handleTitleEditSave}>
                                      Save
                                    </Button>
                                  </div>
                                ) : (
                                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                                    <h3
                                      className="truncate text-[15px] font-semibold tracking-tight text-foreground"
                                      title="Click to rename"
                                      onClick={(e) => {
                                        e.stopPropagation()
                                        handleTitleEditStart(meeting)
                                      }}
                                    >
                                      {highlightMatches(meeting.title, searchQuery)}
                                    </h3>
                                    {enhanced && (
                                      <span className="inline-flex items-center gap-0.5 text-[10px] font-medium text-brand">
                                        <HugeiconsIcon
                                          icon={AiMagicIcon}
                                          strokeWidth={1.75}
                                          className="ai-icon size-3"
                                        />
                                      </span>
                                    )}
                                    {openActions > 0 && (
                                      <span className="text-[11px] tabular-nums text-muted-foreground">
                                        {openActions} action{openActions === 1 ? "" : "s"}
                                      </span>
                                    )}
                                    {template && (
                                      <span className="hidden text-[11px] text-muted-foreground sm:inline">
                                        {template.name}
                                      </span>
                                    )}
                                  </div>
                                )}
                                {isEditingDescription ? (
                                  <div
                                    className="mt-1.5 flex flex-col gap-1.5"
                                    onClick={(e) => e.stopPropagation()}
                                  >
                                    <textarea
                                      value={editDescriptionText}
                                      onChange={(e) => setEditDescriptionText(e.target.value)}
                                      className="min-h-[3.25rem] w-full resize-none rounded-xl border-0 bg-muted/50 px-2.5 py-2 text-[13px] leading-relaxed text-foreground outline-none ring-1 ring-border/60 focus-visible:ring-2 focus-visible:ring-ring"
                                      rows={2}
                                      autoFocus
                                      maxLength={280}
                                      placeholder="Short description for this meeting…"
                                      aria-label="Meeting description"
                                      onKeyDown={(e) => {
                                        if (e.key === "Escape") {
                                          e.preventDefault()
                                          handleDescriptionEditCancel()
                                        }
                                        if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                                          e.preventDefault()
                                          handleDescriptionEditSave()
                                        }
                                      }}
                                      onBlur={() => handleDescriptionEditSave()}
                                    />
                                    <p className="text-[10px] text-muted-foreground">
                                      ⌘↵ to save · Esc to cancel
                                    </p>
                                  </div>
                                ) : previewText ? (
                                  <p
                                    className="mt-1 line-clamp-2 cursor-text text-[13px] leading-relaxed text-muted-foreground transition-colors hover:text-foreground/80"
                                    title="Click to edit description"
                                    onClick={(e) => {
                                      e.stopPropagation()
                                      handleDescriptionEditStart(meeting)
                                    }}
                                  >
                                    {highlightMatches(previewText, searchQuery)}
                                  </p>
                                ) : (
                                  <button
                                    type="button"
                                    className="mt-1 text-left text-[13px] text-muted-foreground/55 transition-colors hover:text-muted-foreground"
                                    onClick={(e) => {
                                      e.stopPropagation()
                                      handleDescriptionEditStart(meeting)
                                    }}
                                  >
                                    {meeting.duration > 0
                                      ? "Add a short description…"
                                      : "Empty note · Add description"}
                                  </button>
                                )}
                                <div className="mt-2 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[11px] tabular-nums text-muted-foreground/80">
                                  <span>{formatTime(meeting.date)}</span>
                                  {meeting.duration > 0 && (
                                    <>
                                      <span className="text-border">·</span>
                                      <span>{formatDuration(meeting.duration)}</span>
                                    </>
                                  )}
                                  {meeting.speakerLabels && meeting.speakerLabels.length > 0 && (
                                    <>
                                      <span className="text-border">·</span>
                                      <span className="truncate">
                                        {meeting.speakerLabels
                                          .slice(0, 3)
                                          .map((s) => s.name)
                                          .join(", ")}
                                        {meeting.speakerLabels.length > 3
                                          ? ` +${meeting.speakerLabels.length - 3}`
                                          : ""}
                                      </span>
                                    </>
                                  )}
                                </div>
                                <div className="mt-2">
                                  <MeetingFolderMenu
                                    meeting={meeting}
                                    onChanged={(folderIds) => {
                                      setFolderTick((t) => t + 1)
                                      // Push folderIds into app state so filter/list stay in sync
                                      // (storage already updated by assign/remove helpers).
                                      onUpdateMeeting(meeting.id, { folderIds })
                                    }}
                                    onTagClick={(tagId) => setFolderFilter(tagId)}
                                  />
                                </div>
                              </div>
                              <div className="flex shrink-0 flex-col items-end gap-2 self-start pt-0.5">
                                <span className="text-[11px] tabular-nums text-muted-foreground">
                                  {relativeDate(meeting.date)}
                                </span>
                                {!batchMode && (
                                  <Button
                                    variant="ghost"
                                    size="icon-xs"
                                    className="opacity-0 transition-opacity duration-150 ease-out group-hover:opacity-100"
                                    title="Delete note"
                                    aria-label="Delete note"
                                    onClick={(e) => {
                                      e.stopPropagation()
                                      setDeleteConfirm(meeting.id)
                                    }}
                                  >
                                    <HugeiconsIcon icon={DeleteIcon} strokeWidth={2} className="size-3.5" />
                                  </Button>
                                )}
                              </div>
                            </div>
                          </motion.li>
                        )
                      })}
                    </motion.ul>
                  </section>
                ))}
              </div>
            )}
          </motion.div>
        )}
        </AnimatePresence>
      </div>

      <Dialog open={!!deleteConfirm} onOpenChange={() => setDeleteConfirm(null)}>
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>Delete Note</DialogTitle>
            <DialogDescription>
              This note will be moved to trash. You can undo within 5 seconds.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteConfirm(null)}>Cancel</Button>
            <Button
              variant="destructive"
              onClick={() => {
                if (deleteConfirm) {
                  onDeleteMeeting(deleteConfirm)
                  setDeleteConfirm(null)
                }
              }}
            >
              <HugeiconsIcon icon={DeleteIcon} strokeWidth={2} data-icon="inline-start" />
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={batchDeleteConfirm} onOpenChange={setBatchDeleteConfirm}>
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>Delete {selected.size} Note{selected.size !== 1 ? "s" : ""}</DialogTitle>
            <DialogDescription>
              The selected notes will be moved to trash. You can undo within 5 seconds.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBatchDeleteConfirm(false)}>Cancel</Button>
            <Button variant="destructive" onClick={handleBatchDelete}>
              <HugeiconsIcon icon={DeleteIcon} strokeWidth={2} data-icon="inline-start" />
              Delete {selected.size} Meeting{selected.size !== 1 ? "s" : ""}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <GlobalChat
        meetings={meetings}
        open={showGlobalChat}
        onClose={() => setShowGlobalChat(false)}
        onOpenSettings={onSettings}
        folderId={chatFolderId}
      />
    </div>
  )
}

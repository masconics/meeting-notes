import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
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
import { motion } from "framer-motion"
import { cn } from "@/lib/utils"
import { formatTime, formatDuration, relativeDate } from "@/lib/format"
import {
  PlayListAddIcon,
  Cancel01Icon,
  FolderOpenIcon,
  DeleteIcon,
  Calendar01Icon,
  Clock01Icon,
  Settings02Icon,
  AiMagicIcon,
  AiChat02Icon,
  Search01Icon,
  SortingAZIcon,
  ArrowDown01Icon,
  AiBrain01Icon,
  Bookmark01Icon,
} from "@hugeicons/core-free-icons"
import type { Meeting } from "@/types"
import { useState, useMemo, useCallback, useRef, useEffect } from "react"
import { TemplateIcon } from "@/components/template-icon"
import { getTemplateById } from "@/lib/templates"
import { loadSavedSearches, saveSavedSearches, saveSortPreference } from "@/lib/storage"
import { MarkdownView } from "@/components/markdown-view"
import { GlobalChat } from "@/components/global-chat"

function stripMarkdown(md: string): string {
  return md
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/(\*{1,3}|_{1,3})(.*?)\1/g, "$2")
    .replace(/`{1,3}[^`]*`{1,3}/g, "")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^>\s*/gm, "")
    .replace(/^[-*+]\s+/gm, "")
    .replace(/^\d+\.\s+/gm, "")
    .replace(/^-{3,}|_{3,}|\*{3,}/gm, "")
    .replace(/\n{2,}/g, " · ")
    .replace(/\n/g, " ")
    .trim()
}

const stripMarkdownCache = new Map<string, string>()
function memoStripMarkdown(md: string): string {
  if (stripMarkdownCache.has(md)) return stripMarkdownCache.get(md)!
  const result = stripMarkdown(md)
  if (stripMarkdownCache.size > 500) stripMarkdownCache.clear()
  stripMarkdownCache.set(md, result)
  return result
}

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
    meeting.transcript,
    meeting.notes,
    meeting.enhancedNotes,
    ...(meeting.structuredNotes?.map((s) => `${s.title} ${s.content}`) ?? []),
  ]
  return parts.filter(Boolean).join(" ")
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
  pendingDelete?: Meeting | null
  onUndoDelete?: () => void
  onNewMeeting: () => void
  onDeleteMeeting: (id: string) => void
  onUpdateMeeting: (id: string, patch: Partial<Meeting>) => void
  onViewMeeting: (meeting: Meeting) => void
  onSettings: () => void
}

export function MeetingDashboard({
  meetings,
  pendingDelete,
  onUndoDelete,
  onNewMeeting,
  onDeleteMeeting,
  onUpdateMeeting,
  onViewMeeting,
  onSettings,
}: MeetingDashboardProps) {
  const [searchQuery, setSearchQuery] = useState("")
  const [debouncedQuery, setDebouncedQuery] = useState("")
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null)
  const [sortKey, setSortKey] = useState<SortKey>(() => {
    const saved = localStorage.getItem("meeting-notes-sort-pref")
    return (saved as SortKey) || "date-desc"
  })
  const [batchMode, setBatchMode] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [batchDeleteConfirm, setBatchDeleteConfirm] = useState(false)
  const [editingTitleId, setEditingTitleId] = useState<string | null>(null)
  const [editTitleText, setEditTitleText] = useState("")
  const [briefLoadingId, setBriefLoadingId] = useState<string | null>(null)
  const [briefResult, setBriefResult] = useState<string | null>(null)
  const [briefMeetingId, setBriefMeetingId] = useState<string | null>(null)
  const [showGlobalChat, setShowGlobalChat] = useState(false)
  const [savedSearches, setSavedSearches] = useState<string[]>(() => loadSavedSearches())

  const sorted = useMemo(() => sortMeetings(meetings, sortKey), [meetings, sortKey])

  const filteredMeetings = useMemo(() => {
    if (!debouncedQuery.trim()) return sorted
    const q = debouncedQuery.toLowerCase()
    return sorted.filter((m) => getSearchableText(m).toLowerCase().includes(q))
  }, [sorted, debouncedQuery])

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

  const handleGenerateBrief = useCallback(async (meeting: Meeting) => {
    setBriefLoadingId(meeting.id)
    setBriefResult(null)
    try {
      const { generateBrief, isAIConfigured } = await import("@/lib/ai-service")
      if (!isAIConfigured()) {
        setBriefResult("AI is not configured. Set your API key in Settings.")
        return
      }
      const { loadMeetings } = await import("@/lib/storage")
      const result = await generateBrief(meeting, loadMeetings())
      setBriefResult(result)
      setBriefMeetingId(meeting.id)
      onUpdateMeeting(meeting.id, { brief: result })
    } catch (e) {
      setBriefResult((e as Error).message)
    } finally {
      setBriefLoadingId(null)
    }
  }, [onUpdateMeeting])

  return (
    <div className="app-page">
      <div className="app-page-header">
        <div>
          <h1 className="app-page-title">Notes</h1>
          <p className="app-page-description">
            {meetings.length === 0
              ? "Create your first note"
              : hasQuery
                ? `${filteredMeetings.length} of ${meetings.length} note${meetings.length === 1 ? "" : "s"} match`
                : `${meetings.length} note${meetings.length === 1 ? "" : "s"}`}
          </p>
        </div>
        <div className="app-toolbar shrink-0">
          <Button variant="ghost" size="icon-sm" onClick={() => setShowGlobalChat(true)} title="Ask about all meetings" aria-label="Ask about all meetings">
            <HugeiconsIcon icon={AiChat02Icon} strokeWidth={2} />
          </Button>
          <Button variant="ghost" size="icon-sm" onClick={onSettings} title="Settings" aria-label="Settings">
            <HugeiconsIcon icon={Settings02Icon} strokeWidth={2} />
          </Button>
          <Button onClick={onNewMeeting}>
            <HugeiconsIcon icon={PlayListAddIcon} strokeWidth={2} data-icon="inline-start" />
            New Note
          </Button>
        </div>
      </div>

      <div className="app-toolbar flex-col items-stretch gap-2">
        <div className="flex items-center gap-2">
          <InputGroup className="h-8 flex-1 bg-transparent shadow-none ring-0">
            <InputGroupInput
              type="search"
              placeholder="Search notes..."
              aria-label="Search notes"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            {hasQuery ? (
              <InputGroupButton
                size="icon-sm"
                onClick={() => { setSearchQuery(""); setDebouncedQuery("") }}
                aria-label="Clear search"
              >
                <HugeiconsIcon icon={Cancel01Icon} strokeWidth={2} />
              </InputGroupButton>
            ) : (
              <InputGroupButton size="icon-sm" tabIndex={-1} className="pointer-events-none" aria-label="Search notes">
                <HugeiconsIcon icon={Search01Icon} strokeWidth={2} />
              </InputGroupButton>
            )}
          </InputGroup>
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
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" className="shrink-0">
                <HugeiconsIcon icon={SortingAZIcon} strokeWidth={2} data-icon="inline-start" />
                {SORT_LABELS[sortKey]}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {(Object.keys(SORT_LABELS) as SortKey[]).map((key) => (
                <DropdownMenuItem key={key} onClick={() => handleSortChange(key)}>
                  {SORT_LABELS[key]}
                  {key === sortKey && (
                    <HugeiconsIcon icon={ArrowDown01Icon} strokeWidth={2} className="size-4 ml-auto" />
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
                className="inline-flex items-center gap-1 rounded-full border border-border/60 bg-muted/50 px-2.5 py-0.5 text-xs text-muted-foreground hover:border-primary/30 hover:text-foreground transition-colors"
                onClick={() => handleSelectSavedSearch(q)}
              >
                {q}
                <span
                  className="inline-flex items-center justify-center size-3.5 rounded-full hover:bg-muted-foreground/20"
                  onClick={(e) => { e.stopPropagation(); handleRemoveSavedSearch(q) }}
                  role="button"
                  aria-label={`Remove saved search "${q}"`}
                >
                  <HugeiconsIcon icon={Cancel01Icon} strokeWidth={2} className="size-2.5" />
                </span>
              </button>
            ))}
          </div>
        )}
      </div>

      {pendingDelete && onUndoDelete && (
        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          className="app-alert border-destructive/30 text-destructive"
        >
          <p className="text-sm text-destructive">
            <span className="font-medium">"{pendingDelete.title}"</span> deleted.
          </p>
          <Button variant="destructive" size="sm" onClick={onUndoDelete}>
            Undo
          </Button>
        </motion.div>
      )}

      {meetings.length > 0 && filteredMeetings.length > 0 && (
        <div className="flex items-center justify-between border-b border-border/60 pb-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => { setBatchMode(!batchMode); setSelected(new Set()) }}
          >
            {batchMode ? "Done" : "Select"}
          </Button>
          {batchMode && (
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="sm" onClick={selectAll}>
                {selected.size === filteredMeetings.length ? "Deselect All" : "Select All"}
              </Button>
              {hasQuery && (
                <Button variant="ghost" size="sm" onClick={() => setSelected(new Set(filteredMeetings.map((m) => m.id)))}>
                  Select All Matching
                </Button>
              )}
              <Button
                variant="destructive"
                size="sm"
                disabled={selected.size === 0}
                onClick={() => setBatchDeleteConfirm(true)}
              >
                <HugeiconsIcon icon={DeleteIcon} strokeWidth={2} data-icon="inline-start" />
                Delete ({selected.size})
              </Button>
            </div>
          )}
        </div>
      )}

      {meetings.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="app-empty">
            <div className="inline-flex size-9 items-center justify-center rounded-2xl bg-muted ring-1 ring-border/70">
              <HugeiconsIcon icon={FolderOpenIcon} strokeWidth={2} className="size-5 text-muted-foreground" />
            </div>
            <p className="text-muted-foreground text-sm">No notes yet</p>
            <Button variant="outline" onClick={onNewMeeting}>
              Create your first note
            </Button>
          </CardContent>
        </Card>
      ) : filteredMeetings.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="app-empty">
            <p className="text-muted-foreground text-sm">No notes match "{searchQuery}"</p>
            <Button variant="outline" onClick={() => setSearchQuery("")}>
              Clear search
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="flex flex-col gap-3">
          {filteredMeetings.map((meeting) => {
            const template = meeting.templateId ? getTemplateById(meeting.templateId) : undefined
            const previewText = meeting.structuredNotes?.[0]?.content
              ? memoStripMarkdown(meeting.structuredNotes[0].content)
              : meeting.notes
                ? memoStripMarkdown(meeting.notes)
                : meeting.transcript?.replace(/\n/g, " ") || ""
            const isEditing = editingTitleId === meeting.id
            const isSelected = selected.has(meeting.id)
            return (
            <motion.div
              key={meeting.id}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.25, ease: "easeOut" }}
              whileHover={batchMode ? undefined : { scale: 1.01, y: -1 }}
              whileTap={batchMode ? undefined : { scale: 0.99 }}
            >
            <Card
              size="sm"
              role="button"
              tabIndex={0}
              className={cn(
                "transition-colors hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring outline-none",
                !batchMode && "cursor-pointer",
                isSelected && "ring-2 ring-primary/50"
              )}
              onClick={() => {
                if (batchMode) {
                  toggleSelect(meeting.id)
                } else {
                  onViewMeeting(meeting)
                }
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault()
                  if (batchMode) {
                    toggleSelect(meeting.id)
                  } else {
                    onViewMeeting(meeting)
                  }
                }
              }}
            >
              <CardHeader>
                <div className="flex items-start justify-between gap-2">
                  <div className="flex flex-col gap-1 min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      {batchMode && (
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleSelect(meeting.id)}
                          className="size-4 rounded border-border shrink-0 mt-0.5"
                          onClick={(e) => e.stopPropagation()}
                        />
                      )}
                      {isEditing ? (
                        <div className="flex items-center gap-1 flex-1">
                          <Input
                            value={editTitleText}
                            onChange={(e) => setEditTitleText(e.target.value)}
                            className="h-7 text-base font-semibold"
                            autoFocus
                            onKeyDown={(e) => {
                              if (e.key === "Enter") handleTitleEditSave()
                              if (e.key === "Escape") {
                                setEditingTitleId(null)
                                setEditTitleText("")
                              }
                            }}
                            onClick={(e) => e.stopPropagation()}
                          />
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            onClick={(e) => { e.stopPropagation(); handleTitleEditSave() }}
                          >
                            Save
                          </Button>
                        </div>
                      ) : (
                        <CardTitle
                          className="text-base cursor-pointer hover:text-primary transition-colors"
                          onClick={(e) => {
                            e.stopPropagation()
                            handleTitleEditStart(meeting)
                          }}
                          title="Click to rename"
                        >
                          {highlightMatches(meeting.title, searchQuery)}
                        </CardTitle>
                      )}
                      {template && (
                        <Badge variant="outline" className="text-[10px] py-0 gap-1">
                          <TemplateIcon name={template.icon} className="size-3" inline />
                          {template.name}
                        </Badge>
                      )}
                      {meeting.structuredNotes && meeting.structuredNotes.length > 0 && (
                        <Badge variant="secondary" className="text-[10px] py-0 gap-1">
                          <HugeiconsIcon icon={AiMagicIcon} strokeWidth={1.5} className="size-3" />
                          Enhanced
                        </Badge>
                      )}
                    </div>
                    <CardDescription className="flex items-center gap-3">
                      <span className="inline-flex items-center gap-1">
                        <HugeiconsIcon icon={Calendar01Icon} strokeWidth={1.5} className="size-3" />
                        {relativeDate(meeting.date)}
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <HugeiconsIcon icon={Clock01Icon} strokeWidth={1.5} className="size-3" />
                        {formatTime(meeting.date)}
                      </span>
                    </CardDescription>
                  </div>
                  <Badge variant="secondary">{formatDuration(meeting.duration)}</Badge>
                </div>
              </CardHeader>
              {previewText && (
                <CardContent className="pt-0 pb-0">
                  <p className="text-xs text-muted-foreground line-clamp-2 leading-relaxed">
                    {highlightMatches(previewText, searchQuery)}
                  </p>
                </CardContent>
              )}
              {!batchMode && (
              <CardFooter className="justify-end gap-1 pt-3">
                <Button
                  variant="ghost"
                  size="sm"
                  title="Generate brief"
                  aria-label="Generate brief"
                  onClick={(e) => { e.stopPropagation(); handleGenerateBrief(meeting) }}
                  disabled={briefLoadingId === meeting.id}
                >
                  <HugeiconsIcon icon={AiBrain01Icon} strokeWidth={2} className="size-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  title="Delete note"
                  aria-label="Delete note"
                  onClick={(e) => { e.stopPropagation(); setDeleteConfirm(meeting.id) }}
                >
                  <HugeiconsIcon icon={DeleteIcon} strokeWidth={2} className="size-4" />
                </Button>
              </CardFooter>
              )}
            </Card>
            {briefMeetingId === meeting.id && briefResult && (
              <Card size="sm" className="border-primary/30 mt-2">
                <CardHeader className="py-2.5 cursor-pointer" onClick={() => { setBriefMeetingId(null); setBriefResult(null) }}>
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-xs flex items-center gap-1.5">
                      <HugeiconsIcon icon={AiBrain01Icon} strokeWidth={2} className="size-3.5 text-primary" />
                      Pre-Meeting Brief
                    </CardTitle>
                    <Button variant="ghost" size="icon-sm" className="size-5" type="button" onClick={(e) => { e.stopPropagation(); setBriefMeetingId(null); setBriefResult(null) }}>
                      <HugeiconsIcon icon={Cancel01Icon} strokeWidth={2} className="size-3" />
                    </Button>
                  </div>
                </CardHeader>
                <CardContent className="pt-0">
                  <div className="mdx-brief text-xs leading-relaxed text-muted-foreground max-h-48 overflow-y-auto">
                    <MarkdownView markdown={briefResult} />
                  </div>
                </CardContent>
              </Card>
            )}
            {briefLoadingId === meeting.id && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground px-1 py-1.5">
                <div className="size-3 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                Generating brief...
              </div>
            )}
            </motion.div>
          )})}
        </div>
      )}

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
      />
    </div>
  )
}

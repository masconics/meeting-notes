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
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { HugeiconsIcon } from "@hugeicons/react"
import { motion } from "framer-motion"
import { cn } from "@/lib/utils"
import {
  PlayListAddIcon,
  Cancel01Icon,
  FolderOpenIcon,
  DeleteIcon,
  Calendar01Icon,
  Clock01Icon,
  Settings02Icon,
  AiChat02Icon,
  AiMagicIcon,
  Search01Icon,
  SortingAZIcon,
  ArrowDown01Icon,
} from "@hugeicons/core-free-icons"
import type { Meeting } from "@/types"
import { useState, useMemo, useCallback } from "react"
import { TemplateIcon } from "@/components/template-icon"
import { getTemplateById } from "@/lib/templates"

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

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  if (m === 0) return `${s}s`
  return `${m}m ${s}s`
}

function relativeDate(iso: string): string {
  const now = new Date()
  const date = new Date(iso)
  const diffMs = now.getTime() - date.getTime()
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))

  if (diffDays === 0) return "Today"
  if (diffDays === 1) return "Yesterday"
  if (diffDays < 7) return `${diffDays}d ago`
  if (diffDays < 30) return `${Math.floor(diffDays / 7)}w ago`
  return formatDate(iso)
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
  onNewMeeting: () => void
  onDeleteMeeting: (id: string) => void
  onUpdateMeeting: (id: string, patch: Partial<Meeting>) => void
  onChatMeeting: (meeting: Meeting) => void
  onViewMeeting: (meeting: Meeting) => void
  onSettings: () => void
}

export function MeetingDashboard({
  meetings,
  onNewMeeting,
  onDeleteMeeting,
  onUpdateMeeting,
  onChatMeeting,
  onViewMeeting,
  onSettings,
}: MeetingDashboardProps) {
  const [searchQuery, setSearchQuery] = useState("")
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null)
  const [sortKey, setSortKey] = useState<SortKey>("date-desc")
  const [batchMode, setBatchMode] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [batchDeleteConfirm, setBatchDeleteConfirm] = useState(false)
  const [editingTitleId, setEditingTitleId] = useState<string | null>(null)
  const [editTitleText, setEditTitleText] = useState("")

  const sorted = useMemo(() => sortMeetings(meetings, sortKey), [meetings, sortKey])

  const filteredMeetings = useMemo(() => {
    if (!searchQuery.trim()) return sorted
    const q = searchQuery.toLowerCase()
    return sorted.filter((m) => getSearchableText(m).toLowerCase().includes(q))
  }, [sorted, searchQuery])

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

  const selectAll = useCallback(() => {
    if (selected.size === filteredMeetings.length) {
      setSelected(new Set())
    } else {
      setSelected(new Set(filteredMeetings.map((m) => m.id)))
    }
  }, [filteredMeetings, selected.size])

  const handleBatchDelete = useCallback(() => {
    selected.forEach((id) => onDeleteMeeting(id))
    setSelected(new Set())
    setBatchDeleteConfirm(false)
    setBatchMode(false)
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

  return (
    <div className="flex flex-col gap-6 w-full max-w-3xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-heading text-2xl font-medium">Meeting Notes</h1>
          <p className="text-muted-foreground text-sm mt-1">
            {meetings.length === 0
              ? "Record your first meeting"
              : hasQuery
                ? `${filteredMeetings.length} of ${meetings.length} meeting${meetings.length === 1 ? "" : "s"} match`
                : `${meetings.length} meeting${meetings.length === 1 ? "" : "s"} saved`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon-sm" onClick={onSettings} title="Settings" aria-label="Settings">
            <HugeiconsIcon icon={Settings02Icon} strokeWidth={2} />
          </Button>
          <Button onClick={onNewMeeting}>
            <HugeiconsIcon icon={PlayListAddIcon} strokeWidth={2} data-icon="inline-start" />
            New Meeting
          </Button>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <InputGroup className="h-9 flex-1">
          <InputGroupInput
            type="search"
            placeholder="Search meetings..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          {hasQuery ? (
            <InputGroupButton
              size="icon-sm"
              onClick={() => setSearchQuery("")}
              aria-label="Clear search"
            >
              <HugeiconsIcon icon={Cancel01Icon} strokeWidth={2} />
            </InputGroupButton>
          ) : (
            <InputGroupButton size="icon-sm" tabIndex={-1} className="pointer-events-none">
              <HugeiconsIcon icon={Search01Icon} strokeWidth={2} />
            </InputGroupButton>
          )}
        </InputGroup>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="h-9 shrink-0">
              <HugeiconsIcon icon={SortingAZIcon} strokeWidth={2} data-icon="inline-start" />
              {SORT_LABELS[sortKey]}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {(Object.keys(SORT_LABELS) as SortKey[]).map((key) => (
              <DropdownMenuItem key={key} onClick={() => setSortKey(key)}>
                {SORT_LABELS[key]}
                {key === sortKey && (
                  <HugeiconsIcon icon={ArrowDown01Icon} strokeWidth={2} className="size-4 ml-auto" />
                )}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {meetings.length > 0 && filteredMeetings.length > 0 && (
        <div className="flex items-center justify-between">
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
          <CardContent className="flex flex-col items-center gap-3 py-12">
            <div className="bg-muted inline-flex size-12 items-center justify-center rounded-full">
              <HugeiconsIcon icon={FolderOpenIcon} strokeWidth={2} className="size-6 text-muted-foreground" />
            </div>
            <p className="text-muted-foreground text-sm">No meetings yet</p>
            <Button variant="outline" onClick={onNewMeeting}>
              Start your first meeting
            </Button>
          </CardContent>
        </Card>
      ) : filteredMeetings.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center gap-3 py-12">
            <p className="text-muted-foreground text-sm">No meetings match "{searchQuery}"</p>
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
              ? meeting.structuredNotes[0].content.replace(/^[•\-\s]+/, "")
              : meeting.notes
                ? meeting.notes.replace(/\n/g, " · ")
                : meeting.transcript.replace(/\n/g, " ")
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
              className={cn(
                "hover:bg-muted/50 hover:shadow-sm transition-colors",
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
            >
              <CardHeader className="pb-3">
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
              <CardFooter className="justify-end gap-2 pt-3">
                <Button
                  variant="ghost"
                  size="sm"
                  title="Chat about this meeting"
                  aria-label="Chat about meeting"
                  onClick={(e) => {
                    e.stopPropagation()
                    onChatMeeting(meeting)
                  }}
                >
                  <HugeiconsIcon icon={AiChat02Icon} strokeWidth={2} className="size-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  title="Delete meeting"
                  aria-label="Delete meeting"
                  onClick={(e) => {
                    e.stopPropagation()
                    setDeleteConfirm(meeting.id)
                  }}
                >
                  <HugeiconsIcon icon={DeleteIcon} strokeWidth={2} className="size-4" />
                </Button>
              </CardFooter>
              )}
            </Card>
            </motion.div>
          )})}
        </div>
      )}

      <Dialog open={!!deleteConfirm} onOpenChange={() => setDeleteConfirm(null)}>
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>Delete Meeting</DialogTitle>
            <DialogDescription>
              This action cannot be undone. The transcript and notes will be permanently removed.
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
            <DialogTitle>Delete {selected.size} Meeting{selected.size !== 1 ? "s" : ""}</DialogTitle>
            <DialogDescription>
              This action cannot be undone. The selected transcripts and notes will be permanently removed.
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
    </div>
  )
}


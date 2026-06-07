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
import { HugeiconsIcon } from "@hugeicons/react"
import { motion } from "framer-motion"
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
} from "@hugeicons/core-free-icons"
import type { Meeting } from "@/types"
import { useState, useMemo } from "react"
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
  onUpdateMeeting: _onUpdateMeeting,
  onChatMeeting,
  onViewMeeting,
  onSettings,
}: MeetingDashboardProps) {
  const [searchQuery, setSearchQuery] = useState("")
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null)

  const filteredMeetings = useMemo(() => {
    if (!searchQuery.trim()) return meetings
    const q = searchQuery.toLowerCase()
    return meetings.filter((m) => getSearchableText(m).toLowerCase().includes(q))
  }, [meetings, searchQuery])

  const hasQuery = searchQuery.trim().length > 0

  return (
    <div className="flex flex-col gap-6 w-full max-w-2xl mx-auto">
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
          <Button variant="ghost" size="icon-sm" onClick={onSettings}>
            <HugeiconsIcon icon={Settings02Icon} strokeWidth={2} />
          </Button>
          <Button onClick={onNewMeeting}>
            <HugeiconsIcon icon={PlayListAddIcon} strokeWidth={2} data-icon="inline-start" />
            New Meeting
          </Button>
        </div>
      </div>

      <InputGroup className="h-9">
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
            return (
            <motion.div
              key={meeting.id}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.25, ease: "easeOut" }}
              whileHover={{ scale: 1.01, y: -1 }}
              whileTap={{ scale: 0.99 }}
            >
            <Card
              className="cursor-pointer hover:bg-muted/50 hover:shadow-sm transition-colors"
              onClick={() => onViewMeeting(meeting)}
            >
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex flex-col gap-1 min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <CardTitle className="text-base">
                        {highlightMatches(meeting.title, searchQuery)}
                      </CardTitle>
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
                        {formatDate(meeting.date)}
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
              <CardFooter className="justify-end gap-2 pt-3">
                <Button
                  variant="ghost"
                  size="sm"
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
                  onClick={(e) => {
                    e.stopPropagation()
                    setDeleteConfirm(meeting.id)
                  }}
                >
                  <HugeiconsIcon icon={Cancel01Icon} strokeWidth={2} className="size-4" />
                </Button>
              </CardFooter>
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
    </div>
  )
}

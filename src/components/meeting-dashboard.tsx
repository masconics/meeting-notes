import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { HugeiconsIcon } from "@hugeicons/react"
import {
  PlayListAddIcon,
  Cancel01Icon,
  FolderOpenIcon,
  DeleteIcon,
  Calendar01Icon,
  Clock01Icon,
  Settings02Icon,
} from "@hugeicons/core-free-icons"
import type { Meeting } from "@/types"
import { useState } from "react"

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

interface MeetingDashboardProps {
  meetings: Meeting[]
  onNewMeeting: () => void
  onDeleteMeeting: (id: string) => void
  onViewMeeting: (meeting: Meeting) => void
  onSettings: () => void
}

export function MeetingDashboard({
  meetings,
  onNewMeeting,
  onDeleteMeeting,
  onViewMeeting,
  onSettings,
}: MeetingDashboardProps) {
  const [viewing, setViewing] = useState<Meeting | null>(null)
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null)

  return (
    <div className="flex flex-col gap-6 w-full max-w-2xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-heading text-2xl font-medium">Meeting Notes</h1>
          <p className="text-muted-foreground text-sm mt-1">
            {meetings.length === 0
              ? "Record your first meeting"
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
      ) : (
        <div className="flex flex-col gap-3">
          {meetings.map((meeting) => (
            <Card
              key={meeting.id}
              className="cursor-pointer hover:bg-muted/50 transition-colors"
              onClick={() => {
                setViewing(meeting)
                onViewMeeting(meeting)
              }}
            >
              <CardHeader>
                <div className="flex items-start justify-between gap-2">
                  <div className="flex flex-col gap-1">
                    <CardTitle className="text-base">{meeting.title}</CardTitle>
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
              <CardFooter className="justify-end gap-2">
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
          ))}
        </div>
      )}

      <Dialog open={!!viewing} onOpenChange={() => setViewing(null)}>
        <DialogContent className="sm:max-w-lg max-h-[80vh] overflow-y-auto" showCloseButton={false}>
          {viewing && (
            <>
              <DialogHeader>
                <DialogTitle>{viewing.title}</DialogTitle>
                <DialogDescription>
                  {formatDate(viewing.date)} at {formatTime(viewing.date)} &middot; {formatDuration(viewing.duration)}
                </DialogDescription>
              </DialogHeader>
              {viewing.transcript && (
                <div className="flex flex-col gap-1.5">
                  <div className="text-xs font-medium text-muted-foreground">Transcription</div>
                  <div className="text-sm text-foreground bg-muted rounded-2xl p-3 whitespace-pre-wrap">
                    {viewing.transcript}
                  </div>
                </div>
              )}
              {viewing.notes && (
                <div className="flex flex-col gap-1.5">
                  <div className="text-xs font-medium text-muted-foreground">Notes</div>
                  <div className="text-sm text-foreground bg-muted rounded-2xl p-3 whitespace-pre-wrap">
                    {viewing.notes}
                  </div>
                </div>
              )}
              <DialogFooter>
                <Button variant="outline" onClick={() => setViewing(null)}>Close</Button>
                <Button
                  variant="destructive"
                  onClick={() => {
                    onDeleteMeeting(viewing.id)
                    setViewing(null)
                  }}
                >
                  <HugeiconsIcon icon={DeleteIcon} strokeWidth={2} data-icon="inline-start" />
                  Delete
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

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

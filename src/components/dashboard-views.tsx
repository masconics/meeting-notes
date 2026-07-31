import { useCallback, useEffect, useMemo, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  InputGroup,
  InputGroupInput,
  InputGroupButton,
} from "@/components/ui/input-group"
import { Textarea } from "@/components/ui/textarea"
import { Badge } from "@/components/ui/badge"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { HugeiconsIcon } from "@hugeicons/react"
import {
  Add01Icon,
  Cancel01Icon,
  CheckListIcon,
  CheckmarkCircle02Icon,
  DeleteIcon,
  FolderOpenIcon,
  MoreHorizontalIcon,
  PencilEdit01Icon,
  RefreshIcon,
  Search01Icon,
  TagsIcon,
  UserGroupIcon,
  UserIcon,
} from "@hugeicons/core-free-icons"
import { invoke } from "@tauri-apps/api/core"
import { toast } from "@/components/ui/toaster"
import {
  assignMeetingToFolder,
  createFolder,
  deleteFolder,
  loadFolders,
  loadKnowledgeGraph,
  loadPeople,
  removeMeetingFromFolder,
  updateFolder,
  updateKnowledgeItem,
  updatePerson,
  ensurePerson,
  linkPeopleFromMeeting,
  loadSettings,
} from "@/lib/storage"
import { relativeDate } from "@/lib/format"
import { cn } from "@/lib/utils"
import type { CalendarEvent, Folder, KnowledgeItem, Meeting, Person } from "@/types"

/** Theme-aligned accents (work in light + dark). */
const FOLDER_COLORS = [
  "oklch(0.556 0 0)",
  "var(--brand)",
  "oklch(0.62 0.14 155)",
  "oklch(0.72 0.14 80)",
  "oklch(0.6 0.18 25)",
  "oklch(0.58 0.16 305)",
]

/** Count from meeting.folderIds only — never the denormalized folder.meetingIds cache. */
function folderNoteCount(folder: Folder, meetings: Meeting[]): number {
  return meetings.filter((m) => m.folderIds?.includes(folder.id)).length
}

function isObjcGarbageString(value: string): boolean {
  return value.startsWith("[id ") || value.includes("NSTaggedPointer") || value.includes("__NSCF")
}

function cleanEventTitle(title: unknown): string {
  if (typeof title !== "string" || !title.trim() || isObjcGarbageString(title)) return "Untitled"
  return title.trim()
}

function formatEventWhen(startIso: string | undefined): string {
  if (!startIso) return "—"
  const start = new Date(startIso)
  if (Number.isNaN(start.getTime())) return "—"
  return start.toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" })
}

/** True while the event has not finished (end in the future, or start still ahead). */
function isEventStillUpcoming(ev: CalendarEvent, nowMs = Date.now()): boolean {
  const endMs = ev.end ? new Date(ev.end).getTime() : Number.NaN
  if (!Number.isNaN(endMs)) return endMs > nowMs
  const startMs = ev.start ? new Date(ev.start).getTime() : Number.NaN
  if (Number.isNaN(startMs)) return false
  // No end time: drop once the start has passed.
  return startMs > nowMs
}

export type DashboardPane = "notes" | "actions" | "people"

/**
 * Concept filter — Linear / Notion style.
 * Compact “Tags” control in the toolbar (not a top rail of pills).
 * Active filter = dismissible chip. Manage + create live in one menu.
 */
export function FolderChips({
  meetings,
  folderFilter,
  onFilter,
  onFoldersChanged,
  refreshKey = 0,
}: {
  meetings: Meeting[]
  folderFilter: string | null
  onFilter: (folderId: string | null) => void
  onFoldersChanged: () => void
  refreshKey?: number
}) {
  const [folders, setFolders] = useState(() => loadFolders())
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState("")
  const [color, setColor] = useState(FOLDER_COLORS[1])
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [renameId, setRenameId] = useState<string | null>(null)
  const [renameDraft, setRenameDraft] = useState("")

  useEffect(() => {
    setFolders(loadFolders())
  }, [refreshKey, meetings])

  const refresh = useCallback(() => {
    setFolders(loadFolders())
    onFoldersChanged()
  }, [onFoldersChanged])

  const handleCreate = () => {
    const trimmed = name.trim()
    if (!trimmed) return
    createFolder(trimmed, color)
    setName("")
    setCreating(false)
    setColor(FOLDER_COLORS[(folders.length + 1) % FOLDER_COLORS.length])
    setQuery("")
    refresh()
    // Stay on current filter and keep the menu open so you can create more tags.
  }

  const handleRename = () => {
    if (!renameId) return
    const trimmed = renameDraft.trim()
    if (!trimmed) return
    updateFolder(renameId, { name: trimmed })
    setRenameId(null)
    setRenameDraft("")
    refresh()
  }

  const pendingDelete = folders.find((f) => f.id === deleteId)
  const renaming = folders.find((f) => f.id === renameId)
  const activeTag = folderFilter ? folders.find((f) => f.id === folderFilter) : null

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    const list = [...folders].sort((a, b) => a.name.localeCompare(b.name))
    if (!q) return list
    return list.filter((f) => f.name.toLowerCase().includes(q))
  }, [folders, query])

  return (
    <>
      <DropdownMenu
        open={open}
        onOpenChange={(next) => {
          setOpen(next)
          if (!next) {
            setQuery("")
            setCreating(false)
            setName("")
          } else {
            setFolders(loadFolders())
          }
        }}
      >
        <DropdownMenuTrigger asChild>
          <Button
            variant={activeTag ? "secondary" : "ghost"}
            size="sm"
            className={cn(
              "h-9 shrink-0 gap-1.5 rounded-xl px-2.5 text-muted-foreground",
              activeTag && "text-foreground",
            )}
            aria-label="Filter by tag"
            title="Filter by concept tag"
          >
            <HugeiconsIcon icon={TagsIcon} strokeWidth={2} className="size-3.5" />
            <span className="text-xs font-medium">Tags</span>
            {folders.length > 0 && (
              <span className="tabular-nums text-[10px] text-muted-foreground/80">
                {folders.length}
              </span>
            )}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-72 p-0" onCloseAutoFocus={(e) => e.preventDefault()}>
          <div className="border-b border-border/60 p-2">
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Filter tags…"
              className="h-8 border-0 bg-muted/50 text-xs shadow-none focus-visible:ring-0"
              aria-label="Search tags"
              autoFocus
              onKeyDown={(e) => e.stopPropagation()}
            />
          </div>

          <div className="scroll-fade max-h-64 overflow-y-auto py-1">
            <DropdownMenuItem
              onSelect={() => onFilter(null)}
              className="mx-1 gap-2"
            >
              <span className="flex size-2 shrink-0 rounded-full bg-muted-foreground/30" />
              <span className="flex-1">All notes</span>
              <span className="tabular-nums text-[11px] text-muted-foreground">
                {meetings.length}
              </span>
              {!folderFilter && (
                <HugeiconsIcon icon={CheckmarkCircle02Icon} strokeWidth={2} className="size-3.5 text-primary" />
              )}
            </DropdownMenuItem>

            {filtered.length === 0 && !creating && (
              <p className="px-3 py-4 text-center text-xs text-muted-foreground">
                {folders.length === 0
                  ? "No tags yet — create one for a topic"
                  : `No tags match “${query.trim()}”`}
              </p>
            )}

            {filtered.map((f) => {
              const count = folderNoteCount(f, meetings)
              const active = folderFilter === f.id
              return (
                <div
                  key={f.id}
                  className="group/tag flex items-center gap-0.5 px-1"
                >
                  <DropdownMenuItem
                    className="min-w-0 flex-1 gap-2"
                    onSelect={() => onFilter(active ? null : f.id)}
                  >
                    <span
                      className="size-2 shrink-0 rounded-full"
                      style={{ backgroundColor: f.color || FOLDER_COLORS[0] }}
                    />
                    <span className="min-w-0 flex-1 truncate">{f.name}</span>
                    <span className="tabular-nums text-[11px] text-muted-foreground">
                      {count}
                    </span>
                    {active && (
                      <HugeiconsIcon
                        icon={CheckmarkCircle02Icon}
                        strokeWidth={2}
                        className="size-3.5 shrink-0 text-primary"
                      />
                    )}
                  </DropdownMenuItem>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button
                        type="button"
                        className="inline-flex size-7 shrink-0 items-center justify-center rounded-lg text-muted-foreground opacity-0 transition-opacity hover:bg-muted hover:text-foreground group-hover/tag:opacity-100 focus-visible:opacity-100"
                        aria-label={`Manage ${f.name}`}
                        onClick={(e) => e.stopPropagation()}
                      >
                        <HugeiconsIcon icon={MoreHorizontalIcon} strokeWidth={2} className="size-3.5" />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="min-w-40" sideOffset={4}>
                      <DropdownMenuItem
                        onSelect={() => {
                          setRenameId(f.id)
                          setRenameDraft(f.name)
                        }}
                      >
                        <HugeiconsIcon icon={PencilEdit01Icon} strokeWidth={2} />
                        Rename
                      </DropdownMenuItem>
                      <DropdownMenuLabel className="text-[11px] font-normal text-muted-foreground">
                        Color
                      </DropdownMenuLabel>
                      <div className="flex flex-wrap gap-1.5 px-2 pb-1.5">
                        {FOLDER_COLORS.map((c) => (
                          <button
                            key={c}
                            type="button"
                            className={cn(
                              "size-5 rounded-full ring-offset-1 ring-offset-popover transition-shadow",
                              (f.color || FOLDER_COLORS[0]) === c
                                ? "ring-2 ring-foreground/40"
                                : "hover:ring-2 hover:ring-border",
                            )}
                            style={{ backgroundColor: c }}
                            aria-label="Set color"
                            onClick={() => {
                              updateFolder(f.id, { color: c })
                              refresh()
                            }}
                          />
                        ))}
                      </div>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        variant="destructive"
                        onSelect={() => setDeleteId(f.id)}
                      >
                        <HugeiconsIcon icon={DeleteIcon} strokeWidth={2} />
                        Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              )
            })}
          </div>

          <div className="border-t border-border/60 p-1.5">
            {creating ? (
              <div className="flex flex-col gap-2 p-1.5">
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="New tag name"
                  className="h-8 text-xs"
                  autoFocus
                  aria-label="New tag name"
                  onKeyDown={(e) => {
                    e.stopPropagation()
                    if (e.key === "Enter") handleCreate()
                    if (e.key === "Escape") {
                      setCreating(false)
                      setName("")
                    }
                  }}
                />
                <div className="flex flex-wrap gap-1.5" role="listbox" aria-label="Tag color">
                  {FOLDER_COLORS.map((c) => (
                    <button
                      key={c}
                      type="button"
                      role="option"
                      aria-selected={color === c}
                      className={cn(
                        "size-4 rounded-full transition-shadow",
                        color === c
                          ? "ring-2 ring-foreground/40 ring-offset-1 ring-offset-popover"
                          : "hover:ring-2 hover:ring-border",
                      )}
                      style={{ backgroundColor: c }}
                      aria-label="Tag color"
                      onClick={() => setColor(c)}
                    />
                  ))}
                </div>
                <div className="flex justify-end gap-1">
                  <Button
                    size="xs"
                    variant="ghost"
                    onClick={() => {
                      setCreating(false)
                      setName("")
                    }}
                  >
                    Cancel
                  </Button>
                  <Button size="xs" disabled={!name.trim()} onClick={handleCreate}>
                    Create
                  </Button>
                </div>
              </div>
            ) : (
              <DropdownMenuItem
                className="gap-2 text-muted-foreground"
                onSelect={(e) => {
                  e.preventDefault()
                  setCreating(true)
                }}
              >
                <HugeiconsIcon icon={Add01Icon} strokeWidth={2} className="size-3.5" />
                Create tag…
              </DropdownMenuItem>
            )}
          </div>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Active filter chip — Gmail / Linear style */}
      {activeTag && (
        <button
          type="button"
          className="inline-flex h-9 max-w-[12rem] shrink-0 items-center gap-1.5 rounded-xl bg-muted/70 px-2.5 text-xs font-medium text-foreground ring-1 ring-border/50 transition-colors hover:bg-muted"
          onClick={() => onFilter(null)}
          title="Clear tag filter"
          aria-label={`Clear filter ${activeTag.name}`}
        >
          <span
            className="size-1.5 shrink-0 rounded-full"
            style={{ backgroundColor: activeTag.color || FOLDER_COLORS[0] }}
          />
          <span className="truncate">{activeTag.name}</span>
          <HugeiconsIcon icon={Cancel01Icon} strokeWidth={2} className="size-3 shrink-0 text-muted-foreground" />
        </button>
      )}

      <AlertDialog open={Boolean(renameId)} onOpenChange={(open) => !open && setRenameId(null)}>
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogTitle>Rename tag</AlertDialogTitle>
            <AlertDialogDescription>
              {renaming ? `Update the name for “${renaming.name}”.` : "Update the tag name."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Input
            value={renameDraft}
            onChange={(e) => setRenameDraft(e.target.value)}
            autoFocus
            aria-label="Tag name"
            onKeyDown={(e) => {
              if (e.key === "Enter") handleRename()
            }}
          />
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleRename} disabled={!renameDraft.trim()}>
              Save
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={Boolean(deleteId)} onOpenChange={(open) => !open && setDeleteId(null)}>
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete tag?</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingDelete
                ? `“${pendingDelete.name}” will be removed. Notes stay in your library — only this concept tag is deleted.`
                : "This tag will be removed."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                if (!deleteId) return
                deleteFolder(deleteId)
                if (folderFilter === deleteId) onFilter(null)
                setDeleteId(null)
                refresh()
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

export function UpcomingEvents({
  onStartFromEvent,
}: {
  onStartFromEvent: (meeting: Meeting) => void
}) {
  const [events, setEvents] = useState<CalendarEvent[]>([])
  const [loading, setLoading] = useState(false)
  const [startingId, setStartingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const enabled = loadSettings().calendarEnabled

  const refresh = useCallback(async () => {
    if (!enabled) return
    setLoading(true)
    setError(null)
    try {
      const list = await invoke<CalendarEvent[]>("list_upcoming_events", { hoursAhead: 12 })
      const now = Date.now()
      // Drop meetings whose end (or start, if no end) is already past.
      setEvents(Array.isArray(list) ? list.filter((ev) => isEventStillUpcoming(ev, now)) : [])
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setEvents([])
    } finally {
      setLoading(false)
    }
  }, [enabled])

  useEffect(() => {
    // Calendar is an external system; load once when the setting is on.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh()
  }, [refresh])

  // Re-filter on an interval so an event disappears once it ends without a manual refresh.
  useEffect(() => {
    if (!enabled) return
    const id = window.setInterval(() => {
      setEvents((prev) => {
        const now = Date.now()
        const next = prev.filter((ev) => isEventStillUpcoming(ev, now))
        return next.length === prev.length ? prev : next
      })
    }, 60_000)
    return () => window.clearInterval(id)
  }, [enabled])

  if (!enabled) return null

  const handleStart = async (ev: CalendarEvent) => {
    setStartingId(ev.id)
    try {
      // Brief is opt-in from the editor/info panel — never auto-attached on start.
      const title = cleanEventTitle(ev.title)
      const meeting: Meeting = {
        id: crypto.randomUUID(),
        title,
        date: ev.start && !Number.isNaN(new Date(ev.start).getTime()) ? ev.start : new Date().toISOString(),
        duration: 0,
        transcript: "",
        notes: "",
        manualNotes: "",
        calendarEventId: ev.id,
        attendees: ev.attendees,
      }
      for (const a of ev.attendees ?? []) {
        if (a.name && !isObjcGarbageString(a.name)) {
          ensurePerson({ name: a.name, email: a.email, meetingId: meeting.id })
        }
      }
      onStartFromEvent(meeting)
    } finally {
      setStartingId(null)
    }
  }

  // Quiet strip — hide when empty and idle (Granola-like: surface only when useful).
  if (!error && !loading && events.length === 0) return null

  return (
    <section className="flex flex-col gap-2" aria-label="Upcoming calendar events">
      <div className="flex items-center justify-between gap-2 px-1">
        <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground/75">
          Up next
        </p>
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={() => void refresh()}
          disabled={loading}
          aria-label={loading ? "Refreshing events" : "Refresh events"}
          className="text-muted-foreground"
        >
          <HugeiconsIcon
            icon={RefreshIcon}
            strokeWidth={2}
            className={cn("size-3.5", loading && "animate-spin")}
          />
        </Button>
      </div>

      {error && (
        <div className="flex flex-col gap-2 rounded-2xl bg-muted/40 px-3 py-2.5">
          <p className="text-xs text-pretty text-muted-foreground">{error}</p>
          <Button
            size="sm"
            variant="outline"
            className="self-start"
            onClick={async () => {
              try {
                await invoke("request_calendar_access")
                await refresh()
              } catch (e) {
                toast.error(e instanceof Error ? e.message : "Calendar permission failed")
              }
            }}
          >
            Allow calendar access
          </Button>
        </div>
      )}

      {loading && events.length === 0 && !error && (
        <div className="flex gap-2" aria-busy="true" aria-label="Loading events">
          <div className="h-14 flex-1 animate-pulse rounded-2xl bg-muted/50" />
          <div className="h-14 flex-1 animate-pulse rounded-2xl bg-muted/50" />
        </div>
      )}

      {events.length > 0 && (
        <ul className="scroll-fade-x flex gap-2 overflow-x-auto pb-0.5">
          {events.slice(0, 6).map((ev) => {
            const title = cleanEventTitle(ev.title)
            const when = formatEventWhen(ev.start)
            return (
              <li key={ev.id} className="min-w-[11.5rem] max-w-[14rem] shrink-0">
                <button
                  type="button"
                  disabled={startingId === ev.id}
                  onClick={() => void handleStart(ev)}
                  className="flex h-full w-full flex-col items-start gap-1 rounded-2xl bg-muted/40 px-3 py-2.5 text-left transition-colors hover:bg-muted/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
                >
                  <span className="line-clamp-2 text-sm font-medium leading-snug">
                    {title}
                  </span>
                  <span className="text-[11px] tabular-nums text-muted-foreground">
                    {when}
                    {startingId === ev.id ? " · Starting…" : ""}
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

/** Assign / reassign an action item to a person (or clear). */
function ActionAssigneePicker({
  item,
  people,
  onChanged,
  compact,
}: {
  item: KnowledgeItem
  people: Person[]
  onChanged: () => void
  compact?: boolean
}) {
  const [customOpen, setCustomOpen] = useState(false)
  const [customName, setCustomName] = useState("")

  const sortedPeople = useMemo(
    () => [...people].sort((a, b) => a.name.localeCompare(b.name)),
    [people],
  )

  const apply = (name: string | undefined) => {
    const trimmed = name?.trim()
    updateKnowledgeItem(item.id, { assignee: trimmed || undefined })
    if (trimmed) {
      ensurePerson({ name: trimmed, meetingId: item.meetingId })
    }
    onChanged()
  }

  const applyCustom = () => {
    const t = customName.trim()
    if (!t) return
    apply(t)
    setCustomName("")
    setCustomOpen(false)
  }

  return (
    <DropdownMenu
      onOpenChange={(open) => {
        if (!open) {
          setCustomOpen(false)
          setCustomName("")
        }
      }}
    >
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={cn(
            "inline-flex max-w-[9rem] items-center gap-1 rounded-md px-1 py-0.5 text-[11px] transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30",
            item.assignee ? "text-muted-foreground" : "text-muted-foreground/70",
          )}
          aria-label={item.assignee ? `Assigned to ${item.assignee}` : "Assign person"}
          onClick={(e) => e.stopPropagation()}
        >
          {item.assignee ? (
            <>
              <span className="actions-avatar actions-avatar-sm" aria-hidden>
                {item.assignee.slice(0, 1).toUpperCase()}
              </span>
              <span className="truncate">{item.assignee}</span>
            </>
          ) : (
            <>
              <HugeiconsIcon icon={UserIcon} strokeWidth={2} className="size-3 shrink-0 opacity-70" />
              <span>{compact ? "Assign" : "Assign…"}</span>
            </>
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className="min-w-48"
        onClick={(e) => e.stopPropagation()}
      >
        <DropdownMenuLabel>Assign to</DropdownMenuLabel>
        {item.assignee && (
          <>
            <DropdownMenuItem onSelect={() => apply(undefined)}>
              <HugeiconsIcon icon={Cancel01Icon} strokeWidth={2} />
              Unassigned
            </DropdownMenuItem>
            <DropdownMenuSeparator />
          </>
        )}
        {sortedPeople.length === 0 && !customOpen && (
          <p className="px-2 py-1.5 text-xs text-muted-foreground">
            No people yet — type a name below
          </p>
        )}
        {sortedPeople.map((p) => {
          const active =
            item.assignee?.toLowerCase() === p.name.toLowerCase() ||
            p.aliases.some((a) => a.toLowerCase() === item.assignee?.toLowerCase())
          return (
            <DropdownMenuItem key={p.id} onSelect={() => apply(p.name)}>
              <span className="actions-avatar actions-avatar-sm" aria-hidden>
                {p.name.slice(0, 1).toUpperCase()}
              </span>
              <span className="min-w-0 flex-1 truncate">{p.name}</span>
              {active && (
                <HugeiconsIcon
                  icon={CheckmarkCircle02Icon}
                  strokeWidth={2}
                  className="size-3.5 shrink-0 text-primary"
                />
              )}
            </DropdownMenuItem>
          )
        })}
        <DropdownMenuSeparator />
        {customOpen ? (
          <div className="flex flex-col gap-1.5 p-2">
            <Input
              value={customName}
              onChange={(e) => setCustomName(e.target.value)}
              placeholder="Person name"
              className="h-8 text-xs"
              autoFocus
              onKeyDown={(e) => {
                e.stopPropagation()
                if (e.key === "Enter") applyCustom()
                if (e.key === "Escape") {
                  setCustomOpen(false)
                  setCustomName("")
                }
              }}
              onClick={(e) => e.stopPropagation()}
            />
            <Button size="xs" disabled={!customName.trim()} onClick={applyCustom}>
              Assign
            </Button>
          </div>
        ) : (
          <DropdownMenuItem
            onSelect={(e) => {
              e.preventDefault()
              setCustomOpen(true)
            }}
          >
            <HugeiconsIcon icon={Add01Icon} strokeWidth={2} />
            Someone else…
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/**
 * Production actions inbox — Linear / Todoist style.
 * Grouped by meeting, clear Open/Done tabs, search, checkbox rows.
 */
export function ActionsInbox({
  meetings,
  onOpenMeeting,
}: {
  meetings: Meeting[]
  onOpenMeeting: (m: Meeting) => void
}) {
  const [tick, setTick] = useState(0)
  const [query, setQuery] = useState("")
  const [showDone, setShowDone] = useState(false)
  const [assigneeFocus, setAssigneeFocus] = useState<string | null>(null)
  const [people, setPeople] = useState<Person[]>(() => loadPeople())

  useEffect(() => {
    setPeople(loadPeople())
  }, [meetings, tick])

  const allActions = useMemo(() => {
    const graph = loadKnowledgeGraph()
    return graph.items.filter((i) => i.kind === "action_item")
    // eslint-disable-next-line react-hooks/exhaustive-deps -- meetings/tick revalidate external graph
  }, [meetings, tick])

  const openCount = useMemo(
    () => allActions.filter((i) => i.status === "open" || i.status === "unknown").length,
    [allActions],
  )
  const doneCount = useMemo(
    () => allActions.filter((i) => i.status === "resolved").length,
    [allActions],
  )

  const assignees = useMemo(() => {
    const set = new Set<string>()
    for (const i of allActions) {
      if (i.assignee?.trim()) set.add(i.assignee.trim())
    }
    return [...set].sort((a, b) => a.localeCompare(b))
  }, [allActions])

  const items = useMemo(() => {
    const q = query.trim().toLowerCase()
    return allActions
      .filter((i) => (showDone ? i.status === "resolved" : i.status === "open" || i.status === "unknown"))
      .filter((i) => {
        if (assigneeFocus) {
          return (i.assignee || "").toLowerCase() === assigneeFocus.toLowerCase()
        }
        return true
      })
      .filter((i) => {
        if (!q) return true
        const hay = `${i.text} ${i.assignee ?? ""}`.toLowerCase()
        const meeting = meetings.find((m) => m.id === i.meetingId)
        return hay.includes(q) || (meeting?.title.toLowerCase().includes(q) ?? false)
      })
      .sort((a, b) => (b.extractedAt || "").localeCompare(a.extractedAt || ""))
  }, [allActions, showDone, assigneeFocus, query, meetings])

  const meetingMap = useMemo(() => new Map(meetings.map((m) => [m.id, m])), [meetings])

  /** Group by meeting, preserve recency of newest item in each group. */
  const groups = useMemo(() => {
    const order: string[] = []
    const map = new Map<string, KnowledgeItem[]>()
    for (const item of items) {
      const key = item.meetingId || "__unknown__"
      if (!map.has(key)) {
        map.set(key, [])
        order.push(key)
      }
      map.get(key)!.push(item)
    }
    return order.map((meetingId) => ({
      meetingId,
      meeting: meetingMap.get(meetingId),
      items: map.get(meetingId)!,
    }))
  }, [items, meetingMap])

  const toggle = (item: KnowledgeItem) => {
    const next = item.status === "resolved" ? "open" : "resolved"
    updateKnowledgeItem(item.id, { status: next })
    setTick((t) => t + 1)
  }

  return (
    <div className="actions-inbox flex flex-col gap-4">
      {/* Header — count + status (Linear/Things) */}
      <header className="flex flex-wrap items-end justify-between gap-3 px-0.5">
        <div className="min-w-0">
          <h2 className="text-base font-semibold tracking-tight text-foreground">Actions</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {showDone
              ? `${doneCount} completed`
              : openCount === 0
                ? "Nothing open"
                : `${openCount} open across your notes`}
          </p>
        </div>
        <div className="app-control-strip shrink-0" role="tablist" aria-label="Action status">
          <button
            type="button"
            role="tab"
            className="app-control-item gap-1.5"
            data-active={!showDone}
            aria-selected={!showDone}
            onClick={() => setShowDone(false)}
          >
            Open
            <span className="tabular-nums text-[10px] opacity-70">{openCount}</span>
          </button>
          <button
            type="button"
            role="tab"
            className="app-control-item gap-1.5"
            data-active={showDone}
            aria-selected={showDone}
            onClick={() => setShowDone(true)}
          >
            Done
            <span className="tabular-nums text-[10px] opacity-70">{doneCount}</span>
          </button>
        </div>
      </header>

      {/* Toolbar — search + assignee chips */}
      <div className="flex flex-col gap-2">
        <InputGroup className="h-9 border-0 bg-muted/40 shadow-none ring-1 ring-border/50">
          <InputGroupInput
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search actions, people, notes…"
            aria-label="Search actions"
            className="text-sm"
          />
          {query ? (
            <InputGroupButton
              size="icon-sm"
              onClick={() => setQuery("")}
              aria-label="Clear search"
            >
              <HugeiconsIcon icon={Cancel01Icon} strokeWidth={2} />
            </InputGroupButton>
          ) : (
            <InputGroupButton size="icon-sm" tabIndex={-1} className="pointer-events-none" aria-hidden>
              <HugeiconsIcon icon={Search01Icon} strokeWidth={2} />
            </InputGroupButton>
          )}
        </InputGroup>

        {assignees.length > 0 && (
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter by assignee">
            <button
              type="button"
              className={cn(
                "actions-chip",
                !assigneeFocus && "actions-chip-active",
              )}
              onClick={() => setAssigneeFocus(null)}
            >
              Anyone
            </button>
            {assignees.map((name) => (
              <button
                key={name}
                type="button"
                className={cn(
                  "actions-chip",
                  assigneeFocus === name && "actions-chip-active",
                )}
                onClick={() => setAssigneeFocus(assigneeFocus === name ? null : name)}
              >
                <span className="actions-avatar" aria-hidden>
                  {name.slice(0, 1).toUpperCase()}
                </span>
                <span className="max-w-[6.5rem] truncate">{name}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* List */}
      {items.length === 0 ? (
        <div className="app-empty rounded-2xl border border-dashed border-border/70 bg-card/30 py-14">
          <span className="inline-flex size-11 items-center justify-center rounded-2xl bg-muted">
            <HugeiconsIcon icon={CheckListIcon} strokeWidth={1.75} className="size-5 text-muted-foreground" />
          </span>
          <div>
            <p className="text-sm font-medium">
              {query || assigneeFocus
                ? "No matching actions"
                : showDone
                  ? "No completed actions"
                  : "Inbox zero"}
            </p>
            <p className="mt-1 max-w-sm text-xs text-pretty text-muted-foreground">
              {query || assigneeFocus
                ? "Try another search or clear the assignee filter."
                : showDone
                  ? "Completed items land here when you check them off."
                  : "Enhance a note to pull out action items. They group by meeting so you can clear them in context."}
            </p>
          </div>
          {(query || assigneeFocus) && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setQuery("")
                setAssigneeFocus(null)
              }}
            >
              Clear filters
            </Button>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-5">
          {groups.map((group) => {
            const title = group.meeting?.title?.trim() || "Unknown note"
            const when = group.meeting?.date ? relativeDate(group.meeting.date) : null
            return (
              <section key={group.meetingId} className="flex flex-col gap-1.5">
                <div className="flex items-center gap-2 px-1">
                  {group.meeting ? (
                    <button
                      type="button"
                      className="min-w-0 truncate text-left text-[11px] font-medium uppercase tracking-[0.06em] text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
                      onClick={() => onOpenMeeting(group.meeting!)}
                    >
                      {title}
                    </button>
                  ) : (
                    <span className="text-[11px] font-medium uppercase tracking-[0.06em] text-muted-foreground">
                      {title}
                    </span>
                  )}
                  <span className="h-px min-w-3 flex-1 bg-border/50" aria-hidden />
                  <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground/70">
                    {group.items.length}
                    {when ? ` · ${when}` : ""}
                  </span>
                </div>

                <ul className="actions-list overflow-hidden rounded-2xl bg-card shadow-sm ring-1 ring-foreground/5 dark:ring-foreground/10">
                  {group.items.map((item, idx) => {
                    const done = item.status === "resolved"
                    return (
                      <li
                        key={item.id}
                        className={cn(
                          "actions-row group/row flex items-start gap-2.5 px-3 py-2.5 transition-colors hover:bg-muted/40",
                          idx > 0 && "border-t border-border/40",
                        )}
                      >
                        <button
                          type="button"
                          className={cn(
                            "mt-0.5 inline-flex size-7 shrink-0 items-center justify-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30 active:scale-[0.96]",
                            done
                              ? "text-primary hover:bg-primary/10"
                              : "text-muted-foreground ring-1 ring-border/80 hover:bg-muted hover:text-foreground hover:ring-border",
                          )}
                          onClick={() => toggle(item)}
                          aria-label={done ? "Mark as open" : "Mark as done"}
                          aria-pressed={done}
                        >
                          <HugeiconsIcon
                            icon={done ? CheckmarkCircle02Icon : CheckListIcon}
                            strokeWidth={2}
                            className="size-4"
                          />
                        </button>

                        <div className="min-w-0 flex-1">
                          <p
                            className={cn(
                              "text-[13.5px] leading-snug text-pretty text-foreground",
                              done && "text-muted-foreground line-through decoration-muted-foreground/50",
                            )}
                          >
                            {item.text}
                          </p>
                          <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
                            <ActionAssigneePicker
                              item={item}
                              people={people}
                              onChanged={() => {
                                setPeople(loadPeople())
                                setTick((t) => t + 1)
                              }}
                            />
                            {item.extractedAt && (
                              <span className="tabular-nums opacity-80">
                                {relativeDate(item.extractedAt)}
                              </span>
                            )}
                            {group.meeting && (
                              <button
                                type="button"
                                className="truncate rounded-md text-muted-foreground/90 underline-offset-2 transition-colors hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
                                onClick={() => onOpenMeeting(group.meeting!)}
                              >
                                Open note
                              </button>
                            )}
                          </div>
                        </div>
                      </li>
                    )
                  })}
                </ul>
              </section>
            )
          })}
        </div>
      )}
    </div>
  )
}

/**
 * People memory — CRM-lite for meetings (Linear / Notion person view).
 * Searchable list + detail: notes, open actions, related meetings.
 */
export function PeopleMemory({
  meetings,
  onOpenMeeting,
}: {
  meetings: Meeting[]
  onOpenMeeting: (m: Meeting) => void
}) {
  const [people, setPeople] = useState<Person[]>(() => {
    for (const m of meetings) linkPeopleFromMeeting(m)
    return loadPeople()
  })
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [notesDraft, setNotesDraft] = useState("")
  const [query, setQuery] = useState("")
  const [actionTick, setActionTick] = useState(0)
  const meetingsKey = meetings.map((m) => m.id).join("|")

  useEffect(() => {
    for (const m of meetings) linkPeopleFromMeeting(m)
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPeople(loadPeople())
  }, [meetings, meetingsKey])

  const sortedPeople = useMemo(
    () => [...people].sort((a, b) => a.name.localeCompare(b.name)),
    [people],
  )

  const filteredPeople = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return sortedPeople
    return sortedPeople.filter((p) => {
      const hay = `${p.name} ${p.email ?? ""} ${p.aliases.join(" ")} ${p.notes ?? ""}`.toLowerCase()
      return hay.includes(q)
    })
  }, [sortedPeople, query])

  // Keep selection valid; auto-select first when none / filtered out.
  useEffect(() => {
    if (filteredPeople.length === 0) {
      if (selectedId) setSelectedId(null)
      return
    }
    if (!selectedId || !filteredPeople.some((p) => p.id === selectedId)) {
      const first = filteredPeople[0]
      setSelectedId(first.id)
      setNotesDraft(first.notes ?? "")
    }
  }, [filteredPeople, selectedId])

  const selected = people.find((p) => p.id === selectedId) ?? null

  const selectPerson = (id: string) => {
    setSelectedId(id)
    const person = people.find((p) => p.id === id)
    setNotesDraft(person?.notes ?? "")
  }

  const personOpenActions = useCallback((person: Person) => {
    const names = [person.name, ...person.aliases].map((n) => n.toLowerCase()).filter(Boolean)
    return loadKnowledgeGraph().items.filter((i) => {
      if (i.kind !== "action_item") return false
      if (i.status !== "open" && i.status !== "unknown") return false
      const a = (i.assignee || "").toLowerCase()
      if (!a) return false
      return names.some((n) => a === n || a.includes(n) || n.includes(a))
    })
  }, [])

  const openActions = useMemo(() => {
    if (!selected) return []
    void actionTick
    return personOpenActions(selected)
  }, [selected, actionTick, personOpenActions])

  const openActionCountByPerson = useMemo(() => {
    void actionTick
    const map = new Map<string, number>()
    for (const p of people) {
      map.set(p.id, personOpenActions(p).length)
    }
    return map
  }, [people, actionTick, personOpenActions])

  const relatedMeetings = useMemo(() => {
    if (!selected) return []
    return selected.meetingIds
      .map((id) => meetings.find((m) => m.id === id))
      .filter((m): m is Meeting => Boolean(m))
      .sort((a, b) => (b.date || "").localeCompare(a.date || ""))
  }, [selected, meetings])

  const toggleAction = (item: KnowledgeItem) => {
    const next = item.status === "resolved" ? "open" : "resolved"
    updateKnowledgeItem(item.id, { status: next })
    setActionTick((t) => t + 1)
  }

  if (people.length === 0) {
    return (
      <div className="people-memory flex flex-col gap-4">
        <header className="px-0.5">
          <h2 className="text-base font-semibold tracking-tight">People</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">Memory from meetings and assignees</p>
        </header>
        <div className="app-empty rounded-2xl border border-dashed border-border/70 bg-card/30 py-14">
          <span className="inline-flex size-11 items-center justify-center rounded-2xl bg-muted">
            <HugeiconsIcon icon={UserGroupIcon} strokeWidth={1.75} className="size-5 text-muted-foreground" />
          </span>
          <div>
            <p className="text-sm font-medium">No people yet</p>
            <p className="mt-1 max-w-sm text-xs text-pretty text-muted-foreground">
              People appear from calendar invitees, speakers, and action assignees after you enhance notes
              or start a meeting from the calendar.
            </p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="people-memory flex flex-col gap-4">
      <header className="flex flex-wrap items-end justify-between gap-3 px-0.5">
        <div className="min-w-0">
          <h2 className="text-base font-semibold tracking-tight">People</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {people.length} contact{people.length === 1 ? "" : "s"}
            {filteredPeople.length !== people.length ? ` · ${filteredPeople.length} shown` : ""}
          </p>
        </div>
      </header>

      <InputGroup className="h-9 border-0 bg-muted/40 shadow-none ring-1 ring-border/50">
        <InputGroupInput
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search people…"
          aria-label="Search people"
          className="text-sm"
        />
        {query ? (
          <InputGroupButton size="icon-sm" onClick={() => setQuery("")} aria-label="Clear search">
            <HugeiconsIcon icon={Cancel01Icon} strokeWidth={2} />
          </InputGroupButton>
        ) : (
          <InputGroupButton size="icon-sm" tabIndex={-1} className="pointer-events-none" aria-hidden>
            <HugeiconsIcon icon={Search01Icon} strokeWidth={2} />
          </InputGroupButton>
        )}
      </InputGroup>

      {filteredPeople.length === 0 ? (
        <div className="app-empty rounded-2xl border border-dashed border-border/70 bg-card/30 py-12">
          <p className="text-sm font-medium">No matching people</p>
          <p className="mt-1 text-xs text-muted-foreground">Try another name or email.</p>
          <Button variant="outline" size="sm" onClick={() => setQuery("")}>
            Clear search
          </Button>
        </div>
      ) : (
        <div className="grid min-h-[22rem] gap-3 md:grid-cols-[minmax(0,14rem)_1fr]">
          {/* Directory */}
          <div
            className="flex max-h-[min(32rem,65vh)] flex-col overflow-hidden rounded-2xl bg-card shadow-sm ring-1 ring-foreground/5 dark:ring-foreground/10"
            role="listbox"
            aria-label="People"
          >
            <div className="scroll-fade flex-1 overflow-y-auto p-1.5">
              {filteredPeople.map((p) => {
                const active = selectedId === p.id
                const openN = openActionCountByPerson.get(p.id) ?? 0
                const meetingN = p.meetingIds.filter((id) => meetings.some((m) => m.id === id)).length
                return (
                  <button
                    key={p.id}
                    type="button"
                    role="option"
                    aria-selected={active}
                    onClick={() => selectPerson(p.id)}
                    className={cn(
                      "flex w-full items-center gap-2.5 rounded-xl px-2 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30",
                      active ? "bg-muted text-foreground" : "hover:bg-muted/50",
                    )}
                  >
                    <span className="actions-avatar shrink-0" aria-hidden>
                      {p.name.slice(0, 1).toUpperCase()}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-medium leading-tight">
                        {p.name}
                      </span>
                      <span className="mt-0.5 block truncate text-[11px] tabular-nums text-muted-foreground">
                        {meetingN} note{meetingN === 1 ? "" : "s"}
                        {openN > 0 ? ` · ${openN} open` : ""}
                      </span>
                    </span>
                  </button>
                )
              })}
            </div>
          </div>

          {/* Detail */}
          {selected ? (
            <div className="scroll-fade flex min-h-0 flex-col gap-5 overflow-y-auto rounded-2xl bg-card p-4 shadow-sm ring-1 ring-foreground/5 dark:ring-foreground/10 sm:p-5">
              <div className="flex items-start gap-3">
                <span
                  className="inline-flex size-11 shrink-0 items-center justify-center rounded-2xl bg-foreground/8 text-base font-semibold text-foreground"
                  aria-hidden
                >
                  {selected.name.slice(0, 1).toUpperCase()}
                </span>
                <div className="min-w-0 flex-1">
                  <h3 className="font-heading text-lg font-semibold tracking-tight text-balance">
                    {selected.name}
                  </h3>
                  {selected.email ? (
                    <p className="mt-0.5 truncate text-xs text-muted-foreground">{selected.email}</p>
                  ) : (
                    <p className="mt-0.5 text-xs text-muted-foreground/70">No email on file</p>
                  )}
                  {selected.aliases.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {selected.aliases.map((a) => (
                        <span
                          key={a}
                          className="rounded-full bg-muted/80 px-2 py-0.5 text-[10px] font-medium text-muted-foreground"
                        >
                          {a}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              <div className="flex flex-col gap-1.5">
                <label htmlFor="person-notes" className="text-[11px] font-medium uppercase tracking-[0.06em] text-muted-foreground">
                  Memory
                </label>
                <Textarea
                  id="person-notes"
                  className="min-h-24 resize-none border-0 bg-muted/35 text-sm shadow-none ring-1 ring-border/50 focus-visible:ring-ring/40"
                  value={notesDraft}
                  onChange={(e) => setNotesDraft(e.target.value)}
                  onBlur={() => {
                    if (!selected) return
                    updatePerson(selected.id, { notes: notesDraft })
                    setPeople(loadPeople())
                  }}
                  placeholder="Freeform notes — role, preferences, follow-ups…"
                />
              </div>

              <div>
                <div className="mb-2 flex items-center justify-between gap-2">
                  <p className="text-[11px] font-medium uppercase tracking-[0.06em] text-muted-foreground">
                    Open actions
                  </p>
                  {openActions.length > 0 && (
                    <span className="tabular-nums text-[11px] text-muted-foreground">
                      {openActions.length}
                    </span>
                  )}
                </div>
                {openActions.length === 0 ? (
                  <p className="rounded-xl bg-muted/30 px-3 py-2.5 text-xs text-muted-foreground">
                    No open actions assigned to {selected.name.split(" ")[0]}
                  </p>
                ) : (
                  <ul className="actions-list overflow-hidden rounded-xl ring-1 ring-border/50">
                    {openActions.map((a, idx) => {
                      const m = meetings.find((x) => x.id === a.meetingId)
                      return (
                        <li
                          key={a.id}
                          className={cn(
                            "flex items-start gap-2.5 px-3 py-2.5",
                            idx > 0 && "border-t border-border/40",
                          )}
                        >
                          <button
                            type="button"
                            className="mt-0.5 inline-flex size-7 shrink-0 items-center justify-center rounded-full text-muted-foreground ring-1 ring-border/80 transition-colors hover:bg-muted hover:text-foreground active:scale-[0.96]"
                            onClick={() => toggleAction(a)}
                            aria-label="Mark as done"
                          >
                            <HugeiconsIcon icon={CheckListIcon} strokeWidth={2} className="size-4" />
                          </button>
                          <div className="min-w-0 flex-1">
                            <p className="text-[13px] leading-snug text-pretty">{a.text}</p>
                            <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
                              <ActionAssigneePicker
                                item={a}
                                people={people}
                                compact
                                onChanged={() => {
                                  setPeople(loadPeople())
                                  setActionTick((t) => t + 1)
                                }}
                              />
                              {m && (
                                <button
                                  type="button"
                                  className="underline-offset-2 hover:text-foreground hover:underline"
                                  onClick={() => onOpenMeeting(m)}
                                >
                                  {m.title}
                                </button>
                              )}
                            </div>
                          </div>
                        </li>
                      )
                    })}
                  </ul>
                )}
              </div>

              <div>
                <div className="mb-2 flex items-center justify-between gap-2">
                  <p className="text-[11px] font-medium uppercase tracking-[0.06em] text-muted-foreground">
                    Meetings
                  </p>
                  <span className="tabular-nums text-[11px] text-muted-foreground">
                    {relatedMeetings.length}
                  </span>
                </div>
                {relatedMeetings.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No linked notes yet</p>
                ) : (
                  <ul className="flex flex-col overflow-hidden rounded-xl ring-1 ring-border/50">
                    {relatedMeetings.map((m, idx) => (
                      <li key={m.id} className={cn(idx > 0 && "border-t border-border/40")}>
                        <button
                          type="button"
                          className="flex w-full items-center gap-2 px-3 py-2.5 text-left transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
                          onClick={() => onOpenMeeting(m)}
                        >
                          <span className="min-w-0 flex-1 truncate text-[13px] font-medium">
                            {m.title || "Untitled"}
                          </span>
                          <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
                            {relativeDate(m.date)}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          ) : (
            <div className="app-empty rounded-2xl border border-dashed border-border/70 py-12">
              <p className="text-sm text-muted-foreground">Select a person</p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/**
 * Multi-concept tags on a note — checkbox list + quick create.
 * A note can have many tags (e.g. Hiring + Product + Weekly).
 */
export function MeetingFolderMenu({
  meeting,
  onChanged,
  onTagClick,
}: {
  meeting: Meeting
  /** Called after membership changes; receives the meeting's latest folderIds. */
  onChanged: (folderIds: string[]) => void
  /** Click a tag chip to filter the home list by that concept. */
  onTagClick?: (tagId: string) => void
}) {
  const [folders, setFolders] = useState(() => loadFolders())
  const [open, setOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState("")
  // Optimistic membership so chips update before parent re-renders.
  const [localIds, setLocalIds] = useState<string[]>(() => meeting.folderIds ?? [])

  useEffect(() => {
    setLocalIds(meeting.folderIds ?? [])
  }, [meeting.id, meeting.folderIds])

  const assigned = useMemo(() => {
    const ids = new Set(localIds)
    return folders.filter((f) => ids.has(f.id))
  }, [folders, localIds])

  const toggle = (folderId: string, next: boolean) => {
    if (next) assignMeetingToFolder(meeting.id, folderId)
    else removeMeetingFromFolder(meeting.id, folderId)
    const nextIds = next
      ? [...new Set([...localIds, folderId])]
      : localIds.filter((id) => id !== folderId)
    setLocalIds(nextIds)
    setFolders(loadFolders())
    onChanged(nextIds)
  }

  const handleCreate = () => {
    const trimmed = name.trim()
    if (!trimmed) return
    const folder = createFolder(
      trimmed,
      FOLDER_COLORS[folders.length % FOLDER_COLORS.length],
    )
    assignMeetingToFolder(meeting.id, folder.id)
    const nextIds = [...new Set([...localIds, folder.id])]
    setLocalIds(nextIds)
    setName("")
    setCreating(false)
    setFolders(loadFolders())
    onChanged(nextIds)
  }

  return (
    <div onClick={(e) => e.stopPropagation()} className="flex flex-wrap items-center gap-1.5">
      {assigned.map((f) => (
        <button
          key={f.id}
          type="button"
          className="inline-flex max-w-[8rem] items-center gap-1 truncate rounded-full bg-muted/70 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
          title={onTagClick ? `Show all notes tagged “${f.name}”` : f.name}
          onClick={(e) => {
            e.stopPropagation()
            onTagClick?.(f.id)
          }}
        >
          <span
            className="size-1.5 shrink-0 rounded-full"
            style={{ backgroundColor: f.color || FOLDER_COLORS[0] }}
          />
          <span className="truncate">{f.name}</span>
        </button>
      ))}

      <DropdownMenu
        open={open}
        onOpenChange={(next) => {
          setOpen(next)
          if (next) {
            setFolders(loadFolders())
            setCreating(false)
            setName("")
          }
        }}
      >
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon-xs"
            className={cn(
              "text-muted-foreground",
              assigned.length === 0 && "opacity-0 transition-opacity group-hover:opacity-100",
            )}
            aria-label="Edit concept tags"
            title="Tags"
          >
            <HugeiconsIcon icon={TagsIcon} strokeWidth={2} className="size-3.5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="min-w-56" onClick={(e) => e.stopPropagation()}>
          <DropdownMenuLabel>Concept tags</DropdownMenuLabel>
          <p className="px-2 pb-1.5 text-[11px] text-muted-foreground">
            Multi-select — one note can cover several topics.
          </p>
          {folders.length === 0 && !creating && (
            <p className="px-2 py-1.5 text-xs text-muted-foreground">No tags yet</p>
          )}
          {folders.map((f) => {
            const checked = meeting.folderIds?.includes(f.id) ?? false
            return (
              <DropdownMenuCheckboxItem
                key={f.id}
                checked={checked}
                onCheckedChange={(v) => toggle(f.id, Boolean(v))}
                onSelect={(e) => e.preventDefault()}
              >
                <span
                  className="mr-1.5 size-2 shrink-0 rounded-full"
                  style={{ backgroundColor: f.color || FOLDER_COLORS[0] }}
                />
                {f.name}
              </DropdownMenuCheckboxItem>
            )
          })}
          <DropdownMenuSeparator />
          {creating ? (
            <div className="flex flex-col gap-1.5 p-2">
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Hiring, Roadmap"
                className="h-8 text-xs"
                autoFocus
                onKeyDown={(e) => {
                  e.stopPropagation()
                  if (e.key === "Enter") handleCreate()
                  if (e.key === "Escape") {
                    setCreating(false)
                    setName("")
                  }
                }}
                onClick={(e) => e.stopPropagation()}
              />
              <div className="flex justify-end gap-1">
                <Button
                  size="xs"
                  variant="ghost"
                  onClick={() => {
                    setCreating(false)
                    setName("")
                  }}
                >
                  Cancel
                </Button>
                <Button size="xs" disabled={!name.trim()} onClick={handleCreate}>
                  Create & tag
                </Button>
              </div>
            </div>
          ) : (
            <DropdownMenuItem
              onSelect={(e) => {
                e.preventDefault()
                setCreating(true)
              }}
            >
              <HugeiconsIcon icon={Add01Icon} strokeWidth={2} />
              New tag…
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

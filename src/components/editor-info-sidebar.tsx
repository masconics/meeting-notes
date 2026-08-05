import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { TemplateIcon } from "@/components/template-icon"
import { cn } from "@/lib/utils"
import { formatDate, formatTime } from "@/lib/format"
import type { PrepOpenLoop } from "@/lib/meeting-brief"
import type { SidebarPerson } from "@/lib/sidebar-people"
import { HugeiconsIcon } from "@hugeicons/react"
import {
  Add01Icon,
  Cancel01Icon,
  UserAdd02Icon,
} from "@hugeicons/core-free-icons"
import type { Meeting, MeetingTemplate } from "@/types"

export interface EditorInfoSidebarProps {
  dateIso: string
  wordCount: number
  template?: MeetingTemplate
  people: SidebarPerson[]
  related: Meeting[]
  /** Open action items from knowledge graph — real prep, not AI essay. */
  openLoops: PrepOpenLoop[]
  isAddingSpeaker: boolean
  newSpeakerName: string
  onClose?: () => void
  onTemplateClick: () => void
  onAddSpeakerStart: () => void
  onAddSpeakerConfirm: () => void
  onAddSpeakerCancel: () => void
  onNewSpeakerNameChange: (name: string) => void
  onRemoveSpeaker: (index: number) => void
  /** Rename speaker and rewrite labels across transcript (apply-all). */
  onRenameSpeaker?: (index: number, newName: string) => void
  onOpenRelated: (id: string) => void
  /** Mark an open loop done / reopen in the knowledge graph. */
  onToggleLoop?: (id: string, resolved: boolean) => void
  className?: string
}

/**
 * Left rail = context inspector.
 * Show people, open loops (carry-over work), related notes. No markdown “brief”
 * essay — that duplicated people/related and was wrong density for a rail.
 */
export function EditorInfoSidebar({
  dateIso,
  wordCount,
  template,
  people,
  related,
  openLoops,
  isAddingSpeaker,
  newSpeakerName,
  onClose,
  onTemplateClick,
  onAddSpeakerStart,
  onAddSpeakerConfirm,
  onAddSpeakerCancel,
  onNewSpeakerNameChange,
  onRemoveSpeaker,
  onRenameSpeaker,
  onOpenRelated,
  onToggleLoop,
  className,
}: EditorInfoSidebarProps) {
  const [renamingIndex, setRenamingIndex] = useState<number | null>(null)
  const [renameValue, setRenameValue] = useState("")
  const hasPeople = people.length > 0
  const hasLoops = openLoops.length > 0
  const hasRelated = related.length > 0

  return (
    <TooltipProvider delayDuration={280}>
      <div className={cn("editor-info flex h-full min-h-0 flex-col", className)}>
        <header className="editor-info-header">
          <div className="min-w-0">
            <p className="app-panel-title">Details</p>
            <p className="app-panel-meta truncate">
              {formatDate(dateIso)}
              <span className="text-border"> · </span>
              {formatTime(dateIso)}
              {wordCount > 0 && (
                <>
                  <span className="text-border"> · </span>
                  {wordCount.toLocaleString()} words
                </>
              )}
            </p>
          </div>
          {onClose && (
            <Button
              variant="ghost"
              size="icon-sm"
              className="shrink-0 text-muted-foreground lg:hidden"
              onClick={onClose}
              aria-label="Close details"
            >
              <HugeiconsIcon icon={Cancel01Icon} strokeWidth={2} />
            </Button>
          )}
        </header>

        <div className="editor-info-body">
          {/* People */}
          <section className="editor-info-section" aria-label="People">
            <div className="editor-info-section-head">
              <h2 className="editor-info-label">
                People
                {hasPeople && (
                  <span className="ml-1 font-normal tabular-nums text-muted-foreground/70">
                    {people.length}
                  </span>
                )}
              </h2>
              {!isAddingSpeaker && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      className="text-muted-foreground"
                      onClick={onAddSpeakerStart}
                      aria-label="Add speaker"
                    >
                      <HugeiconsIcon icon={UserAdd02Icon} strokeWidth={1.8} className="size-3.5" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">Add speaker</TooltipContent>
                </Tooltip>
              )}
            </div>

            <ul className="editor-info-people">
              {people.map((p) => {
                if (p.kind === "speaker") {
                  if (renamingIndex === p.index) {
                    return (
                      <li key={`sp-${p.index}`} className="editor-info-person editor-info-person--edit">
                        <Input
                          value={renameValue}
                          onChange={(e) => setRenameValue(e.target.value)}
                          placeholder="Real name"
                          className="h-7 border-0 bg-transparent px-0 text-xs shadow-none focus-visible:ring-0"
                          autoFocus
                          onKeyDown={(e) => {
                            if (e.key === "Enter" && renameValue.trim() && onRenameSpeaker) {
                              onRenameSpeaker(p.index, renameValue.trim())
                              setRenamingIndex(null)
                              setRenameValue("")
                            }
                            if (e.key === "Escape") {
                              setRenamingIndex(null)
                              setRenameValue("")
                            }
                          }}
                        />
                        <Button
                          size="icon-xs"
                          variant="ghost"
                          onClick={() => {
                            if (renameValue.trim() && onRenameSpeaker) {
                              onRenameSpeaker(p.index, renameValue.trim())
                            }
                            setRenamingIndex(null)
                            setRenameValue("")
                          }}
                          aria-label="Confirm rename"
                        >
                          <HugeiconsIcon icon={Add01Icon} strokeWidth={2} />
                        </Button>
                        <Button
                          size="icon-xs"
                          variant="ghost"
                          onClick={() => {
                            setRenamingIndex(null)
                            setRenameValue("")
                          }}
                          aria-label="Cancel rename"
                        >
                          <HugeiconsIcon icon={Cancel01Icon} strokeWidth={2} />
                        </Button>
                      </li>
                    )
                  }
                  return (
                    <li key={`sp-${p.index}`} className="editor-info-person group">
                      <span className={cn("editor-info-avatar", p.color)}>{initials(p.name)}</span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[12px] font-medium leading-tight">{p.name}</p>
                        <p className="text-[10px] text-muted-foreground">
                          Speaker
                          {onRenameSpeaker ? " · click to rename" : ""}
                        </p>
                      </div>
                      {onRenameSpeaker && (
                        <button
                          type="button"
                          onClick={() => {
                            setRenamingIndex(p.index)
                            setRenameValue(p.name)
                          }}
                          className="rounded-md px-1.5 py-0.5 text-[10px] text-muted-foreground opacity-0 transition-opacity hover:bg-foreground/8 hover:text-foreground group-hover:opacity-100"
                          aria-label={`Rename ${p.name}`}
                        >
                          Rename
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => onRemoveSpeaker(p.index)}
                        className="rounded-md p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-foreground/8 group-hover:opacity-100"
                        aria-label={`Remove ${p.name}`}
                      >
                        <HugeiconsIcon icon={Cancel01Icon} strokeWidth={2} className="size-3" />
                      </button>
                    </li>
                  )
                }
                if (p.kind === "attendee") {
                  return (
                    <li key={p.id} className="editor-info-person">
                      <span className="editor-info-avatar editor-info-avatar--muted">{initials(p.name)}</span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[12px] font-medium leading-tight">{p.name}</p>
                        {p.email ? (
                          <p className="truncate text-[10px] text-muted-foreground">{p.email}</p>
                        ) : (
                          <p className="text-[10px] text-muted-foreground">Invitee</p>
                        )}
                      </div>
                    </li>
                  )
                }
                return (
                  <li key={p.person.id} className="editor-info-person">
                    <span className="editor-info-avatar editor-info-avatar--brand">
                      {initials(p.person.name)}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[12px] font-medium leading-tight">{p.person.name}</p>
                      <p className="text-[10px] text-muted-foreground">Memory</p>
                    </div>
                  </li>
                )
              })}

              {isAddingSpeaker && (
                <li className="editor-info-person editor-info-person--edit">
                  <Input
                    value={newSpeakerName}
                    onChange={(e) => onNewSpeakerNameChange(e.target.value)}
                    placeholder="Name"
                    className="h-7 border-0 bg-transparent px-0 text-xs shadow-none focus-visible:ring-0"
                    autoFocus
                    onKeyDown={(e) => {
                      if (e.key === "Enter") onAddSpeakerConfirm()
                      if (e.key === "Escape") onAddSpeakerCancel()
                    }}
                  />
                  <Button size="icon-xs" variant="ghost" onClick={onAddSpeakerConfirm} aria-label="Confirm">
                    <HugeiconsIcon icon={Add01Icon} strokeWidth={2} />
                  </Button>
                  <Button size="icon-xs" variant="ghost" onClick={onAddSpeakerCancel} aria-label="Cancel">
                    <HugeiconsIcon icon={Cancel01Icon} strokeWidth={2} />
                  </Button>
                </li>
              )}
            </ul>

            {!hasPeople && !isAddingSpeaker && (
              <button type="button" onClick={onAddSpeakerStart} className="editor-info-quiet-action">
                Add people
              </button>
            )}
          </section>

          {/* Open loops — carry-over work, the only “prep” that belongs in a rail */}
          <section
            className={cn("editor-info-section", hasLoops && "editor-info-section--grow")}
            aria-label="Open loops"
          >
            <div className="editor-info-section-head">
              <h2 className="editor-info-label">
                Open loops
                {hasLoops && (
                  <span className="ml-1 font-normal tabular-nums text-muted-foreground/70">
                    {openLoops.length}
                  </span>
                )}
              </h2>
            </div>

            {hasLoops ? (
              <ul className="editor-info-loops">
                {openLoops.map((loop) => (
                  <li key={loop.id} className="editor-info-loop">
                    <button
                      type="button"
                      className="editor-info-loop-check"
                      onClick={() => onToggleLoop?.(loop.id, true)}
                      aria-label={`Mark done: ${loop.text}`}
                      disabled={!onToggleLoop}
                    >
                      <span className="editor-info-loop-box" aria-hidden />
                    </button>
                    <div className="min-w-0 flex-1">
                      <p className="text-[12px] leading-snug text-foreground/90">{loop.text}</p>
                      <p className="mt-0.5 truncate text-[10px] text-muted-foreground">
                        {[loop.assignee, loop.meetingTitle].filter(Boolean).join(" · ") || "Open"}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-[11px] leading-snug text-muted-foreground/75">
                Open action items from past notes with these people will show up here after you enhance a meeting.
              </p>
            )}
          </section>

          {/* Related — links only, no digests */}
          {hasRelated && (
            <section className="editor-info-section" aria-label="Related notes">
              <div className="editor-info-section-head">
                <h2 className="editor-info-label">Related</h2>
              </div>
              <ul className="flex flex-col gap-0.5">
                {related.map((m) => (
                  <li key={m.id}>
                    <button
                      type="button"
                      className="editor-info-link"
                      onClick={() => onOpenRelated(m.id)}
                    >
                      {m.title || "Untitled"}
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>

        <footer className="editor-info-footer">
          <button type="button" className="editor-info-footer-btn" onClick={onTemplateClick}>
            {template ? (
              <>
                <span className="inline-flex size-6 shrink-0 items-center justify-center rounded-md bg-background ring-1 ring-border/50">
                  <TemplateIcon name={template.icon} className="size-3.5" />
                </span>
                <span className="min-w-0 flex-1 truncate text-left">
                  <span className="block truncate text-[12px] font-medium">{template.name}</span>
                  <span className="block truncate text-[10px] text-muted-foreground">
                    {template.sections.length} section{template.sections.length === 1 ? "" : "s"}
                  </span>
                </span>
              </>
            ) : (
              <>
                <span className="inline-flex size-6 shrink-0 items-center justify-center rounded-md bg-background ring-1 ring-border/50 text-muted-foreground">
                  <span className="text-[11px] font-medium">T</span>
                </span>
                <span className="min-w-0 flex-1 text-left">
                  <span className="block text-[12px] font-medium text-muted-foreground">No template</span>
                  <span className="block text-[10px] text-muted-foreground/80">Structure enhance</span>
                </span>
              </>
            )}
          </button>
        </footer>
      </div>
    </TooltipProvider>
  )
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return "?"
  if (parts.length === 1) return parts[0].slice(0, 1).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

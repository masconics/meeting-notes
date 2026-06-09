import { useState, useCallback, useMemo } from "react"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { HugeiconsIcon } from "@hugeicons/react"
import {
  ArrowLeft01Icon,
  Calendar01Icon,
  Clock01Icon,
  Settings02Icon,
  AiChat02Icon,
  AiMagicIcon,
  DeleteIcon,
  Copy01Icon,
  UserAdd02Icon,
  Cancel01Icon,
  Add01Icon,
  ArrowDown01Icon,
} from "@hugeicons/core-free-icons"
import type { Meeting } from "@/types"
import { cn } from "@/lib/utils"
import { NoteEnhancer } from "@/components/note-enhancer"
import { MarkdownView } from "@/components/markdown-view"
import { QuickActions } from "@/components/quick-actions"
import { StructuredNoteView } from "@/components/structured-note-view"
import { Input } from "@/components/ui/input"
import { isAIConfigured } from "@/lib/ai-service"
import { toMarkdown, toPlainText, saveToFile } from "@/lib/export"
import { motion, AnimatePresence } from "framer-motion"

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

interface MeetingDetailPageProps {
  meeting: Meeting
  allMeetings?: Meeting[]
  onBack: () => void
  onSettings: () => void
  onSwitchMeeting?: (meeting: Meeting) => void
  onChat: (meeting: Meeting) => void
  onDelete: (id: string) => void
  onUpdate: (id: string, patch: Partial<Meeting>) => void
}

export function MeetingDetailPage({
  meeting,
  allMeetings,
  onBack,
  onSettings,
  onSwitchMeeting,
  onChat,
  onDelete,
  onUpdate,
}: MeetingDetailPageProps) {
  const [viewing, setViewing] = useState<Meeting>(meeting)
  const [copied, setCopied] = useState(false)
  const configured = isAIConfigured()
  const hasContent = viewing.transcript || viewing.notes || viewing.structuredNotes?.length

  const update = (patch: Partial<Meeting>) => {
    setViewing((prev) => ({ ...prev, ...patch }))
    onUpdate(viewing.id, patch)
  }

  const copyMarkdown = useCallback(async () => {
    await navigator.clipboard.writeText(toMarkdown(viewing))
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }, [viewing])

  const copyPlainText = useCallback(async () => {
    await navigator.clipboard.writeText(toPlainText(viewing))
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }, [viewing])

  const saveMarkdown = useCallback(async () => {
    await saveToFile(viewing, "md")
  }, [viewing])

  const saveText = useCallback(async () => {
    await saveToFile(viewing, "txt")
  }, [viewing])

  const SPEAKER_COLORS = [
    "bg-blue-500/20 text-blue-700 border-blue-500/30",
    "bg-amber-500/20 text-amber-700 border-amber-500/30",
    "bg-emerald-500/20 text-emerald-700 border-emerald-500/30",
    "bg-violet-500/20 text-violet-700 border-violet-500/30",
    "bg-rose-500/20 text-rose-700 border-rose-500/30",
    "bg-cyan-500/20 text-cyan-700 border-cyan-500/30",
    "bg-orange-500/20 text-orange-700 border-orange-500/30",
    "bg-teal-500/20 text-teal-700 border-teal-500/30",
    "bg-sky-500/20 text-sky-700 border-sky-500/30",
    "bg-pink-500/20 text-pink-700 border-pink-500/30",
    "bg-lime-500/20 text-lime-700 border-lime-500/30",
    "bg-indigo-500/20 text-indigo-700 border-indigo-500/30",
    "bg-fuchsia-500/20 text-fuchsia-700 border-fuchsia-500/30",
    "bg-yellow-500/20 text-yellow-700 border-yellow-500/30",
    "bg-green-500/20 text-green-700 border-green-500/30",
    "bg-red-500/20 text-red-700 border-red-500/30",
  ]

  const [selectedSpeakerIndex, setSelectedSpeakerIndex] = useState<number | null>(null)
  const [isAddingSpeaker, setIsAddingSpeaker] = useState(false)
  const [newSpeakerName, setNewSpeakerName] = useState("")
  const [editingSegmentIndex, setEditingSegmentIndex] = useState<number | null>(null)
  const [editSegmentText, setEditSegmentText] = useState("")

  const speakerLabels = useMemo(() => viewing.speakerLabels ?? [], [viewing.speakerLabels])

  const displaySegments = useMemo(() => {
    if (viewing.transcriptSegments) return viewing.transcriptSegments
    return viewing.transcript
      .split("\n")
      .map((line) => line.trim())
      .filter((text) => text.length > 0)
      .map((text) => ({ speakerIndex: -1, text }))
  }, [viewing.transcript, viewing.transcriptSegments])

  const handleAddSpeaker = () => {
    if (!newSpeakerName.trim()) return
    const colorIndex = speakerLabels.length % SPEAKER_COLORS.length
    const newLabels = [...speakerLabels, { name: newSpeakerName.trim(), color: SPEAKER_COLORS[colorIndex] }]
    update({ speakerLabels: newLabels })
    setNewSpeakerName("")
    setIsAddingSpeaker(false)
  }

  const handleDeleteSpeaker = (index: number) => {
    const newLabels = speakerLabels.filter((_, i) => i !== index)
    const currentSegments = viewing.transcriptSegments ?? displaySegments
    const newSegments = currentSegments.map((seg) => {
      if (seg.speakerIndex === index) return { ...seg, speakerIndex: -1 }
      if (seg.speakerIndex > index) return { ...seg, speakerIndex: seg.speakerIndex - 1 }
      return seg
    })
    update({ speakerLabels: newLabels, transcriptSegments: newSegments })
    if (selectedSpeakerIndex === index) {
      setSelectedSpeakerIndex(null)
    } else if (selectedSpeakerIndex !== null && selectedSpeakerIndex > index) {
      setSelectedSpeakerIndex(selectedSpeakerIndex - 1)
    }
  }

  const handleSegmentClick = (segmentIndex: number) => {
    if (selectedSpeakerIndex === null) return
    const currentSegments = viewing.transcriptSegments ?? displaySegments
    const updated = currentSegments.map((seg, i) => {
      if (i !== segmentIndex) return seg
      if (seg.speakerIndex === selectedSpeakerIndex) return { ...seg, speakerIndex: -1 }
      return { ...seg, speakerIndex: selectedSpeakerIndex }
    })
    update({ transcriptSegments: updated, speakerLabels })
  }

  const handleSegmentDoubleClick = (segmentIndex: number, text: string) => {
    setEditingSegmentIndex(segmentIndex)
    setEditSegmentText(text)
  }

  const handleSegmentSave = (segmentIndex: number) => {
    const currentSegments = viewing.transcriptSegments ?? displaySegments
    const updated = currentSegments.map((seg, i) =>
      i === segmentIndex ? { ...seg, text: editSegmentText.trim() } : seg
    )
    update({ transcriptSegments: updated, speakerLabels })
    setEditingSegmentIndex(null)
    setEditSegmentText("")
  }

  return (
    <div className="flex flex-col gap-6 w-full px-6 sm:px-8 lg:px-12">
      <div className="flex items-center gap-3 shrink-0">
        <Button variant="ghost" size="icon-sm" onClick={onBack} title="Back" aria-label="Back">
          <HugeiconsIcon icon={ArrowLeft01Icon} strokeWidth={2} />
        </Button>
        <div className="flex flex-col gap-0.5 min-w-0 flex-1">
          {allMeetings && allMeetings.length > 1 && onSwitchMeeting ? (
            <DropdownMenu>
              <DropdownMenuTrigger className="font-heading text-xl font-medium truncate hover:text-primary transition-colors inline-flex items-center gap-0.5 cursor-pointer">
                {viewing.title}
                <HugeiconsIcon icon={ArrowDown01Icon} strokeWidth={2} className="size-4" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="max-h-60 overflow-y-auto">
                {allMeetings.map((m) => (
                  <DropdownMenuItem key={m.id} onClick={() => onSwitchMeeting(m)}>
                    {m.title}
                    {m.id === viewing.id && (
                      <span className="text-[10px] text-muted-foreground ml-2">current</span>
                    )}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <h1 className="font-heading text-xl font-medium truncate">{viewing.title}</h1>
          )}
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <HugeiconsIcon icon={Calendar01Icon} strokeWidth={1.5} className="size-3" />
              {formatDate(viewing.date)}
            </span>
            <span className="inline-flex items-center gap-1">
              <HugeiconsIcon icon={Clock01Icon} strokeWidth={1.5} className="size-3" />
              {formatTime(viewing.date)}
            </span>
            <span>{formatDuration(viewing.duration)}</span>
          </div>
        </div>
        <Button variant="ghost" size="sm" onClick={() => onChat(viewing)}>
          <HugeiconsIcon icon={AiChat02Icon} strokeWidth={2} data-icon="inline-start" />
          Chat
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-sm" title="Copy" aria-label="Copy meeting notes">
              <AnimatePresence mode="wait">
                {copied ? (
                  <motion.div
                    key="copied"
                    initial={{ opacity: 0, scale: 0.8 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.8 }}
                    transition={{ type: "spring", stiffness: 400, damping: 20 }}
                  >
                    <span className="text-xs font-medium text-emerald-500">Copied</span>
                  </motion.div>
                ) : (
                  <motion.div
                    key="icon"
                    initial={{ opacity: 0, scale: 0.8 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.8 }}
                    transition={{ type: "spring", stiffness: 400, damping: 20 }}
                  >
                    <HugeiconsIcon icon={Copy01Icon} strokeWidth={2} />
                  </motion.div>
                )}
              </AnimatePresence>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={copyMarkdown}>
              Copy as Markdown
            </DropdownMenuItem>
            <DropdownMenuItem onClick={copyPlainText}>
              Copy as Plain Text
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={saveMarkdown}>
              Save as Markdown
            </DropdownMenuItem>
            <DropdownMenuItem onClick={saveText}>
              Save as Text File
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <Button variant="ghost" size="icon-sm" onClick={onSettings} title="Settings" aria-label="Settings">
          <HugeiconsIcon icon={Settings02Icon} strokeWidth={2} />
        </Button>
      </div>

      {!hasContent ? (
        <div className="flex flex-col items-center gap-3 py-20 text-muted-foreground">
          <HugeiconsIcon icon={AiChat02Icon} strokeWidth={2} className="size-10" />
          <div className="text-center">
            <p className="text-sm font-medium">No notes captured</p>
            <p className="text-xs">Transcript and notes from this meeting were not saved.</p>
          </div>
        </div>
      ) : (
        <motion.div
          key={viewing.id}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25, delay: 0.1 }}
          className="flex flex-col gap-6"
        >
          {viewing.transcript && (
            <>
              <section className="flex flex-col gap-2">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Speakers</h3>
                <div className="flex items-center gap-2 flex-wrap">
                  {speakerLabels.map((label, i) => (
                    <button
                      key={i}
                      type="button"
                      onClick={() => setSelectedSpeakerIndex(selectedSpeakerIndex === i ? null : i)}
                      className={cn(
                        "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border transition-all cursor-pointer",
                        label.color,
                        selectedSpeakerIndex === i && "ring-2 ring-ring ring-offset-1"
                      )}
                    >
                      <span className="size-2 rounded-full bg-current opacity-60 shrink-0" />
                      {label.name}
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation()
                          handleDeleteSpeaker(i)
                        }}
                        className="ml-0.5 p-0.5 rounded-full hover:bg-black/10 transition-colors cursor-pointer"
                      >
                        <HugeiconsIcon icon={Cancel01Icon} strokeWidth={2} className="size-3" />
                      </button>
                    </button>
                  ))}
                  {isAddingSpeaker ? (
                    <div className="flex items-center gap-1">
                      <Input
                        value={newSpeakerName}
                        onChange={(e) => setNewSpeakerName(e.target.value)}
                        placeholder="Speaker name"
                        className="h-7 w-28 text-xs"
                        autoFocus
                        onKeyDown={(e) => {
                          if (e.key === "Enter") handleAddSpeaker()
                          if (e.key === "Escape") {
                            setIsAddingSpeaker(false)
                            setNewSpeakerName("")
                          }
                        }}
                      />
                      <Button size="icon-sm" variant="ghost" onClick={handleAddSpeaker}>
                        <HugeiconsIcon icon={Add01Icon} strokeWidth={2} />
                      </Button>
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        onClick={() => {
                          setIsAddingSpeaker(false)
                          setNewSpeakerName("")
                        }}
                      >
                        <HugeiconsIcon icon={Cancel01Icon} strokeWidth={2} />
                      </Button>
                    </div>
                  ) : (
                    <Button variant="outline" size="sm" onClick={() => setIsAddingSpeaker(true)}>
                      <HugeiconsIcon icon={UserAdd02Icon} strokeWidth={2} data-icon="inline-start" />
                      Add Speaker
                    </Button>
                  )}
                </div>
                {selectedSpeakerIndex !== null && speakerLabels[selectedSpeakerIndex] && (
                  <p className="text-xs text-muted-foreground">
                    Click transcript lines to assign to{" "}
                    <span className={cn("font-medium rounded px-1 py-0.5", speakerLabels[selectedSpeakerIndex].color)}>
                      {speakerLabels[selectedSpeakerIndex].name}
                    </span>
                  </p>
                )}
              </section>

              <section className="flex flex-col gap-2">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Transcript</h3>
                <div className="flex flex-col gap-0.5 bg-muted rounded-2xl p-3 max-h-80 overflow-y-auto">
                  {displaySegments.map((seg, i) => {
                    const speaker = seg.speakerIndex >= 0 ? speakerLabels[seg.speakerIndex] : null
                    const isEditing = editingSegmentIndex === i
                    return (
                      <div
                        key={i}
                        className={cn(
                          "text-sm px-3 py-1.5 rounded-xl transition-colors leading-relaxed group",
                          !isEditing && "cursor-pointer",
                          isEditing
                            ? "bg-background ring-2 ring-ring"
                            : speaker
                              ? cn(speaker.color, "border")
                              : "text-muted-foreground hover:bg-muted-foreground/10",
                          selectedSpeakerIndex !== null && !isEditing && "hover:ring-1 hover:ring-ring/50"
                        )}
                      >
                        {isEditing ? (
                          <div className="flex flex-col gap-1.5">
                            <textarea
                              value={editSegmentText}
                              onChange={(e) => setEditSegmentText(e.target.value)}
                              className="w-full min-h-16 text-sm bg-transparent outline-none resize-none rounded-xl p-2 border border-border"
                              autoFocus
                              onKeyDown={(e) => {
                                if (e.key === "Escape") {
                                  setEditingSegmentIndex(null)
                                  setEditSegmentText("")
                                }
                                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                                  handleSegmentSave(i)
                                }
                              }}
                            />
                            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                              <Button
                                variant="ghost"
                                size="xs"
                                onClick={() => handleSegmentSave(i)}
                              >
                                Save
                              </Button>
                              <Button
                                variant="ghost"
                                size="xs"
                                onClick={() => {
                                  setEditingSegmentIndex(null)
                                  setEditSegmentText("")
                                }}
                              >
                                Cancel
                              </Button>
                              <span className="ml-auto">Enter to save, Esc to cancel</span>
                            </div>
                          </div>
                        ) : (
                          <div
                            onClick={() => handleSegmentClick(i)}
                            onDoubleClick={() => handleSegmentDoubleClick(i, seg.text)}
                            title="Double-click to edit"
                          >
                            {speaker && (
                              <span className="text-[10px] font-semibold uppercase tracking-wide mr-2 opacity-70">
                                {speaker.name}
                              </span>
                            )}
                            <span className="transcript-text">{seg.text}</span>
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              </section>
            </>
          )}

          {viewing.notes && (
            <section className="flex flex-col gap-2">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Raw Notes</h3>
              <MarkdownView
                markdown={viewing.notes}
                editable
                onChange={(value) => update({ notes: value })}
                className="text-sm max-h-60 overflow-y-auto leading-relaxed bg-muted rounded-2xl p-4"
                editorLabel="Edit raw notes"
              />
            </section>
          )}

          {viewing.structuredNotes && viewing.structuredNotes.length > 0 && (
            <section className="flex flex-col gap-2">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-primary flex items-center gap-1.5">
                <HugeiconsIcon icon={AiMagicIcon} strokeWidth={1.5} className="size-3.5" />
                Structured Notes
              </h3>
              <div className="border border-border rounded-2xl p-4">
                <StructuredNoteView
                  sections={viewing.structuredNotes}
                  editable
                  onChange={(sections) => update({ structuredNotes: sections })}
                />
              </div>
            </section>
          )}

          {viewing.enhancedNotes && !viewing.structuredNotes && (
            <section className="flex flex-col gap-2">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-primary flex items-center gap-1.5">
                <HugeiconsIcon icon={AiMagicIcon} strokeWidth={1.5} className="size-3.5" />
                AI Enhanced Notes
              </h3>
              <MarkdownView
                markdown={viewing.enhancedNotes}
                editable
                onChange={(value) => update({ enhancedNotes: value })}
                className="text-sm leading-relaxed bg-primary/5 rounded-2xl p-4 border border-primary/10"
                editorLabel="Edit enhanced notes"
              />
            </section>
          )}

          <Separator />

          {configured ? (
            <div className="flex flex-col gap-6">
              <section>
                <NoteEnhancer
                  meeting={viewing}
                  onUpdate={(updated) => {
                    setViewing(updated)
                    onUpdate(updated.id, {
                      structuredNotes: updated.structuredNotes,
                      enhancedNotes: updated.enhancedNotes,
                    })
                  }}
                />
              </section>
              <section>
                <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">Quick Actions</h3>
                <QuickActions meeting={viewing} onInsertToNotes={(content) => update({ notes: viewing.notes ? viewing.notes + "\n\n" + content : content })} />
              </section>
            </div>
          ) : (
            <div className="flex items-center justify-between gap-3 rounded-2xl border border-dashed p-4">
              <div className="flex flex-col gap-0.5">
                <p className="text-sm font-medium flex items-center gap-1.5">
                  <HugeiconsIcon icon={AiMagicIcon} strokeWidth={2} className="size-4" />
                  AI features are off
                </p>
                <p className="text-xs text-muted-foreground">
                  Enable AI in Settings for enhancement, quick actions, and chat.
                </p>
              </div>
              <Button variant="outline" size="sm" className="shrink-0" onClick={onSettings}>
                <HugeiconsIcon icon={Settings02Icon} strokeWidth={2} data-icon="inline-start" />
                Settings
              </Button>
            </div>
          )}

          <div className="flex justify-end">
            <Button variant="destructive" size="sm" onClick={() => { onDelete(viewing.id); onBack() }}>
              <HugeiconsIcon icon={DeleteIcon} strokeWidth={2} data-icon="inline-start" />
              Delete Meeting
            </Button>
          </div>
        </motion.div>
      )}
    </div>
  )
}

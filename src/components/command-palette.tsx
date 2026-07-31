import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { AnimatePresence, motion } from "framer-motion"
import { HugeiconsIcon } from "@hugeicons/react"
import { Calendar01Icon, FileAddIcon, Search01Icon, Settings02Icon } from "@hugeicons/core-free-icons"
import type { Meeting } from "@/types"
import { formatDuration } from "@/lib/format"

interface PaletteItem {
  id: string
  kind: "action" | "meeting"
  label: string
  hint?: string
  run: () => void
}

interface CommandPaletteProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  meetings: Meeting[]
  onOpenMeeting: (meeting: Meeting) => void
  onNewNote: () => void
  onOpenSettings: () => void
}

const MAX_MEETINGS = 8

export function CommandPalette({ open, onOpenChange, meetings, onOpenMeeting, onNewNote, onOpenSettings }: CommandPaletteProps) {
  return (
    <AnimatePresence>
      {open && (
        <PalettePanel
          meetings={meetings}
          onOpenMeeting={onOpenMeeting}
          onNewNote={onNewNote}
          onOpenSettings={onOpenSettings}
          onClose={() => onOpenChange(false)}
        />
      )}
    </AnimatePresence>
  )
}

// Mounted fresh on every open, so query/selection state starts clean without
// reset effects.
function PalettePanel({ meetings, onOpenMeeting, onNewNote, onOpenSettings, onClose }: Omit<CommandPaletteProps, "open" | "onOpenChange"> & { onClose: () => void }) {
  const [query, setQuery] = useState("")
  const [activeIndex, setActiveIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const listRef = useRef<HTMLDivElement | null>(null)

  const items = useMemo<PaletteItem[]>(() => {
    const q = query.trim().toLowerCase()
    const out: PaletteItem[] = []

    const actions: PaletteItem[] = [
      { id: "new-note", kind: "action", label: "New note", hint: "⌘N", run: onNewNote },
      { id: "settings", kind: "action", label: "Open Settings", hint: "⌘,", run: onOpenSettings },
      {
        id: "actions-inbox",
        kind: "action",
        label: "Open Actions inbox",
        run: () => {
          onClose()
          window.dispatchEvent(new CustomEvent("dashboard-pane", { detail: { pane: "actions" } }))
        },
      },
      {
        id: "people",
        kind: "action",
        label: "Open People memory",
        run: () => {
          onClose()
          window.dispatchEvent(new CustomEvent("dashboard-pane", { detail: { pane: "people" } }))
        },
      },
    ]
    for (const a of actions) {
      if (!q || a.label.toLowerCase().includes(q)) out.push(a)
    }

    const matched = q ? meetings.filter(m => m.title.toLowerCase().includes(q)) : meetings
    for (const m of matched.slice(0, MAX_MEETINGS)) {
      out.push({
        id: `meeting-${m.id}`,
        kind: "meeting",
        label: m.title,
        hint: m.duration > 0 ? formatDuration(m.duration) : undefined,
        run: () => onOpenMeeting(m),
      })
    }
    return out
  }, [query, meetings, onNewNote, onOpenMeeting, onOpenSettings])

  // Focus after the enter animation frame so the input is mounted.
  useEffect(() => {
    requestAnimationFrame(() => inputRef.current?.focus())
  }, [])

  // Keep the active row visible while arrow-navigating.
  useEffect(() => {
    listRef.current
      ?.querySelector(`[data-index="${activeIndex}"]`)
      ?.scrollIntoView({ block: "nearest" })
  }, [activeIndex])

  const handleQueryChange = useCallback((value: string) => {
    setQuery(value)
    setActiveIndex(0)
  }, [])

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setActiveIndex(i => (items.length === 0 ? 0 : (i + 1) % items.length)) }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActiveIndex(i => (items.length === 0 ? 0 : (i - 1 + items.length) % items.length)) }
    else if (e.key === "Enter") { e.preventDefault(); const item = items[activeIndex]; if (item) { onClose(); item.run() } }
    else if (e.key === "Escape") { e.preventDefault(); onClose() }
  }

  return (
    <div className="fixed inset-0 z-[90]" role="dialog" aria-modal="true" aria-label="Command palette">
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.12 }}
        className="absolute inset-0 bg-black/30 backdrop-blur-sm"
        onClick={onClose}
      />
      <motion.div
        initial={{ opacity: 0, y: -8, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: -6, scale: 0.98 }}
        transition={{ duration: 0.14, ease: "easeOut" }}
        className="absolute left-1/2 top-[16vh] w-full max-w-lg -translate-x-1/2 px-4"
      >
        <div className="overflow-hidden rounded-2xl border border-border/70 bg-background shadow-2xl">
          <div className="flex items-center gap-2.5 border-b border-border/60 px-4">
            <HugeiconsIcon icon={Search01Icon} strokeWidth={2} className="size-4 shrink-0 text-muted-foreground" />
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => handleQueryChange(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder="Jump to a note or action…"
              className="h-11 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground/60"
            />
            <kbd className="shrink-0 rounded border border-border/70 bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">esc</kbd>
          </div>

          <div ref={listRef} className="scroll-fade max-h-72 overflow-y-auto p-1.5">
            {items.length === 0 ? (
              <div className="px-3 py-6 text-center text-xs text-muted-foreground">
                No notes match "{query}"
              </div>
            ) : (
              items.map((item, i) => (
                <button
                  key={item.id}
                  data-index={i}
                  onMouseEnter={() => setActiveIndex(i)}
                  onClick={() => { onClose(); item.run() }}
                  className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm transition-colors ${
                    i === activeIndex ? "bg-primary/10 text-foreground" : "text-foreground/80"
                  }`}
                >
                  <HugeiconsIcon
                    icon={item.kind === "meeting" ? Calendar01Icon : item.id === "settings" ? Settings02Icon : FileAddIcon}
                    strokeWidth={1.8}
                    className="size-4 shrink-0 text-muted-foreground"
                  />
                  <span className="min-w-0 flex-1 truncate">{item.label}</span>
                  {item.hint && (
                    <span className="shrink-0 text-[11px] text-muted-foreground">{item.hint}</span>
                  )}
                </button>
              ))
            )}
          </div>

          <div className="flex items-center gap-3 border-t border-border/60 px-4 py-2 text-[11px] text-muted-foreground">
            <span><kbd className="font-sans">↑↓</kbd> navigate</span>
            <span><kbd className="font-sans">↵</kbd> open</span>
            <span className="ml-auto">⌘K to toggle</span>
          </div>
        </div>
      </motion.div>
    </div>
  )
}

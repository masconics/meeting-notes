import type { ReactNode } from "react"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog"
import { cn } from "@/lib/utils"

const GROUPS: { title: string; rows: { keys: string[]; label: string }[] }[] = [
  {
    title: "Everywhere",
    rows: [
      { keys: ["⌘", "K"], label: "Command palette" },
      { keys: ["⌘", "N"], label: "New note" },
      { keys: ["⌘", "⇧", "N"], label: "Quick capture" },
      { keys: ["⌘", ","], label: "Settings" },
      { keys: ["⌘", "/"], label: "Keyboard shortcuts" },
      { keys: ["Esc"], label: "Back / dismiss" },
    ],
  },
  {
    title: "Dashboard",
    rows: [
      { keys: ["⌘", "F"], label: "Search notes" },
    ],
  },
  {
    title: "Note editor",
    rows: [
      { keys: ["⌘", "S"], label: "Save note" },
      { keys: ["⌘", "⇧", "R"], label: "Start / stop recording" },
      { keys: ["⌘", "⇧", "F"], label: "Focus mode" },
      { keys: ["⌘", "F"], label: "Find in note" },
      { keys: ["⌘", "B"], label: "Bold" },
      { keys: ["⌘", "I"], label: "Italic" },
      { keys: ["/"], label: "Insert block" },
      { keys: [";", "space"], label: "Expand text shortcut" },
    ],
  },
]

function Kbd({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <kbd
      className={cn(
        "inline-flex h-6 min-w-6 items-center justify-center rounded-md bg-muted px-1.5 font-sans text-[11px] font-medium text-muted-foreground ring-1 ring-border/70",
        className,
      )}
    >
      {children}
    </kbd>
  )
}

/**
 * Keyboard cheat sheet — dense, scannable rows (production settings advice:
 * 13px labels, quiet hierarchy, consistent kbd chrome, no helper walls).
 */
export function ShortcutsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md gap-0 overflow-hidden p-0 sm:max-w-md">
        <DialogHeader className="border-b border-border/50 px-5 py-4">
          <DialogTitle className="text-[15px] font-medium tracking-tight">Keyboard shortcuts</DialogTitle>
          <DialogDescription className="text-[13px]">
            Stay on the keyboard. Press <Kbd className="mx-0.5 align-middle">⌘</Kbd>
            <Kbd className="align-middle">/</Kbd> anytime.
          </DialogDescription>
        </DialogHeader>

        <div className="scroll-fade max-h-[min(28rem,70vh)] overflow-y-auto px-2 py-2">
          {GROUPS.map((group) => (
            <section key={group.title} className="px-2 py-2.5">
              <h3 className="mb-1.5 px-1 text-[11px] font-medium uppercase tracking-[0.05em] text-muted-foreground">
                {group.title}
              </h3>
              <ul className="flex flex-col">
                {group.rows.map((row) => (
                  <li
                    key={row.label}
                    className="flex h-10 items-center justify-between gap-4 rounded-xl px-2.5 transition-colors hover:bg-muted/50"
                  >
                    <span className="min-w-0 truncate text-[13px] text-foreground/90">{row.label}</span>
                    <span className="flex shrink-0 items-center gap-1">
                      {row.keys.map((k, i) => (
                        <Kbd key={`${row.label}-${k}-${i}`}>{k}</Kbd>
                      ))}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  )
}

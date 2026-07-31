import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog"

const GROUPS: { title: string; rows: { keys: string[]; label: string }[] }[] = [
  {
    title: "Everywhere",
    rows: [
      { keys: ["⌘", "K"], label: "Command palette — jump to any note or action" },
      { keys: ["⌘", "N"], label: "New note" },
      { keys: ["⌘", "⇧", "N"], label: "Quick capture from any app" },
      { keys: ["⌘", ","], label: "Settings" },
      { keys: ["⌘", "/"], label: "This cheat sheet" },
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
      { keys: ["⌘", "⇧", "F"], label: "Focus mode — hide all chrome" },
      { keys: ["⌘", "F"], label: "Find in note" },
      { keys: ["⌘", "B"], label: "Bold" },
      { keys: ["⌘", "I"], label: "Italic" },
      { keys: ["/"], label: "Insert block menu (start of a line)" },
      { keys: [";"], label: "Snippet trigger + space expands" },
    ],
  },
]

export function ShortcutsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
          <DialogDescription>Work a meeting without touching the mouse.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-5">
          {GROUPS.map(group => (
            <div key={group.title}>
              <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">{group.title}</h3>
              <ul className="flex flex-col gap-1.5">
                {group.rows.map(row => (
                  <li key={row.label} className="flex items-center justify-between gap-4 text-sm">
                    <span className="text-foreground/85">{row.label}</span>
                    <span className="flex shrink-0 items-center gap-1">
                      {row.keys.map(k => (
                        <kbd
                          key={k}
                          className="inline-flex h-5 min-w-5 items-center justify-center rounded border border-border/70 bg-muted px-1.5 text-[11px] font-medium text-muted-foreground"
                        >
                          {k}
                        </kbd>
                      ))}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  )
}

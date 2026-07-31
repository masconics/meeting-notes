import { useMemo } from "react"
import { cn } from "@/lib/utils"
import { HugeiconsIcon } from "@hugeicons/react"
import { CheckmarkCircle02Icon, CheckListIcon } from "@hugeicons/core-free-icons"
import { parseChecklistMarkdown, toggleChecklistLine } from "@/lib/checklist"

/**
 * Interactive checklist for action digests — marked renders disabled checkboxes;
 * this is a real control that persists via onChange.
 */
export function ChecklistView({
  markdown,
  onChange,
  className,
}: {
  markdown: string
  onChange?: (next: string) => void
  className?: string
}) {
  const lines = useMemo(() => parseChecklistMarkdown(markdown), [markdown])
  const hasItems = lines.some((l) => l.kind === "item")
  const readOnly = !onChange

  if (!hasItems) {
    return (
      <div className={cn("mdx-brief whitespace-pre-wrap text-[12px] leading-relaxed", className)}>
        {markdown}
      </div>
    )
  }

  return (
    <ul className={cn("flex flex-col gap-0.5", className)} aria-label="Checklist">
      {lines.map((line, i) => {
        if (line.kind === "text") {
          if (!line.raw.trim()) return <li key={i} className="h-1.5" aria-hidden />
          const heading = line.raw.match(/^#{1,6}\s+(.*)$/)
          if (heading) {
            return (
              <li
                key={i}
                className="mt-2 first:mt-0 text-[11px] font-medium uppercase tracking-wide text-muted-foreground"
              >
                {heading[1]}
              </li>
            )
          }
          return (
            <li key={i} className="px-0.5 text-[12px] text-muted-foreground">
              {line.raw}
            </li>
          )
        }

        const done = Boolean(line.checked)
        return (
          <li key={i}>
            <button
              type="button"
              disabled={readOnly}
              onClick={() => onChange?.(toggleChecklistLine(markdown, i))}
              className={cn(
                "flex w-full items-start gap-2 rounded-lg px-1.5 py-1.5 text-left transition-colors",
                !readOnly && "hover:bg-muted/60",
                readOnly && "cursor-default",
              )}
              aria-pressed={done}
              aria-label={done ? `Mark incomplete: ${line.body}` : `Mark complete: ${line.body}`}
            >
              <HugeiconsIcon
                icon={done ? CheckmarkCircle02Icon : CheckListIcon}
                strokeWidth={2}
                className={cn(
                  "mt-0.5 size-4 shrink-0",
                  done ? "text-primary" : "text-muted-foreground",
                )}
              />
              <span
                className={cn(
                  "min-w-0 flex-1 text-[12px] leading-snug",
                  done ? "text-muted-foreground line-through" : "text-foreground/90",
                )}
              >
                {line.body}
              </span>
            </button>
          </li>
        )
      })}
    </ul>
  )
}

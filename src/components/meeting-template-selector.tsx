import { useMemo, useState } from "react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { HugeiconsIcon } from "@hugeicons/react"
import { CheckmarkBadge01Icon, Cancel01Icon } from "@hugeicons/core-free-icons"
import type { MeetingTemplate } from "@/types"
import { getTemplates } from "@/lib/templates"
import { TemplateIcon } from "@/components/template-icon"
import { cn } from "@/lib/utils"

interface MeetingTemplateSelectorProps {
  selectedId?: string
  onSelect: (template: MeetingTemplate | undefined) => void
  open: boolean
  onOpenChange: (open: boolean) => void
}

/**
 * Pick a structure for enhance — dense list, one selected state, minimal chrome.
 * (Production settings: 13px rows, quiet hierarchy, no dashed-card soup.)
 */
export function MeetingTemplateSelector({
  selectedId,
  onSelect,
  open,
  onOpenChange,
}: MeetingTemplateSelectorProps) {
  const [query, setQuery] = useState("")
  const [previewId, setPreviewId] = useState<string | null>(null)
  // Re-read catalog when dialog opens (localStorage is cheap).
  const templates = useMemo(() => (open ? getTemplates() : []), [open])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return templates
    return templates.filter(
      (t) =>
        t.name.toLowerCase().includes(q) ||
        t.sections.some((s) => s.toLowerCase().includes(q)),
    )
  }, [templates, query])

  const pick = (t: MeetingTemplate | undefined) => {
    onSelect(t)
    onOpenChange(false)
    setQuery("")
    setPreviewId(null)
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o)
        if (!o) {
          setQuery("")
          setPreviewId(null)
        }
      }}
    >
      <DialogContent className="gap-0 overflow-hidden p-0 sm:max-w-md" showCloseButton>
        <DialogHeader className="border-b border-border/50 px-5 py-4">
          <DialogTitle className="text-[15px] font-medium tracking-tight">
            Structure notes
          </DialogTitle>
          <DialogDescription className="text-[13px]">
            Template sections guide AI when you enhance.
          </DialogDescription>
        </DialogHeader>

        {templates.length > 5 && (
          <div className="border-b border-border/40 px-4 py-2.5">
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Filter templates…"
              className="h-8 text-[13px]"
              aria-label="Filter templates"
            />
          </div>
        )}

        <div className="scroll-fade max-h-[min(22rem,60vh)] overflow-y-auto px-2 py-2">
          <button
            type="button"
            className={cn(
              "flex w-full items-center gap-3 rounded-xl px-2.5 py-2.5 text-left transition-colors",
              !selectedId
                ? "bg-muted shadow-sm ring-1 ring-border/60"
                : "hover:bg-muted/50",
            )}
            onClick={() => pick(undefined)}
          >
            <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg bg-background ring-1 ring-border/60">
              <HugeiconsIcon icon={Cancel01Icon} strokeWidth={2} className="size-3.5 text-muted-foreground" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[13px] font-medium">No template</span>
              <span className="block text-[11px] text-muted-foreground">Free-form notes</span>
            </span>
            {!selectedId && (
              <HugeiconsIcon icon={CheckmarkBadge01Icon} strokeWidth={2} className="size-4 shrink-0 text-brand" />
            )}
          </button>

          {filtered.length === 0 ? (
            <p className="px-2.5 py-6 text-center text-[13px] text-muted-foreground">
              No templates match “{query.trim()}”
            </p>
          ) : (
            <ul className="mt-0.5 flex flex-col">
              {filtered.map((t) => {
                const selected = t.id === selectedId
                const openPreview = previewId === t.id
                return (
                  <li key={t.id}>
                    <div
                      className={cn(
                        "rounded-xl transition-colors",
                        selected && "bg-muted shadow-sm ring-1 ring-border/60",
                        !selected && "hover:bg-muted/50",
                      )}
                    >
                      <button
                        type="button"
                        className="flex w-full items-center gap-3 px-2.5 py-2.5 text-left"
                        onClick={() => pick(t)}
                      >
                        <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg bg-background ring-1 ring-border/50">
                          <TemplateIcon name={t.icon} className="size-4" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[13px] font-medium">{t.name}</span>
                          <span className="block truncate text-[11px] text-muted-foreground">
                            {t.sections.length} section{t.sections.length === 1 ? "" : "s"}
                            {t.quickActions.length > 0 &&
                              ` · ${t.quickActions.length} action${t.quickActions.length === 1 ? "" : "s"}`}
                          </span>
                        </span>
                        {selected && (
                          <HugeiconsIcon
                            icon={CheckmarkBadge01Icon}
                            strokeWidth={2}
                            className="size-4 shrink-0 text-brand"
                          />
                        )}
                      </button>
                      {t.sections.length > 0 && (
                        <button
                          type="button"
                          className="w-full px-2.5 pb-2 text-left text-[11px] text-muted-foreground/80 transition-colors hover:text-foreground"
                          onClick={() => setPreviewId(openPreview ? null : t.id)}
                        >
                          {openPreview ? "Hide sections" : "Show sections"}
                        </button>
                      )}
                      {openPreview && (
                        <ul className="flex flex-wrap gap-1 px-2.5 pb-2.5">
                          {t.sections.map((s) => (
                            <li
                              key={s}
                              className="rounded-md bg-background px-1.5 py-0.5 text-[11px] text-muted-foreground ring-1 ring-border/50"
                            >
                              {s}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

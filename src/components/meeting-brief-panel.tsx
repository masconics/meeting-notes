import { Button } from "@/components/ui/button"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { MarkdownView } from "@/components/markdown-view"
import { HugeiconsIcon } from "@hugeicons/react"
import { Cancel01Icon, Delete02Icon, RefreshIcon } from "@hugeicons/core-free-icons"
import { cn } from "@/lib/utils"

export interface MeetingBriefPanelProps {
  markdown: string
  loading?: boolean
  onRefresh?: () => void
  onClear?: () => void
  onDismiss?: () => void
  /** When true, parent owns the section title — only actions + body render. */
  hideChrome?: boolean
  /** sidebar = inline in editor info col; dashboard = under a note card */
  variant?: "sidebar" | "dashboard"
  className?: string
}

/**
 * Brief is opt-in prep context — only render when the user generated one.
 * Visual goal: readable notes, almost no chrome (no accent bars, no nested cards).
 */
export function MeetingBriefPanel({
  markdown,
  loading = false,
  onRefresh,
  onClear,
  onDismiss,
  hideChrome = false,
  variant = "sidebar",
  className,
}: MeetingBriefPanelProps) {
  const isDashboard = variant === "dashboard"
  const showChrome = !hideChrome

  if (loading && !markdown) {
    return (
      <div className={cn("space-y-2 py-0.5", className)} aria-busy="true" aria-label="Loading brief">
        <div className="h-2 w-1/3 animate-pulse rounded bg-muted" />
        <div className="h-2 w-full animate-pulse rounded bg-muted" />
        <div className="h-2 w-[92%] animate-pulse rounded bg-muted" />
        <div className="h-2 w-4/5 animate-pulse rounded bg-muted" />
      </div>
    )
  }

  if (!markdown && !loading) return null

  const actions = (onRefresh || onClear || onDismiss) && (
    <div className="flex items-center gap-0.5 opacity-70 transition-opacity group-hover/brief:opacity-100">
      {loading && showChrome && (
        <span className="mr-1 text-[10px] text-muted-foreground">Updating</span>
      )}
      {onRefresh && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              className="text-muted-foreground"
              onClick={onRefresh}
              disabled={loading}
              aria-label="Refresh brief"
            >
              <HugeiconsIcon
                icon={RefreshIcon}
                strokeWidth={2}
                className={cn("size-3.5", loading && "animate-spin")}
              />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">Refresh</TooltipContent>
        </Tooltip>
      )}
      {onClear && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              className="text-muted-foreground"
              onClick={onClear}
              aria-label="Remove brief"
            >
              <HugeiconsIcon icon={Delete02Icon} strokeWidth={2} className="size-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">Remove brief</TooltipContent>
        </Tooltip>
      )}
      {onDismiss && (
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          className="text-muted-foreground"
          onClick={onDismiss}
          aria-label="Dismiss"
        >
          <HugeiconsIcon icon={Cancel01Icon} strokeWidth={2} className="size-3.5" />
        </Button>
      )}
    </div>
  )

  return (
    <TooltipProvider delayDuration={280}>
      <div
        className={cn(
          "group/brief min-h-0",
          hideChrome && "flex flex-1 flex-col",
          isDashboard && "rounded-xl bg-muted/40 px-3 py-2.5",
          className,
        )}
        aria-label="Meeting brief"
      >
        {showChrome && (
          <div className="mb-1.5 flex items-center justify-between gap-2">
            <p className="text-[11px] font-medium uppercase tracking-[0.06em] text-muted-foreground">
              Brief
            </p>
            {actions}
          </div>
        )}
        {!showChrome && actions && (
          <div className="mb-1 flex shrink-0 justify-end">{actions}</div>
        )}

        {markdown ? (
          <div
            className={cn(
              "editor-brief__body text-muted-foreground",
              isDashboard
                ? "scroll-fade max-h-52 overflow-y-auto"
                : hideChrome
                  ? "scroll-fade min-h-0 flex-1 overflow-y-auto"
                  : "scroll-fade max-h-[min(22rem,42vh)] overflow-y-auto",
            )}
          >
            <MarkdownView markdown={markdown} proseClassName="mdx-brief" />
          </div>
        ) : null}
      </div>
    </TooltipProvider>
  )
}

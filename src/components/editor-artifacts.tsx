import { useMemo } from "react"
import { Button } from "@/components/ui/button"
import { MarkdownView } from "@/components/markdown-view"
import { ChecklistView } from "@/components/checklist-view"
import { parseChecklistMarkdown } from "@/lib/checklist"
import { cn } from "@/lib/utils"
import { HugeiconsIcon } from "@hugeicons/react"
import {
  Alert02Icon,
  CheckListIcon,
  Mail01Icon,
  RefreshIcon,
} from "@hugeicons/core-free-icons"
import type { Recipe } from "@/types"

/** Built-in artifact recipes we surface as first-class tabs (not buried menus). */
export const ARTIFACT_RECIPE_IDS = [
  "recipe-action-digest",
  "recipe-standup-blockers",
  "recipe-followup-email",
] as const

const RECIPE_ICONS: Record<string, typeof CheckListIcon> = {
  "recipe-action-digest": CheckListIcon,
  "recipe-standup-blockers": Alert02Icon,
  "recipe-followup-email": Mail01Icon,
}

const RECIPE_HINTS: Record<string, string> = {
  "recipe-action-digest": "Owners and tasks from this meeting",
  "recipe-standup-blockers": "Done · Doing · Blockers",
  "recipe-followup-email": "Email draft with next steps",
}

export interface EditorArtifactsProps {
  recipes: Recipe[]
  outputs: Record<string, string>
  activeId: string | null
  onActiveChange: (id: string | null) => void
  runningId: string | null
  onRun: (recipe: Recipe) => void
  /** Persist checklist toggles (e.g. action digest markdown). */
  onUpdateOutput?: (recipeId: string, markdown: string) => void
  /** Note has enough content to run recipes. */
  canRun: boolean
  className?: string
}

/**
 * Post-note appendix for Action digest / Standup / Follow-up.
 * Parent only mounts this when something has been generated or is running —
 * never as empty chrome above the writing surface.
 */
export function EditorArtifacts({
  recipes,
  outputs,
  activeId,
  onActiveChange,
  runningId,
  onRun,
  onUpdateOutput,
  canRun,
  className,
}: EditorArtifactsProps) {
  const artifacts = useMemo(() => {
    const byId = new Map(recipes.map((r) => [r.id, r]))
    return ARTIFACT_RECIPE_IDS.map((id) => byId.get(id)).filter((r): r is Recipe => Boolean(r))
  }, [recipes])

  // Prefer artifacts that already have output (or are running).
  const visible = useMemo(
    () =>
      artifacts.filter(
        (r) => outputs[r.id]?.trim() || runningId === r.id,
      ),
    [artifacts, outputs, runningId],
  )

  if (visible.length === 0) return null

  const active = activeId ? visible.find((r) => r.id === activeId) : null
  const activeOut = active ? outputs[active.id] : undefined

  return (
    <section
      className={cn("editor-artifacts", className)}
      aria-label="Generated artifacts"
    >
      <div className="editor-artifacts-head">
        <p className="text-[11px] font-medium text-muted-foreground">
          Generated
        </p>
        <p className="text-[11px] text-muted-foreground/70">
          From ⋯ · Recipes, or Enhance
        </p>
      </div>

      <div className="editor-artifacts-tabs" role="tablist" aria-label="Artifact type">
        {visible.map((recipe) => {
          const ready = Boolean(outputs[recipe.id]?.trim())
          const running = runningId === recipe.id
          const selected = activeId === recipe.id
          const Icon = RECIPE_ICONS[recipe.id] ?? CheckListIcon
          return (
            <button
              key={recipe.id}
              type="button"
              role="tab"
              aria-selected={selected}
              className={cn(
                "editor-artifacts-tab",
                selected && "editor-artifacts-tab--active",
                ready && "editor-artifacts-tab--ready",
              )}
              onClick={() => onActiveChange(selected ? null : recipe.id)}
            >
              <HugeiconsIcon icon={Icon} strokeWidth={1.8} className="size-3.5 shrink-0" />
              <span className="truncate">{recipe.name}</span>
              {running && (
                <span className="size-2.5 animate-spin rounded-full border-2 border-brand/30 border-t-brand" />
              )}
              {ready && !running && (
                <span className="size-1.5 shrink-0 rounded-full bg-emerald-500/80" aria-label="Ready" />
              )}
            </button>
          )
        })}
      </div>

      {active && (
        <div className="editor-artifacts-panel" role="tabpanel">
          <div className="flex items-center justify-between gap-2 px-3 py-2">
            <p className="min-w-0 truncate text-[12px] text-muted-foreground">
              {RECIPE_HINTS[active.id] ?? active.name}
            </p>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 shrink-0 gap-1 text-muted-foreground"
              disabled={!canRun || runningId === active.id}
              onClick={() => onRun(active)}
            >
              <HugeiconsIcon
                icon={RefreshIcon}
                strokeWidth={2}
                className={cn("size-3.5", runningId === active.id && "animate-spin")}
              />
              {activeOut ? "Regenerate" : "Generate"}
            </Button>
          </div>

          {runningId === active.id && !activeOut ? (
            <div className="flex items-center gap-2 px-3 py-6 text-[12px] text-muted-foreground">
              <span className="size-3.5 animate-spin rounded-full border-2 border-brand/30 border-t-brand" />
              Generating {active.name.toLowerCase()}…
            </div>
          ) : activeOut ? (
            <div className="editor-artifacts-body">
              {active.id === "recipe-action-digest" &&
              parseChecklistMarkdown(activeOut).some((l) => l.kind === "item") ? (
                <ChecklistView
                  markdown={activeOut}
                  onChange={
                    onUpdateOutput
                      ? (next) => onUpdateOutput(active.id, next)
                      : undefined
                  }
                />
              ) : (
                <MarkdownView markdown={activeOut} proseClassName="mdx-brief" />
              )}
            </div>
          ) : null}
        </div>
      )}
    </section>
  )
}

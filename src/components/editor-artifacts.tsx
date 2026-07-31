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
 * First-class home for Action digest, Standup blockers, Follow-up email.
 * Reachable above the note body — not only under ⋯ → Recipes.
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

  if (artifacts.length === 0) return null

  const active = activeId ? artifacts.find((r) => r.id === activeId) : null
  const activeOut = active ? outputs[active.id] : undefined
  const hasAnyOutput = artifacts.some((r) => outputs[r.id]?.trim())

  return (
    <section
      className={cn("editor-artifacts", className)}
      aria-label="Meeting artifacts"
    >
      <div className="editor-artifacts-head">
        <p className="text-[11px] font-medium uppercase tracking-[0.05em] text-muted-foreground">
          Artifacts
        </p>
        {!hasAnyOutput && canRun && (
          <p className="text-[11px] text-muted-foreground/80">
            Run after the meeting — or after Enhance
          </p>
        )}
      </div>

      <div className="editor-artifacts-tabs" role="tablist" aria-label="Artifact type">
        {artifacts.map((recipe) => {
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
          <div className="flex items-center justify-between gap-2 border-b border-border/40 px-3 py-2">
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
          ) : (
            <div className="flex flex-col items-start gap-2 px-3 py-5">
              <p className="text-[12px] text-muted-foreground">
                {canRun
                  ? `Generate a ${active.name.toLowerCase()} from this note’s transcript.`
                  : "Add notes or record first, then generate."}
              </p>
              {canRun && (
                <Button
                  size="sm"
                  className="h-8 rounded-xl"
                  disabled={runningId === active.id}
                  onClick={() => onRun(active)}
                >
                  Generate {active.name.toLowerCase()}
                </Button>
              )}
            </div>
          )}
        </div>
      )}

      {/* When nothing selected: one-row quick actions so digests stay one click away */}
      {!active && canRun && (
        <div className="editor-artifacts-quick">
          {artifacts.map((recipe) => {
            const ready = Boolean(outputs[recipe.id]?.trim())
            if (ready) return null
            return (
              <Button
                key={recipe.id}
                variant="outline"
                size="sm"
                className="h-7 rounded-xl text-[12px]"
                disabled={runningId === recipe.id || !canRun}
                onClick={() => {
                  onActiveChange(recipe.id)
                  onRun(recipe)
                }}
              >
                {runningId === recipe.id ? "Running…" : recipe.name}
              </Button>
            )
          })}
        </div>
      )}
    </section>
  )
}

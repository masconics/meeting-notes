import { useState, useCallback, useMemo } from "react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { HugeiconsIcon } from "@hugeicons/react"
import {
  UserSearchIcon,
  UserIcon,
  Comment01Icon,
  PresentationIcon,
  DashboardCircleIcon,
  CheckmarkBadge01Icon,
  BrainIcon,
  Target01Icon,
  RocketIcon,
  Calendar01Icon,
  ChartIcon,
  Building01Icon,
  File01Icon,
  Edit01Icon,
  NoteIcon,
  StarIcon,
  BulbIcon,
  FlagIcon,
  Mail01Icon,
  DeleteIcon,
  NoteAddIcon,
  ArrowUp01Icon,
  ArrowDown01Icon,
  Copy01Icon,
  Add01Icon,
} from "@hugeicons/core-free-icons"
import type { IconSvgElement } from "@hugeicons/react"
import type { MeetingTemplate, QuickAction, WritingStyle } from "@/types"
import { WRITING_STYLES } from "@/types"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  getTemplates,
  saveTemplate,
  deleteTemplate,
  DEFAULT_TEMPLATES,
} from "@/lib/templates"
import { saveTemplates } from "@/lib/storage"
import { TemplateIcon } from "@/components/template-icon"
import { cn } from "@/lib/utils"

const ICON_OPTIONS: { name: string; icon: IconSvgElement }[] = [
  { name: "UserSearchIcon", icon: UserSearchIcon },
  { name: "UserIcon", icon: UserIcon },
  { name: "Comment01Icon", icon: Comment01Icon },
  { name: "PresentationIcon", icon: PresentationIcon },
  { name: "DashboardCircleIcon", icon: DashboardCircleIcon },
  { name: "CheckmarkBadge01Icon", icon: CheckmarkBadge01Icon },
  { name: "BrainIcon", icon: BrainIcon },
  { name: "Target01Icon", icon: Target01Icon },
  { name: "RocketIcon", icon: RocketIcon },
  { name: "Calendar01Icon", icon: Calendar01Icon },
  { name: "ChartIcon", icon: ChartIcon },
  { name: "Building01Icon", icon: Building01Icon },
  { name: "File01Icon", icon: File01Icon },
  { name: "Edit01Icon", icon: Edit01Icon },
  { name: "NoteIcon", icon: NoteIcon },
  { name: "StarIcon", icon: StarIcon },
  { name: "BulbIcon", icon: BulbIcon },
  { name: "FlagIcon", icon: FlagIcon },
  { name: "Mail01Icon", icon: Mail01Icon },
]

const DEFAULT_IDS = new Set(DEFAULT_TEMPLATES.map((t) => t.id))

function emptyQuickAction(): QuickAction {
  return { label: "", icon: "CheckmarkBadge01Icon", prompt: "" }
}

function emptyTemplate(): MeetingTemplate {
  return {
    id: crypto.randomUUID(),
    name: "",
    icon: "CheckmarkBadge01Icon",
    sections: [""],
    quickActions: [],
  }
}

/**
 * Settings → Templates list + editor.
 * Production settings pattern: dense rows, quiet chrome, clear edit dialog.
 */
export function TemplateEditor() {
  const [templates, setTemplates] = useState(() => getTemplates())
  const [query, setQuery] = useState("")
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<MeetingTemplate | null>(null)
  const [form, setForm] = useState<MeetingTemplate>(emptyTemplate())
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [showResetConfirm, setShowResetConfirm] = useState(false)
  const [previewId, setPreviewId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const refresh = useCallback(() => {
    setTemplates(getTemplates())
  }, [])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return templates
    return templates.filter(
      (t) =>
        t.name.toLowerCase().includes(q) ||
        t.sections.some((s) => s.toLowerCase().includes(q)),
    )
  }, [templates, query])

  const builtinCount = templates.filter((t) => DEFAULT_IDS.has(t.id)).length
  const customCount = templates.length - builtinCount

  function openCreate() {
    setEditing(null)
    setForm(emptyTemplate())
    setDialogOpen(true)
  }

  function openEdit(template: MeetingTemplate) {
    setEditing(template)
    setForm({
      ...template,
      sections: [...template.sections],
      quickActions: template.quickActions.map((a) => ({ ...a })),
    })
    setDialogOpen(true)
  }

  function closeDialog() {
    setDialogOpen(false)
    setEditing(null)
  }

  function updateForm(patch: Partial<MeetingTemplate>) {
    setForm((f) => ({ ...f, ...patch }))
  }

  function updateSection(index: number, value: string) {
    setForm((f) => {
      const sections = [...f.sections]
      sections[index] = value
      return { ...f, sections }
    })
  }

  function addSection() {
    setForm((f) => ({ ...f, sections: [...f.sections, ""] }))
  }

  function removeSection(index: number) {
    setForm((f) => ({
      ...f,
      sections: f.sections.length <= 1 ? [""] : f.sections.filter((_, i) => i !== index),
    }))
  }

  function moveSection(from: number, to: number) {
    if (to < 0 || to >= form.sections.length) return
    setForm((f) => {
      const sections = [...f.sections]
      ;[sections[from], sections[to]] = [sections[to], sections[from]]
      return { ...f, sections }
    })
  }

  function updateQuickAction(index: number, patch: Partial<QuickAction>) {
    setForm((f) => {
      const quickActions = f.quickActions.map((a, i) =>
        i === index ? { ...a, ...patch } : a,
      )
      return { ...f, quickActions }
    })
  }

  function addQuickAction() {
    setForm((f) => ({
      ...f,
      quickActions: [...f.quickActions, emptyQuickAction()],
    }))
  }

  function removeQuickAction(index: number) {
    setForm((f) => ({
      ...f,
      quickActions: f.quickActions.filter((_, i) => i !== index),
    }))
  }

  function handleSave() {
    if (!form.name.trim() || saving) return
    setSaving(true)
    const id = editing ? editing.id : crypto.randomUUID()
    saveTemplate({
      ...form,
      id,
      sections: form.sections.map((s) => s.trim()).filter(Boolean),
      quickActions: form.quickActions.filter((a) => a.label.trim()),
    })
    closeDialog()
    refresh()
    setSaving(false)
  }

  function handleDelete() {
    if (deleteId) {
      deleteTemplate(deleteId)
      setDeleteId(null)
      refresh()
    }
  }

  function handleResetDefaults() {
    const custom = templates.filter((t) => !DEFAULT_IDS.has(t.id))
    saveTemplates([...DEFAULT_TEMPLATES.map((t) => ({ ...t })), ...custom])
    setShowResetConfirm(false)
    refresh()
  }

  function handleDuplicate(template: MeetingTemplate) {
    const copy: MeetingTemplate = {
      ...template,
      id: crypto.randomUUID(),
      name: `${template.name} copy`,
      sections: [...template.sections],
      quickActions: template.quickActions.map((a) => ({ ...a })),
    }
    saveTemplate(copy)
    refresh()
    openEdit(copy)
  }

  return (
    <TooltipProvider delayDuration={280}>
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[13px] text-muted-foreground">
              <span className="tabular-nums text-foreground/90">{templates.length}</span>
              {" · "}
              <span className="tabular-nums">{builtinCount}</span> built-in
              {customCount > 0 && (
                <>
                  {" · "}
                  <span className="tabular-nums">{customCount}</span> custom
                </>
              )}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <AlertDialog open={showResetConfirm} onOpenChange={setShowResetConfirm}>
              <AlertDialogTrigger asChild>
                <Button variant="ghost" size="sm" className="h-8 text-muted-foreground">
                  Reset defaults
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent size="sm">
                <AlertDialogHeader>
                  <AlertDialogTitle>Reset built-in templates?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Restores original built-ins. Your custom templates stay.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction variant="destructive" onClick={handleResetDefaults}>
                    Reset
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
            <Button size="sm" className="h-8 rounded-xl" onClick={openCreate}>
              <HugeiconsIcon icon={NoteAddIcon} strokeWidth={2} data-icon="inline-start" className="size-3.5" />
              New
            </Button>
          </div>
        </div>

        {templates.length > 6 && (
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter templates…"
            className="h-8 text-[13px]"
            aria-label="Filter templates"
          />
        )}

        {templates.length === 0 ? (
          <div className="rounded-2xl bg-muted/30 px-4 py-8 text-center">
            <p className="text-[13px] font-medium">No templates</p>
            <p className="mt-1 text-[12px] text-muted-foreground">
              Create one or reset defaults.
            </p>
            <Button size="sm" className="mt-3 h-8" onClick={openCreate}>
              New template
            </Button>
          </div>
        ) : filtered.length === 0 ? (
          <p className="py-6 text-center text-[13px] text-muted-foreground">
            No matches for “{query.trim()}”
          </p>
        ) : (
          <ul className="flex flex-col gap-0.5" aria-label="Templates">
            {filtered.map((t) => {
              const isBuiltin = DEFAULT_IDS.has(t.id)
              const open = previewId === t.id
              return (
                <li key={t.id}>
                  <div
                    className={cn(
                      "group rounded-xl transition-colors",
                      open ? "bg-muted/60" : "hover:bg-muted/40",
                    )}
                  >
                    <div className="flex min-h-11 items-center gap-2.5 px-2 py-1.5">
                      <button
                        type="button"
                        className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
                        onClick={() => openEdit(t)}
                      >
                        <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg bg-background ring-1 ring-border/50">
                          <TemplateIcon name={t.icon} className="size-4" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center gap-1.5">
                            <span className="truncate text-[13px] font-medium">{t.name}</span>
                            {isBuiltin && (
                              <Badge variant="secondary" className="h-5 shrink-0 px-1.5 text-[10px]">
                                Built-in
                              </Badge>
                            )}
                          </span>
                          <span className="block truncate text-[11px] text-muted-foreground">
                            {t.sections.length} section{t.sections.length === 1 ? "" : "s"}
                            {t.quickActions.length > 0 &&
                              ` · ${t.quickActions.length} action${t.quickActions.length === 1 ? "" : "s"}`}
                          </span>
                        </span>
                      </button>

                      <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              className="size-7"
                              onClick={() => openEdit(t)}
                              aria-label={`Edit ${t.name}`}
                            >
                              <HugeiconsIcon icon={Edit01Icon} strokeWidth={2} className="size-3.5" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>Edit</TooltipContent>
                        </Tooltip>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              className="size-7 text-muted-foreground"
                              onClick={() => handleDuplicate(t)}
                              aria-label={`Duplicate ${t.name}`}
                            >
                              <HugeiconsIcon icon={Copy01Icon} strokeWidth={2} className="size-3.5" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>Duplicate</TooltipContent>
                        </Tooltip>
                        {!isBuiltin && (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon-sm"
                                className="size-7 text-muted-foreground hover:text-destructive"
                                onClick={() => setDeleteId(t.id)}
                                aria-label={`Delete ${t.name}`}
                              >
                                <HugeiconsIcon icon={DeleteIcon} strokeWidth={2} className="size-3.5" />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>Delete</TooltipContent>
                          </Tooltip>
                        )}
                      </div>
                    </div>

                    {t.sections.length > 0 && (
                      <button
                        type="button"
                        className="w-full px-2 pb-2 pl-[3.25rem] text-left text-[11px] text-muted-foreground/80 transition-colors hover:text-foreground"
                        onClick={() => setPreviewId(open ? null : t.id)}
                      >
                        {open ? "Hide sections" : "Show sections"}
                      </button>
                    )}
                    {open && (
                      <ul className="flex flex-wrap gap-1 px-2 pb-2.5 pl-[3.25rem]">
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

      {/* Editor dialog */}
      <Dialog open={dialogOpen} onOpenChange={(o) => { if (!o) closeDialog() }}>
        <DialogContent
          className="flex max-h-[min(85vh,40rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-lg"
          showCloseButton
        >
          <DialogHeader className="shrink-0 border-b border-border/50 px-5 py-4">
            <DialogTitle className="text-[15px] font-medium tracking-tight">
              {editing ? "Edit template" : "New template"}
            </DialogTitle>
            <DialogDescription className="text-[13px]">
              Sections shape enhanced notes. Quick actions are optional AI prompts.
            </DialogDescription>
          </DialogHeader>

          <div className="scroll-fade min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-4">
            {editing && DEFAULT_IDS.has(editing.id) && (
              <p className="rounded-xl bg-amber-500/8 px-3 py-2 text-[12px] text-amber-700 dark:text-amber-400">
                Built-in — edits stay as a customized version. Reset defaults restores the original.
              </p>
            )}

            <div className="flex flex-col gap-1.5">
              <label htmlFor="tpl-name" className="text-[12px] font-medium">
                Name
              </label>
              <Input
                id="tpl-name"
                value={form.name}
                onChange={(e) => updateForm({ name: e.target.value })}
                placeholder="Sprint retrospective"
                className="h-9 text-[13px]"
                autoFocus
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <span className="text-[12px] font-medium">Icon</span>
              <div className="flex flex-wrap gap-1">
                {ICON_OPTIONS.map(({ name, icon }) => (
                  <button
                    key={name}
                    type="button"
                    aria-label={name}
                    aria-pressed={form.icon === name}
                    className={cn(
                      "inline-flex size-9 items-center justify-center rounded-xl transition-colors",
                      form.icon === name
                        ? "bg-muted text-foreground shadow-sm ring-1 ring-border/70"
                        : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                    )}
                    onClick={() => updateForm({ icon: name })}
                  >
                    <HugeiconsIcon icon={icon} strokeWidth={2} className="size-4" />
                  </button>
                ))}
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-[12px] font-medium">Writing style</label>
              <Select
                value={form.style ?? "default"}
                onValueChange={(v) => updateForm({ style: v as WritingStyle })}
              >
                <SelectTrigger className="h-9 text-[13px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {Object.entries(WRITING_STYLES).map(([id, s]) => (
                      <SelectItem key={id} value={id}>
                        {s.label}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between gap-2">
                <label className="text-[12px] font-medium">Sections</label>
                <Button variant="ghost" size="sm" className="h-7 text-[12px]" onClick={addSection}>
                  <HugeiconsIcon icon={Add01Icon} strokeWidth={2} data-icon="inline-start" className="size-3.5" />
                  Add
                </Button>
              </div>
              <div className="flex flex-col gap-1">
                {form.sections.map((section, i) => (
                  <div key={i} className="flex items-center gap-1">
                    <div className="flex shrink-0 flex-col">
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        disabled={i === 0}
                        className="size-6 text-muted-foreground"
                        onClick={() => moveSection(i, i - 1)}
                        aria-label="Move up"
                      >
                        <HugeiconsIcon icon={ArrowUp01Icon} strokeWidth={2} className="size-3" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        disabled={i === form.sections.length - 1}
                        className="size-6 text-muted-foreground"
                        onClick={() => moveSection(i, i + 1)}
                        aria-label="Move down"
                      >
                        <HugeiconsIcon icon={ArrowDown01Icon} strokeWidth={2} className="size-3" />
                      </Button>
                    </div>
                    <Input
                      value={section}
                      onChange={(e) => updateSection(i, e.target.value)}
                      placeholder={`Section ${i + 1}`}
                      className="h-8 flex-1 text-[13px]"
                    />
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      className="size-7 shrink-0 text-muted-foreground hover:text-destructive"
                      onClick={() => removeSection(i)}
                      aria-label="Remove section"
                    >
                      <HugeiconsIcon icon={DeleteIcon} strokeWidth={2} className="size-3.5" />
                    </Button>
                  </div>
                ))}
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between gap-2">
                <label className="text-[12px] font-medium">Quick actions</label>
                <Button variant="ghost" size="sm" className="h-7 text-[12px]" onClick={addQuickAction}>
                  <HugeiconsIcon icon={Add01Icon} strokeWidth={2} data-icon="inline-start" className="size-3.5" />
                  Add
                </Button>
              </div>
              {form.quickActions.length === 0 ? (
                <p className="text-[12px] text-muted-foreground">
                  Optional — prompts you can run from the note after enhance.
                </p>
              ) : (
                <div className="flex flex-col gap-2">
                  {form.quickActions.map((action, i) => (
                    <div
                      key={i}
                      className="flex flex-col gap-1.5 rounded-xl bg-muted/40 p-2.5 ring-1 ring-border/50"
                    >
                      <div className="flex items-center gap-1.5">
                        <Input
                          value={action.label}
                          onChange={(e) => updateQuickAction(i, { label: e.target.value })}
                          placeholder="Label"
                          className="h-8 flex-1 text-[13px]"
                        />
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          className="size-7 shrink-0 text-muted-foreground hover:text-destructive"
                          onClick={() => removeQuickAction(i)}
                          aria-label="Remove action"
                        >
                          <HugeiconsIcon icon={DeleteIcon} strokeWidth={2} className="size-3.5" />
                        </Button>
                      </div>
                      <Textarea
                        value={action.prompt}
                        onChange={(e) => updateQuickAction(i, { prompt: e.target.value })}
                        placeholder="AI prompt for this action"
                        rows={2}
                        className="min-h-[3rem] resize-y bg-background text-[12px] leading-relaxed"
                      />
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <DialogFooter className="shrink-0 border-t border-border/50 px-5 py-3">
            <Button variant="ghost" onClick={closeDialog} className="h-8">
              Cancel
            </Button>
            <Button
              onClick={handleSave}
              disabled={!form.name.trim() || saving}
              className="h-8 rounded-xl active:scale-[0.96]"
            >
              {editing ? "Save" : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={!!deleteId}
        onOpenChange={(open) => {
          if (!open) setDeleteId(null)
        }}
      >
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete template?</AlertDialogTitle>
            <AlertDialogDescription>
              This custom template will be removed. Notes that used it keep their content.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={handleDelete}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </TooltipProvider>
  )
}

import { useState, useCallback } from "react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
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
  ArrowRight01Icon,
  Copy01Icon,
} from "@hugeicons/core-free-icons"
import type { IconSvgElement } from "@hugeicons/react"
import type { MeetingTemplate, QuickAction } from "@/types"
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

export function TemplateEditor() {
  const [templates, setTemplates] = useState(() => getTemplates())
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<MeetingTemplate | null>(null)
  const [form, setForm] = useState<MeetingTemplate>(emptyTemplate())
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [showResetConfirm, setShowResetConfirm] = useState(false)
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())

  const refresh = useCallback(() => {
    setTemplates(getTemplates())
  }, [])

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
      sections: f.sections.filter((_, i) => i !== index),
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

  function toggleExpand(id: string) {
    setExpandedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

  function updateQuickAction(index: number, patch: Partial<QuickAction>) {
    setForm((f) => {
      const quickActions = f.quickActions.map((a, i) =>
        i === index ? { ...a, ...patch } : a
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
    if (!form.name.trim()) return
    const id = editing ? editing.id : crypto.randomUUID()
    saveTemplate({
      ...form,
      id,
      sections: form.sections.filter((s) => s.trim()),
      quickActions: form.quickActions.filter((a) => a.label.trim()),
    })
    closeDialog()
    refresh()
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
      name: `Copy of ${template.name}`,
      sections: [...template.sections],
      quickActions: template.quickActions.map((a) => ({ ...a })),
    }
    saveTemplate(copy)
    refresh()
  }

  const inputClass =
    "h-8 w-full min-w-0 rounded-2xl border border-transparent bg-input/50 px-2.5 py-1 text-sm transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30"

  return (
    <>
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-medium">Templates</h3>
            <p className="text-xs text-muted-foreground">
              {templates.length} template{templates.length !== 1 ? "s" : ""}
              {" — "}
              {templates.filter((t) => DEFAULT_IDS.has(t.id)).length} built-in,{" "}
              {templates.filter((t) => !DEFAULT_IDS.has(t.id)).length} custom
            </p>
          </div>
          <div className="flex gap-2">
            <AlertDialog
              open={showResetConfirm}
              onOpenChange={setShowResetConfirm}
            >
              <AlertDialogTrigger asChild>
                <Button variant="outline" size="sm">
                  Reset defaults
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent size="sm">
                <AlertDialogHeader>
                  <AlertDialogTitle>Reset default templates?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This will restore all built-in templates to their original
                    state. Custom templates will not be affected.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    variant="destructive"
                    onClick={handleResetDefaults}
                  >
                    Reset
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
            <Button size="sm" onClick={openCreate}>
              <HugeiconsIcon
                icon={NoteAddIcon}
                strokeWidth={2}
                data-icon="inline-start"
              />
              New Template
            </Button>
          </div>
        </div>

        {templates.length === 0 && (
          <p className="text-sm text-muted-foreground py-4 text-center">
            No templates yet. Create one or reset to defaults.
          </p>
        )}

        <div className="flex flex-col gap-2">
          {templates.map((t) => {
            const isExpanded = expandedIds.has(t.id)
            return (
              <div key={t.id}>
                <div
                  className="flex items-center gap-3 rounded-2xl border p-3 cursor-pointer"
                  onClick={() => toggleExpand(t.id)}
                >
                  <TemplateIcon name={t.icon} className="size-5" />
                  <div className="flex flex-col gap-0.5 min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">{t.name}</span>
                      {DEFAULT_IDS.has(t.id) && (
                        <Badge variant="secondary" className="text-[10px] py-0">
                          Built-in
                        </Badge>
                      )}
                    </div>
                    <span className="text-xs text-muted-foreground">
                      {t.sections.length} sections &middot; {t.quickActions.length}{" "}
                      quick actions
                    </span>
                  </div>
                  <div className="flex gap-1 shrink-0">
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={(e) => { e.stopPropagation(); openEdit(t) }}
                    >
                      <HugeiconsIcon icon={Edit01Icon} strokeWidth={2} />
                    </Button>
                    {DEFAULT_IDS.has(t.id) && (
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        className="text-muted-foreground"
                        onClick={(e) => { e.stopPropagation(); handleDuplicate(t) }}
                        title="Duplicate"
                      >
                        <HugeiconsIcon icon={Copy01Icon} strokeWidth={2} />
                      </Button>
                    )}
                    {!DEFAULT_IDS.has(t.id) && (
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        className="text-destructive hover:text-destructive"
                        onClick={(e) => { e.stopPropagation(); setDeleteId(t.id) }}
                      >
                        <HugeiconsIcon icon={DeleteIcon} strokeWidth={2} />
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      className="text-muted-foreground"
                      onClick={(e) => { e.stopPropagation(); toggleExpand(t.id) }}
                    >
                      <HugeiconsIcon
                        icon={isExpanded ? ArrowDown01Icon : ArrowRight01Icon}
                        strokeWidth={2}
                        className="size-4"
                      />
                    </Button>
                  </div>
                </div>
                {isExpanded && (
                  <div className="ml-[52px] border-l-2 border-muted pl-4 py-1 space-y-0.5">
                    {t.sections.map((section, i) => (
                      <div key={i} className="text-xs text-muted-foreground">
                        {section}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>

      <Dialog open={dialogOpen} onOpenChange={(o) => { if (!o) closeDialog() }}>
        <DialogContent
          className="sm:max-w-lg max-h-[85vh] overflow-y-auto"
          showCloseButton
        >
          <DialogHeader>
            <DialogTitle>
              {editing ? "Edit Template" : "New Template"}
            </DialogTitle>
            <DialogDescription>
              {editing
                ? "Modify this template's name, sections, and quick actions."
                : "Create a custom meeting template with sections and quick actions."}
            </DialogDescription>
          </DialogHeader>

          {editing && DEFAULT_IDS.has(editing.id) && (
            <div className="flex items-start gap-2 rounded-2xl border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-amber-600 dark:text-amber-400 text-xs">
              <svg className="size-4 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
              </svg>
              <span>Editing a built-in template will create a custom version. Reset defaults to restore the original.</span>
            </div>
          )}

          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium">Template Name</label>
              <input
                type="text"
                value={form.name}
                onChange={(e) => updateForm({ name: e.target.value })}
                placeholder="e.g. Sprint Retrospective"
                className={inputClass}
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium">Icon</label>
              <div className="grid grid-cols-5 gap-1.5">
                {ICON_OPTIONS.map(({ name, icon }) => (
                  <button
                    key={name}
                    type="button"
                    className={cn(
                      "size-11 inline-flex items-center justify-center rounded-xl border transition-colors cursor-pointer",
                      form.icon === name
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border hover:bg-muted text-muted-foreground"
                    )}
                    onClick={() => updateForm({ icon: name })}
                  >
                    <HugeiconsIcon
                      icon={icon}
                      strokeWidth={2}
                      className="size-5"
                    />
                  </button>
                ))}
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <label className="text-xs font-medium">Sections</label>
                <Button variant="outline" size="xs" onClick={addSection}>
                  <HugeiconsIcon
                    icon={NoteAddIcon}
                    strokeWidth={2}
                    data-icon="inline-start"
                  />
                  Add
                </Button>
              </div>
              <div className="flex flex-col gap-1.5">
                {form.sections.map((section, i) => (
                  <div key={i} className="flex items-center gap-1.5">
                    <div className="flex flex-col gap-0.5 shrink-0">
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        disabled={i === 0}
                        className="text-muted-foreground hover:text-foreground"
                        onClick={() => moveSection(i, i - 1)}
                      >
                        <HugeiconsIcon icon={ArrowUp01Icon} strokeWidth={2} />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        disabled={i === form.sections.length - 1}
                        className="text-muted-foreground hover:text-foreground"
                        onClick={() => moveSection(i, i + 1)}
                      >
                        <HugeiconsIcon icon={ArrowDown01Icon} strokeWidth={2} />
                      </Button>
                    </div>
                    <input
                      type="text"
                      value={section}
                      onChange={(e) => updateSection(i, e.target.value)}
                      placeholder={`Section ${i + 1}`}
                      className={inputClass}
                    />
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      className="text-muted-foreground hover:text-destructive shrink-0"
                      onClick={() => removeSection(i)}
                    >
                      <HugeiconsIcon icon={DeleteIcon} strokeWidth={2} />
                    </Button>
                  </div>
                ))}
                {form.sections.length === 0 && (
                  <p className="text-xs text-muted-foreground py-1">
                    No sections. Add one to get started.
                  </p>
                )}
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <label className="text-xs font-medium">Quick Actions</label>
                <Button variant="outline" size="xs" onClick={addQuickAction}>
                  <HugeiconsIcon
                    icon={NoteAddIcon}
                    strokeWidth={2}
                    data-icon="inline-start"
                  />
                  Add
                </Button>
              </div>
              <div className="flex flex-col gap-2">
                {form.quickActions.map((action, i) => (
                  <div
                    key={i}
                    className="flex flex-col gap-1.5 rounded-2xl border p-3"
                  >
                    <div className="flex items-center gap-1.5">
                      <input
                        type="text"
                        value={action.label}
                        onChange={(e) =>
                          updateQuickAction(i, { label: e.target.value })
                        }
                        placeholder="Action label"
                        className={inputClass}
                      />
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        className="text-muted-foreground hover:text-destructive shrink-0"
                        onClick={() => removeQuickAction(i)}
                      >
                        <HugeiconsIcon icon={DeleteIcon} strokeWidth={2} />
                      </Button>
                    </div>
                    <input
                      type="text"
                      value={action.prompt}
                      onChange={(e) =>
                        updateQuickAction(i, { prompt: e.target.value })
                      }
                      placeholder="AI prompt for this action"
                      className={cn(inputClass, "text-xs")}
                    />
                  </div>
                ))}
                {form.quickActions.length === 0 && (
                  <p className="text-xs text-muted-foreground py-1">
                    No quick actions. Add one to get started.
                  </p>
                )}
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={closeDialog}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={!form.name.trim()}>
              {editing ? "Save Changes" : "Create Template"}
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
              This will permanently delete this custom template. This action
              cannot be undone.
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
    </>
  )
}

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Badge } from "@/components/ui/badge"
import { HugeiconsIcon } from "@hugeicons/react"
import { CheckmarkBadge01Icon } from "@hugeicons/core-free-icons"
import { motion } from "framer-motion"
import type { MeetingTemplate } from "@/types"
import { getTemplates } from "@/lib/templates"
import { TemplateIcon } from "@/components/template-icon"

interface MeetingTemplateSelectorProps {
  selectedId?: string
  onSelect: (template: MeetingTemplate | undefined) => void
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function MeetingTemplateSelector({
  selectedId,
  onSelect,
  open,
  onOpenChange,
}: MeetingTemplateSelectorProps) {
  const templates = getTemplates()

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>Meeting Template</DialogTitle>
          <DialogDescription>
            Choose a template to structure your notes. Templates help AI organize information into sections.
          </DialogDescription>
        </DialogHeader>
        <motion.div
          className="flex flex-col gap-2 max-h-72 overflow-y-auto"
          initial="hidden"
          animate="show"
          variants={{ show: { transition: { staggerChildren: 0.05 } } }}
        >
          <motion.div
            initial={{ opacity: 0, x: -8 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.2 }}
          >
          <button
            className="flex items-center gap-3 rounded-2xl border p-3 text-left transition-colors hover:bg-muted/50 w-full"
            onClick={() => {
              onSelect(undefined)
              onOpenChange(false)
            }}
          >
            <div className="size-10 shrink-0 rounded-full bg-muted inline-flex items-center justify-center">
              <HugeiconsIcon icon={CheckmarkBadge01Icon} strokeWidth={2} className="size-5 text-muted-foreground" />
            </div>
            <div className="flex flex-col gap-0.5 min-w-0">
              <span className="text-sm font-medium">No Template</span>
              <span className="text-xs text-muted-foreground">Free-form notes without sections</span>
            </div>
          </button>
          </motion.div>
          {templates.map((t, idx) => {
            const isSelected = t.id === selectedId
            return (
              <motion.div
                key={t.id}
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.2, delay: 0.05 * idx }}
              >
              <button
                key={t.id}
                className={`flex items-center gap-3 rounded-2xl border p-3 text-left transition-colors hover:bg-muted/50 ${isSelected ? "border-primary bg-primary/5 ring-1 ring-primary/20" : ""}`}
                onClick={() => {
                  onSelect(t)
                  onOpenChange(false)
                }}
              >
                <TemplateIcon name={t.icon} className="size-5" />
                <div className="flex flex-col gap-0.5 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">{t.name}</span>
                    {isSelected && <Badge variant="secondary" className="text-[10px] py-0">Selected</Badge>}
                  </div>
                  <span className="text-xs text-muted-foreground truncate">
                    {t.sections.length} sections &middot; {t.sections.slice(0, 3).join(", ") + (t.sections.length > 3 ? "..." : "")}
                  </span>
                </div>
              </button>
              </motion.div>
            )
          })}
        </motion.div>
      </DialogContent>
    </Dialog>
  )
}

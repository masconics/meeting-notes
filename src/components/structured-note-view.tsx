import { useState } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { Textarea } from "@/components/ui/textarea"
import { MarkdownView } from "@/components/markdown-view"
import { HugeiconsIcon } from "@hugeicons/react"
import { ArrowLeft01Icon } from "@hugeicons/core-free-icons"
import type { MeetingSection } from "@/types"
import { cn } from "@/lib/utils"

interface StructuredNoteViewProps {
  sections: MeetingSection[]
  editable?: boolean
  onChange?: (sections: MeetingSection[]) => void
  className?: string
}

export function StructuredNoteView({
  sections,
  editable = false,
  onChange,
  className,
}: StructuredNoteViewProps) {
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set())

  const toggleSection = (idx: number) => {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(idx)) {
        next.delete(idx)
      } else {
        next.add(idx)
      }
      return next
    })
  }

  const updateSection = (idx: number, content: string) => {
    if (!onChange) return
    const updated = [...sections]
    updated[idx] = { ...updated[idx], content }
    onChange(updated)
  }

  return (
    <div className={cn("flex flex-col gap-3", className)}>
      {sections.map((section, idx) => (
        <div key={idx} className="flex flex-col gap-1">
          <button
            className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1 hover:text-foreground transition-colors"
            onClick={() => toggleSection(idx)}
          >
            <HugeiconsIcon
              icon={ArrowLeft01Icon}
              strokeWidth={2}
              className={cn("size-3 shrink-0 transition-transform", collapsed.has(idx) ? "-rotate-90" : "rotate-0")}
            />
            {section.title}
          </button>
          <AnimatePresence initial={false}>
          {!collapsed.has(idx) && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2, ease: "easeInOut" }}
              className="overflow-hidden"
            >
            {editable ? (
              <Textarea
                value={section.content}
                onChange={(e) => updateSection(idx, e.target.value)}
                className="min-h-20 text-sm"
              />
            ) : (
              <MarkdownView
                markdown={section.content}
                className="text-sm bg-muted/60 rounded-2xl p-3"
              />
            )}
            </motion.div>
          )}
          </AnimatePresence>
        </div>
      ))}
    </div>
  )
}

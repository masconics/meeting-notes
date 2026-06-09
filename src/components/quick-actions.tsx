import { useState, useCallback } from "react"
import { Button } from "@/components/ui/button"
import { HugeiconsIcon } from "@hugeicons/react"
import { motion } from "framer-motion"
import type { IconSvgElement } from "@hugeicons/react"
import {
  Mail01Icon,
  Task01Icon,
  DollarCircleIcon,
  AlertCircleIcon,
  NoteIcon,
  ArrowRight01Icon,
  AiMagicIcon,
  Cancel01Icon,
  Copy01Icon,
} from "@hugeicons/core-free-icons"
import { executeQuickAction } from "@/lib/ai-service"
import { MarkdownView } from "@/components/markdown-view"
import { getTemplateById } from "@/lib/templates"
import type { Meeting, QuickAction } from "@/types"

const QUICK_ACTIONS: QuickAction[] = [
  { label: "Write follow-up email", icon: "Mail01Icon", prompt: "Write a concise, professional follow-up email based on this meeting. Use markdown formatting." },
  { label: "List action items", icon: "Task01Icon", prompt: "List all action items, to-dos, and commitments made during this meeting. Include owners if mentioned. Use markdown bullet points." },
  { label: "What's their budget?", icon: "DollarCircleIcon", prompt: "What budget, pricing, or financial information was discussed? Use markdown with bullet points and bold for key numbers." },
  { label: "List objections", icon: "AlertCircleIcon", prompt: "What objections, concerns, or risks were raised during this meeting? Use markdown bullet points with bold for key concerns." },
  { label: "Summarize decisions", icon: "NoteIcon", prompt: "Summarize key decisions and conclusions from this meeting. Use markdown with headings and bullet points." },
  { label: "Generate next steps", icon: "ArrowRight01Icon", prompt: "Based on this meeting, what should the next steps be? Use markdown — numbered list with bold for action owners." },
]

const ICON_MAP: Record<string, IconSvgElement> = {
  Mail01Icon,
  Task01Icon,
  DollarCircleIcon,
  AlertCircleIcon,
  NoteIcon,
  ArrowRight01Icon,
}

interface ActionResult {
  id: string
  label: string
  content: string
}

interface QuickActionsProps {
  meeting: Meeting
  allMeetings?: Meeting[]
  onInsertToNotes?: (content: string) => void
}

export function QuickActions({ meeting, allMeetings, onInsertToNotes }: QuickActionsProps) {
  const [loading, setLoading] = useState<string | null>(null)
  const [results, setResults] = useState<ActionResult[]>([])
  const [error, setError] = useState<string | null>(null)
  const [copiedId, setCopiedId] = useState<string | null>(null)

  const actions = meeting.templateId
    ? (getTemplateById(meeting.templateId)?.quickActions ?? QUICK_ACTIONS)
    : QUICK_ACTIONS

  const handleAction = useCallback(async (action: QuickAction) => {
    setLoading(action.label)
    setError(null)
    try {
      const text = await executeQuickAction(
        meeting.transcript,
        meeting.notes,
        meeting.structuredNotes,
        action,
        meeting,
        allMeetings
      )
      setResults(prev => [...prev, { id: crypto.randomUUID(), label: action.label, content: text }])
    } catch (e) {
      setError(e instanceof Error ? e.message : "Action failed")
    } finally {
      setLoading(null)
    }
  }, [meeting, allMeetings])

  const handleDismiss = useCallback((id: string) => {
    setResults(prev => prev.filter(r => r.id !== id))
  }, [])

  const handleCopy = useCallback(async (id: string, content: string) => {
    await navigator.clipboard.writeText(content)
    setCopiedId(id)
    setTimeout(() => setCopiedId(null), 2000)
  }, [])

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        {actions.map((action) => {
          const Icon = ICON_MAP[action.icon]
          return (
            <motion.div key={action.label} whileTap={{ scale: 0.95 }} whileHover={{ scale: 1.02 }}>
            <Button
              key={action.label}
              variant="outline"
              size="sm"
              onClick={() => handleAction(action)}
              disabled={loading !== null}
            >
              {loading === action.label ? (
                <>
                  <div className="size-4 border-2 border-current border-t-transparent rounded-full animate-spin mr-1.5" />
                  Working...
                </>
              ) : (
                <>
                  {Icon && <HugeiconsIcon icon={Icon} strokeWidth={2} data-icon="inline-start" />}
                  {action.label}
                </>
              )}
            </Button>
            </motion.div>
          )
        })}
      </div>

      {results.map((r) => (
        <div key={r.id} className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <div className="text-xs font-medium text-primary flex items-center gap-1.5">
              <HugeiconsIcon icon={AiMagicIcon} strokeWidth={1.5} className="size-3.5" />
              {r.label}
            </div>
            <div className="flex gap-1">
              <Button variant="ghost" size="icon-sm" onClick={() => handleCopy(r.id, r.content)}>
                {copiedId === r.id ? (
                  <motion.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }}>
                    <span className="text-xs font-medium text-emerald-500">Copied</span>
                  </motion.div>
                ) : (
                  <HugeiconsIcon icon={Copy01Icon} strokeWidth={2} className="size-4" />
                )}
              </Button>
              {onInsertToNotes && (
                <Button variant="ghost" size="icon-sm" onClick={() => onInsertToNotes(r.content)} title="Insert into notes">
                  <HugeiconsIcon icon={NoteIcon} strokeWidth={2} className="size-4" />
                </Button>
              )}
              <Button variant="ghost" size="icon-sm" onClick={() => handleDismiss(r.id)}>
                <HugeiconsIcon icon={Cancel01Icon} strokeWidth={2} className="size-4" />
              </Button>
            </div>
          </div>
          <div className="bg-muted/60 rounded-2xl p-3 max-h-64 overflow-y-auto">
            <MarkdownView markdown={r.content} className="text-sm" />
          </div>
        </div>
      ))}

      {error && (
        <div className="text-destructive text-sm" role="alert">{error}</div>
      )}
    </div>
  )
}

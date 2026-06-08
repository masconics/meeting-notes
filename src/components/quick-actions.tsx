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

interface QuickActionsProps {
  meeting: Meeting
}

export function QuickActions({ meeting }: QuickActionsProps) {
  const [loading, setLoading] = useState<string | null>(null)
  const [result, setResult] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const actions = meeting.templateId
    ? (getTemplateById(meeting.templateId)?.quickActions ?? QUICK_ACTIONS)
    : QUICK_ACTIONS

  const handleAction = useCallback(async (action: QuickAction) => {
    setLoading(action.label)
    setError(null)
    setResult(null)
    try {
      const text = await executeQuickAction(
        meeting.transcript,
        meeting.notes,
        meeting.structuredNotes,
        action
      )
      setResult(text)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Action failed")
    } finally {
      setLoading(null)
    }
  }, [meeting])

  const handleCopy = useCallback(async () => {
    if (!result) return
    await navigator.clipboard.writeText(result)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }, [result])

  return (
    <div className="flex flex-col gap-3">
      {!result && (
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
      )}

      {result && (
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <div className="text-xs font-medium text-primary flex items-center gap-1.5">
              <HugeiconsIcon icon={AiMagicIcon} strokeWidth={1.5} className="size-3.5" />
              AI Response
            </div>
            <div className="flex gap-1">
              <Button variant="ghost" size="icon-sm" onClick={handleCopy}>
                {copied ? (
                  <motion.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }}>
                    <span className="text-xs font-medium text-emerald-500">Copied</span>
                  </motion.div>
                ) : (
                  <HugeiconsIcon icon={Copy01Icon} strokeWidth={2} className="size-4" />
                )}
              </Button>
              <Button variant="ghost" size="icon-sm" onClick={() => setResult(null)}>
                <HugeiconsIcon icon={Cancel01Icon} strokeWidth={2} className="size-4" />
              </Button>
            </div>
          </div>
          <div className="text-sm text-foreground bg-muted/60 rounded-2xl p-3 whitespace-pre-wrap max-h-64 overflow-y-auto">
            {result}
          </div>
        </div>
      )}

      {error && (
        <div className="text-destructive text-sm" role="alert">{error}</div>
      )}
    </div>
  )
}

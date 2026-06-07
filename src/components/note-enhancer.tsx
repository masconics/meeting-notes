import { useState, useCallback } from "react"
import { Button } from "@/components/ui/button"
import { HugeiconsIcon } from "@hugeicons/react"
import { AiMagicIcon, Cancel01Icon } from "@hugeicons/core-free-icons"
import { StructuredNoteView } from "@/components/structured-note-view"
import { enhanceNotes } from "@/lib/ai-service"
import { getTemplateById } from "@/lib/templates"
import type { Meeting, MeetingSection } from "@/types"

interface NoteEnhancerProps {
  meeting: Meeting
  onUpdate: (meeting: Meeting) => void
}

export function NoteEnhancer({ meeting, onUpdate }: NoteEnhancerProps) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [enhanced, setEnhanced] = useState<MeetingSection[] | null>(null)

  const handleEnhance = useCallback(async () => {
    if (!meeting.templateId) return
    const template = getTemplateById(meeting.templateId)
    if (!template) return

    setLoading(true)
    setError(null)
    try {
      const sections = await enhanceNotes(meeting.notes, meeting.transcript, template.sections)
      setEnhanced(sections)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to enhance notes")
    } finally {
      setLoading(false)
    }
  }, [meeting])

  const handleSave = useCallback(() => {
    if (!enhanced) return
    const sectionsContent = enhanced.map((s) => `## ${s.title}\n${s.content}`).join("\n\n")
    onUpdate({
      ...meeting,
      structuredNotes: enhanced,
      enhancedNotes: sectionsContent,
    })
    setEnhanced(null)
  }, [enhanced, meeting, onUpdate])

  const isEnhanced = !!meeting.structuredNotes?.length

  if (isEnhanced && meeting.structuredNotes) {
    return (
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <div className="text-xs font-medium text-muted-foreground">
            Structured Notes (AI Enhanced)
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleEnhance}
            disabled={loading}
          >
            {loading ? (
              <>
                <div className="size-4 border-2 border-current border-t-transparent rounded-full animate-spin mr-2" />
                Enhancing...
              </>
            ) : (
              <>
                <HugeiconsIcon icon={AiMagicIcon} strokeWidth={2} data-icon="inline-start" />
                Re-enhance
              </>
            )}
          </Button>
        </div>
        <StructuredNoteView
          sections={meeting.structuredNotes}
          editable
          onChange={(sections) =>
            onUpdate({ ...meeting, structuredNotes: sections })
          }
        />
      </div>
    )
  }

  if (enhanced) {
    return (
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <div className="text-xs font-medium text-primary flex items-center gap-1.5">
            <span className="size-1.5 rounded-full bg-emerald-500" />
            AI Enhanced Preview
          </div>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={() => setEnhanced(null)}>
              <HugeiconsIcon icon={Cancel01Icon} strokeWidth={2} data-icon="inline-start" />
              Discard
            </Button>
            <Button size="sm" onClick={handleSave}>
              <HugeiconsIcon icon={AiMagicIcon} strokeWidth={2} data-icon="inline-start" />
              Apply
            </Button>
          </div>
        </div>
        <StructuredNoteView sections={enhanced} />
      </div>
    )
  }

  if (!meeting.templateId) return null

  return (
    <div className="flex flex-col gap-2">
      <Button
        variant="outline"
        size="sm"
        onClick={handleEnhance}
        disabled={loading}
        className="self-start"
      >
        {loading ? (
          <>
            <div className="size-4 border-2 border-current border-t-transparent rounded-full animate-spin mr-2" />
            Enhancing...
          </>
        ) : (
          <>
            <HugeiconsIcon icon={AiMagicIcon} strokeWidth={2} data-icon="inline-start" />
            Enhance with AI
          </>
        )}
      </Button>
      {error && (
        <div className="text-destructive text-sm" role="alert">{error}</div>
      )}
    </div>
  )
}

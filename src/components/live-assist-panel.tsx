// Mid-call assist: "What did I miss?" + suggest questions. Floats above capture dock.

import { useCallback, useState } from "react"
import { Button } from "@/components/ui/button"
import { MarkdownView } from "@/components/markdown-view"
import { HugeiconsIcon } from "@hugeicons/react"
import {
  AlertCircleIcon,
  Cancel01Icon,
  FlashIcon,
  Idea01Icon,
  RefreshIcon,
} from "@hugeicons/core-free-icons"
import { sliceRecentTranscript, formatCatchUpHeading } from "@/lib/catch-up"
import { toast } from "@/components/ui/toaster"
import { cn } from "@/lib/utils"

interface LiveAssistPanelProps {
  transcript: string
  durationSecs: number
  open: boolean
  onClose: () => void
  className?: string
}

export function LiveAssistPanel({
  transcript,
  durationSecs,
  open,
  onClose,
  className,
}: LiveAssistPanelProps) {
  const [summary, setSummary] = useState<string | null>(null)
  const [questions, setQuestions] = useState<string[]>([])
  const [heading, setHeading] = useState("")
  const [busy, setBusy] = useState<"catchup" | "questions" | null>(null)
  const [error, setError] = useState<string | null>(null)

  const runCatchUp = useCallback(async () => {
    setBusy("catchup")
    setError(null)
    try {
      const { isAIConfigured, summarizeWhatDidIMiss } = await import("@/lib/ai-service")
      if (!isAIConfigured()) {
        setError("Configure AI in Settings to use catch-up.")
        return
      }
      const { text, windowSecs, approxFromSec } = sliceRecentTranscript(transcript, {
        durationSecs,
        windowSecs: 180,
      })
      if (!text.trim()) {
        setSummary("Still listening — no transcript yet.")
        setHeading(formatCatchUpHeading(windowSecs, approxFromSec))
        return
      }
      setHeading(formatCatchUpHeading(windowSecs, approxFromSec))
      const md = await summarizeWhatDidIMiss(text, { windowSecs })
      setSummary(md)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Catch-up failed")
    } finally {
      setBusy(null)
    }
  }, [transcript, durationSecs])

  const runQuestions = useCallback(async () => {
    setBusy("questions")
    setError(null)
    try {
      const { isAIConfigured, suggestLiveQuestions } = await import("@/lib/ai-service")
      if (!isAIConfigured()) {
        setError("Configure AI in Settings for live questions.")
        return
      }
      const { text } = sliceRecentTranscript(transcript, { durationSecs, windowSecs: 120 })
      const qs = await suggestLiveQuestions(text)
      setQuestions(qs)
      if (qs.length === 0) toast("No suggestions yet — keep talking a bit.")
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not suggest questions")
    } finally {
      setBusy(null)
    }
  }, [transcript, durationSecs])

  if (!open) return null

  return (
    <div
      className={cn(
        "pointer-events-auto absolute bottom-[calc(100%+10px)] left-1/2 z-30 w-[min(420px,92vw)] -translate-x-1/2 rounded-2xl border border-border/70 bg-background/95 p-3 shadow-xl backdrop-blur-md",
        className,
      )}
      role="dialog"
      aria-label="Live meeting assist"
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-sm font-medium">
          <span className="ai-mark" data-ai={busy ? "busy" : "active"}>
            <HugeiconsIcon icon={FlashIcon} strokeWidth={2} className="size-3.5 text-white" />
          </span>
          Live assist
        </div>
        <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Close live assist">
          <HugeiconsIcon icon={Cancel01Icon} strokeWidth={2} />
        </Button>
      </div>

      <div className="mb-2 flex flex-wrap gap-1.5">
        <Button
          size="sm"
          variant="secondary"
          className="h-8 gap-1.5 rounded-xl"
          disabled={busy !== null}
          onClick={() => void runCatchUp()}
        >
          {busy === "catchup" ? (
            <span className="size-3.5 animate-spin rounded-full border-2 border-brand/30 border-t-brand" />
          ) : (
            <HugeiconsIcon icon={RefreshIcon} strokeWidth={2} className="size-3.5" />
          )}
          What did I miss?
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="h-8 gap-1.5 rounded-xl"
          disabled={busy !== null}
          onClick={() => void runQuestions()}
        >
          {busy === "questions" ? (
            <span className="size-3.5 animate-spin rounded-full border-2 border-brand/30 border-t-brand" />
          ) : (
            <HugeiconsIcon icon={Idea01Icon} strokeWidth={2} className="size-3.5" />
          )}
          Suggest questions
        </Button>
      </div>

      {error && (
        <div className="mb-2 flex items-start gap-1.5 rounded-lg bg-destructive/10 px-2.5 py-2 text-xs text-destructive">
          <HugeiconsIcon icon={AlertCircleIcon} strokeWidth={2} className="mt-0.5 size-3.5 shrink-0" />
          {error}
        </div>
      )}

      {heading && summary && (
        <div className="mb-2 max-h-48 overflow-y-auto rounded-xl bg-muted/50 px-3 py-2">
          <p className="mb-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            {heading}
          </p>
          <MarkdownView markdown={summary} />
        </div>
      )}

      {questions.length > 0 && (
        <ul className="flex flex-col gap-1">
          {questions.map((q) => (
            <li key={q}>
              <button
                type="button"
                className="w-full rounded-lg border border-border/50 bg-card px-2.5 py-1.5 text-left text-xs transition-colors hover:border-primary/30 hover:bg-muted/40"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(q)
                    toast.success("Question copied")
                  } catch {
                    toast(q)
                  }
                }}
              >
                {q}
              </button>
            </li>
          ))}
        </ul>
      )}

      {!summary && questions.length === 0 && !error && !busy && (
        <p className="text-xs text-muted-foreground">
          Catch up on the last few minutes or get sharp questions without leaving the call.
        </p>
      )}
    </div>
  )
}

import { useEffect, useRef } from "react"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { HugeiconsIcon } from "@hugeicons/react"
import {
  AiChat02Icon,
  ArrowRight01Icon,
  Cancel01Icon,
  StopIcon,
  Copy01Icon,
  RefreshIcon,
  Settings02Icon,
  AlertCircleIcon,
} from "@hugeicons/core-free-icons"
import { useChat } from "@/lib/use-chat"
import { isAIConfigured } from "@/lib/ai-service"
import { MarkdownView } from "@/components/markdown-view"
import type { Meeting } from "@/types"

const SUGGESTED_QUESTIONS = [
  "What were the key decisions made?",
  "List all action items with owners",
  "What was their budget?",
  "What objections or concerns were raised?",
  "Summarize the main points in 3 sentences",
  "What are the next steps?",
]

interface AIChatPanelProps {
  meeting: Meeting
  open: boolean
  onOpenChange: (open: boolean) => void
  onUpdate: (meeting: Meeting) => void
  onOpenSettings?: () => void
}

export function AIChatPanel({
  meeting,
  open,
  onOpenChange,
  onUpdate,
  onOpenSettings,
}: AIChatPanelProps) {
  const {
    messages,
    input,
    setInput,
    streaming,
    error,
    copiedIdx,
    scrollRef,
    sendMessage,
    stopStreaming,
    retryLast,
    copyMessage,
    lastIsStreaming,
  } = useChat(meeting, onUpdate)

  const inputRef = useRef<HTMLTextAreaElement>(null)
  const configured = isAIConfigured()

  useEffect(() => {
    if (open && configured) {
      const t = setTimeout(() => inputRef.current?.focus(), 50)
      return () => clearTimeout(t)
    }
  }, [open, configured])

  useEffect(() => {
    if (!open) stopStreaming()
  }, [open, stopStreaming])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg h-[560px] max-h-[80vh] flex flex-col p-0 gap-0" showCloseButton={false}>
        <DialogHeader className="px-4 pt-4 pb-2 shrink-0">
          <div className="flex items-center justify-between">
            <div className="min-w-0">
              <DialogTitle className="flex items-center gap-2">
                <HugeiconsIcon icon={AiChat02Icon} strokeWidth={2} className="size-5" />
                Ask About This Meeting
              </DialogTitle>
              <DialogDescription className="truncate">{meeting.title}</DialogDescription>
            </div>
            <Button variant="ghost" size="icon-sm" onClick={() => onOpenChange(false)} title="Close" aria-label="Close">
              <HugeiconsIcon icon={Cancel01Icon} strokeWidth={2} />
            </Button>
          </div>
        </DialogHeader>

        {!configured ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-4 px-8 text-center">
            <div className="bg-muted inline-flex size-12 items-center justify-center rounded-full">
              <HugeiconsIcon icon={AiChat02Icon} strokeWidth={2} className="size-6 text-muted-foreground" />
            </div>
            <div className="flex flex-col gap-1">
              <p className="text-sm font-medium">AI chat isn't set up yet</p>
              <p className="text-xs text-muted-foreground max-w-xs">
                Add your DeepSeek API key and enable AI features in Settings to chat about this meeting.
              </p>
            </div>
            {onOpenSettings && (
              <Button
                size="sm"
                onClick={() => {
                  onOpenChange(false)
                  onOpenSettings()
                }}
              >
                <HugeiconsIcon icon={Settings02Icon} strokeWidth={2} data-icon="inline-start" />
                Open Settings
              </Button>
            )}
          </div>
        ) : (
          <>
            <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-2 flex flex-col gap-3">
              {messages.length === 0 && (
                <div className="flex flex-col gap-2 py-2">
                  <p className="text-xs text-muted-foreground">Suggested questions</p>
                  {SUGGESTED_QUESTIONS.map((q) => (
                    <button
                      key={q}
                      className="text-sm text-left px-3 py-2 rounded-2xl border border-dashed hover:bg-muted/50 hover:border-border transition-colors disabled:opacity-50"
                      onClick={() => sendMessage(q)}
                      disabled={streaming}
                    >
                      {q}
                    </button>
                  ))}
                </div>
              )}

              {messages.map((msg, i) => {
                const isLast = i === messages.length - 1
                return (
                  <div
                    key={i}
                    className={`group flex flex-col gap-1 ${msg.role === "user" ? "items-end" : "items-start"}`}
                  >
                    {msg.role === "user" ? (
                      <div className="max-w-[85%] rounded-2xl rounded-br-md px-3 py-2 text-sm whitespace-pre-wrap break-words bg-primary text-primary-foreground">
                        {msg.content}
                      </div>
                    ) : (
                      <div className="max-w-[85%] rounded-2xl rounded-bl-md px-3 py-2 bg-muted">
                        <MarkdownView markdown={msg.content || (isLast && lastIsStreaming ? "" : "")} />
                        {isLast && lastIsStreaming && (
                          <span className="inline-block w-1.5 h-4 bg-current ml-0.5 animate-pulse align-middle" />
                        )}
                      </div>
                    )}
                    {msg.role === "assistant" && msg.content && !(isLast && lastIsStreaming) && (
                      <button
                        onClick={() => copyMessage(msg.content, i)}
                        className="text-[11px] text-muted-foreground/50 hover:text-foreground inline-flex items-center gap-1"
                      >
                        {copiedIdx === i ? (
                          <span className="text-emerald-500">Copied</span>
                        ) : (
                          <>
                            <HugeiconsIcon icon={Copy01Icon} strokeWidth={2} className="size-3" />
                            Copy
                          </>
                        )}
                      </button>
                    )}
                  </div>
                )
              })}

              {error && (
                <div className="flex flex-col items-center gap-2 py-2">
                  <div className="text-destructive text-sm text-center inline-flex items-center gap-1.5" role="alert">
                    <HugeiconsIcon icon={AlertCircleIcon} strokeWidth={2} className="size-4" />
                    {error}
                  </div>
                  <Button variant="outline" size="sm" onClick={retryLast}>
                    <HugeiconsIcon icon={RefreshIcon} strokeWidth={2} data-icon="inline-start" />
                    Retry
                  </Button>
                </div>
              )}
            </div>

            <div className="shrink-0 p-3 border-t border-border flex items-end gap-2">
              <Textarea
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Ask about this meeting…  (Enter to send, Shift+Enter for newline)"
                className="min-h-0 h-10 max-h-28 resize-none"
                disabled={streaming}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault()
                    sendMessage(input)
                  }
                }}
              />
              {streaming ? (
                <Button size="icon" variant="destructive" onClick={stopStreaming} title="Stop generating" aria-label="Stop generating">
                  <HugeiconsIcon icon={StopIcon} strokeWidth={2} />
                </Button>
              ) : (
                <Button
                  size="icon"
                  onClick={() => sendMessage(input)}
                  disabled={!input.trim()}
                  title="Send message"
                  aria-label="Send message"
                >
                  <HugeiconsIcon icon={ArrowRight01Icon} strokeWidth={2} />
                </Button>
              )}
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}

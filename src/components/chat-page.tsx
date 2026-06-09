import { useEffect, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { HugeiconsIcon } from "@hugeicons/react"
import { motion } from "framer-motion"
import {
  AiChat02Icon,
  ArrowRight01Icon,
  ArrowLeft01Icon,
  StopIcon,
  Copy01Icon,
  RefreshIcon,
  Settings02Icon,
  AlertCircleIcon,
  Calendar01Icon,
  Clock01Icon,
  AiMagicIcon,
  ArrowDown01Icon,
} from "@hugeicons/core-free-icons"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { MarkdownView } from "@/components/markdown-view"
import { useChat } from "@/lib/use-chat"
import { isAIConfigured } from "@/lib/ai-service"
import type { Meeting } from "@/types"

const SUGGESTED_QUESTIONS = [
  "What were the key decisions made?",
  "List all action items with owners",
  "What was their budget?",
  "What objections or concerns were raised?",
  "Summarize the main points in 3 sentences",
  "What are the next steps?",
]

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  })
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
  })
}

interface ChatPageProps {
  meeting: Meeting
  allMeetings?: Meeting[]
  onBack: () => void
  onSettings: () => void
  onSwitchMeeting?: (meeting: Meeting) => void
  onUpdate: (meeting: Meeting) => void
}

export function ChatPage({ meeting, allMeetings, onBack, onSettings, onSwitchMeeting, onUpdate }: ChatPageProps) {
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

  const inputRef = useRef<HTMLInputElement>(null)
  const configured = isAIConfigured()
  const [showContext, setShowContext] = useState(true)

  useEffect(() => {
    const t = setTimeout(() => inputRef.current?.focus(), 100)
    return () => clearTimeout(t)
  }, [])

  return (
    <div className="flex flex-col gap-4 w-full px-6 sm:px-8 lg:px-12 h-[calc(100vh-6rem)]">
      <div className="flex items-center gap-3 shrink-0">
        <Button variant="ghost" size="icon-sm" onClick={onBack} title="Back" aria-label="Back">
          <HugeiconsIcon icon={ArrowLeft01Icon} strokeWidth={2} />
        </Button>
        <div className="flex flex-col gap-0.5 min-w-0 flex-1">
          <h1 className="font-heading text-xl font-medium flex items-center gap-2">
            <HugeiconsIcon icon={AiChat02Icon} strokeWidth={2} className="size-5" />
            Chat
          </h1>
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            {allMeetings && allMeetings.length > 1 && onSwitchMeeting ? (
              <DropdownMenu>
                <DropdownMenuTrigger className="font-medium text-foreground truncate hover:text-primary transition-colors inline-flex items-center gap-0.5 cursor-pointer">
                  {meeting.title}
                  <HugeiconsIcon icon={ArrowDown01Icon} strokeWidth={2} className="size-3" />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="max-h-60 overflow-y-auto">
                  {allMeetings.map((m) => (
                    <DropdownMenuItem key={m.id} onClick={() => onSwitchMeeting(m)}>
                      {m.title}
                      {m.id === meeting.id && (
                        <span className="text-[10px] text-muted-foreground ml-2">current</span>
                      )}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            ) : (
              <span className="font-medium text-foreground truncate">{meeting.title}</span>
            )}
            <span className="inline-flex items-center gap-1">
              <HugeiconsIcon icon={Calendar01Icon} strokeWidth={1.5} className="size-3" />
              {formatDate(meeting.date)}
            </span>
            <span className="inline-flex items-center gap-1">
              <HugeiconsIcon icon={Clock01Icon} strokeWidth={1.5} className="size-3" />
              {formatTime(meeting.date)}
            </span>
          </div>
        </div>
        <Button variant="ghost" size="icon-sm" onClick={onSettings} title="Settings" aria-label="Settings">
          <HugeiconsIcon icon={Settings02Icon} strokeWidth={2} />
        </Button>
      </div>

      {(meeting.transcript || meeting.notes || meeting.structuredNotes?.length) && (
        <div className="shrink-0 border border-border rounded-2xl overflow-hidden">
          <button
            className="w-full flex items-center justify-between px-3 py-2 text-sm font-medium hover:bg-muted/50 transition-colors"
            onClick={() => setShowContext(!showContext)}
          >
            <span className="flex items-center gap-2">
              <HugeiconsIcon icon={AiMagicIcon} strokeWidth={2} className="size-4" />
              Meeting Context
            </span>
            <span className="text-xs text-muted-foreground">
              {meeting.transcript ? "Transcript" : ""}
              {meeting.transcript && meeting.notes ? " · " : ""}
              {meeting.notes ? "Notes" : ""}
            </span>
          </button>
          {showContext && (
            <div className="px-3 pb-3 flex flex-col gap-3 max-h-48 overflow-y-auto border-t border-border">
              {meeting.transcript && (
                <div className="flex flex-col gap-1 pt-2">
                  <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Transcript</div>
                  <div className="text-sm text-foreground whitespace-pre-wrap transcript-text">{meeting.transcript}</div>
                </div>
              )}
              {meeting.notes && (
                <div className="flex flex-col gap-1">
                  <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Notes</div>
                  <MarkdownView markdown={meeting.notes} className="text-sm" />
                </div>
              )}
              {meeting.structuredNotes && meeting.structuredNotes.length > 0 && (
                <div className="flex flex-col gap-1">
                  <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Structured Notes</div>
                  {meeting.structuredNotes.map((s, i) => (
                    <div key={i} className="text-sm">
                      <span className="font-medium">{s.title}: </span>
                      <MarkdownView markdown={s.content} className="text-sm" />
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      <div className="flex-1 min-h-0 border border-border rounded-2xl bg-card flex flex-col overflow-hidden">
        {!configured ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-4 px-8 text-center">
            <div className="bg-muted inline-flex size-14 items-center justify-center rounded-full">
              <HugeiconsIcon icon={AiChat02Icon} strokeWidth={2} className="size-7 text-muted-foreground" />
            </div>
            <div className="flex flex-col gap-1">
              <p className="text-base font-medium">AI chat isn't set up yet</p>
              <p className="text-sm text-muted-foreground max-w-xs">
                Add your DeepSeek API key and enable AI features in Settings to chat about this meeting.
              </p>
            </div>
            <Button size="sm" onClick={onSettings}>
              <HugeiconsIcon icon={Settings02Icon} strokeWidth={2} data-icon="inline-start" />
              Open Settings
            </Button>
          </div>
        ) : (
          <>
            <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 flex flex-col gap-3">
              {messages.length === 0 && (
                <div className="flex flex-col gap-2 py-4">
                  <p className="text-xs text-muted-foreground">Suggested questions</p>
                  <motion.div
                    className="grid grid-cols-1 sm:grid-cols-2 gap-2"
                    initial="hidden"
                    animate="show"
                    variants={{ show: { transition: { staggerChildren: 0.05 } } }}
                  >
                    {SUGGESTED_QUESTIONS.map((q) => (
                      <motion.div
                        key={q}
                        variants={{ hidden: { opacity: 0, y: 4 }, show: { opacity: 1, y: 0 } }}
                      >
                        <button
                          className="text-sm text-left px-3 py-2.5 rounded-2xl border border-dashed hover:bg-muted/50 hover:border-border transition-colors disabled:opacity-50 w-full"
                          onClick={() => sendMessage(q)}
                          disabled={streaming}
                        >
                          {q}
                        </button>
                      </motion.div>
                    ))}
                  </motion.div>
                </div>
              )}

              {messages.map((msg, i) => {
                const isLast = i === messages.length - 1
                return (
                  <motion.div
                    key={i}
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.2 }}
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
                          <motion.span
                            className="inline-block w-1.5 h-4 bg-current ml-0.5 align-middle"
                            animate={{ opacity: [1, 0.4, 1] }}
                            transition={{ repeat: Infinity, duration: 0.8 }}
                          />
                        )}
                      </div>
                    )}
                    {msg.role === "assistant" && msg.content && !(isLast && lastIsStreaming) && (
                      <button
                        onClick={() => copyMessage(msg.content, i)}
                        className="text-[11px] text-muted-foreground/50 hover:text-foreground inline-flex items-center gap-1 ml-1"
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
                  </motion.div>
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

            <div className="shrink-0 p-3 border-t border-border bg-card/50">
              <div className="flex items-center gap-0 rounded-2xl border border-border bg-input/50 focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/30 transition-[color,box-shadow] overflow-hidden">
                <input
                  ref={inputRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder="Ask about this meeting..."
                  className="flex-1 h-8 min-w-0 bg-transparent px-3 py-1 text-sm outline-none placeholder:text-muted-foreground disabled:opacity-50"
                  disabled={streaming}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault()
                      sendMessage(input)
                    }
                  }}
                />
                {streaming ? (
                  <button
                    className="shrink-0 inline-flex items-center justify-center size-8 text-destructive hover:bg-destructive/10 disabled:opacity-50"
                    onClick={stopStreaming}
                    title="Stop generating"
                    aria-label="Stop generating"
                  >
                    <HugeiconsIcon icon={StopIcon} strokeWidth={2} />
                  </button>
                ) : (
                  <button
                    className="shrink-0 inline-flex items-center justify-center size-8 text-primary hover:bg-primary/10 disabled:opacity-30"
                    onClick={() => sendMessage(input)}
                    disabled={!input.trim()}
                    title="Send message"
                    aria-label="Send message"
                  >
                    <HugeiconsIcon icon={ArrowRight01Icon} strokeWidth={2} />
                  </button>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}


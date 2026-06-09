import { useState, useRef, useCallback, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { HugeiconsIcon } from "@hugeicons/react"
import {
  AiChat02Icon,
  ArrowRight01Icon,
  Cancel01Icon,
  StopIcon,
  RefreshIcon,
  Settings02Icon,
  AlertCircleIcon,
} from "@hugeicons/core-free-icons"
import { motion, AnimatePresence } from "framer-motion"
import { streamGlobalChat } from "@/lib/ai-service"
import { isAIConfigured } from "@/lib/ai-service"
import { MarkdownView } from "@/components/markdown-view"
import type { Meeting, ChatMessage } from "@/types"

const SUGGESTED_QUESTIONS = [
  "What were the key decisions across all meetings?",
  "List all action items that are still open",
  "What budget or pricing topics came up?",
  "Summarize all meetings from the last week",
  "What objections or risks were raised across meetings?",
  "Who are the key people I've met with?",
]

interface GlobalChatProps {
  meetings: Meeting[]
  open: boolean
  onClose: () => void
  onOpenSettings?: () => void
}

export function GlobalChat({ meetings, open, onClose, onOpenSettings }: GlobalChatProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState("")
  const [streaming, setStreaming] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const abortRef = useRef<AbortController | null>(null)
  const configured = isAIConfigured()

  useEffect(() => {
    if (open && configured) {
      const t = setTimeout(() => inputRef.current?.focus(), 50)
      return () => clearTimeout(t)
    }
  }, [open, configured])

  useEffect(() => {
    if (!open) {
      abortRef.current?.abort()
      setStreaming(false)
    }
  }, [open])

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages])

  const sendMessage = useCallback(async (text: string) => {
    if (!text.trim() || streaming || meetings.length === 0) return

    const userMsg: ChatMessage = {
      role: "user",
      content: text.trim(),
      timestamp: new Date().toISOString(),
    }
    const base = [...messages, userMsg]
    setMessages(base)
    setInput("")
    setError(null)
    setStreaming(true)

    const assistantMsg: ChatMessage = {
      role: "assistant",
      content: "",
      timestamp: new Date().toISOString(),
    }
    let fullContent = ""

    const controller = new AbortController()
    abortRef.current = controller

    try {
      const gen = streamGlobalChat(text.trim(), base, meetings, controller.signal)
      for await (const chunk of gen) {
        fullContent += chunk
        setMessages([...base, { ...assistantMsg, content: fullContent }])
      }
      if (fullContent.trim()) {
        setMessages([...base, { ...assistantMsg, content: fullContent }])
      }
    } catch (e) {
      const aborted = e instanceof DOMException && e.name === "AbortError"
      if (!aborted) setError(e instanceof Error ? e.message : "Chat failed")
    } finally {
      abortRef.current = null
      setStreaming(false)
    }
  }, [messages, streaming, meetings])

  const stopStreaming = useCallback(() => {
    abortRef.current?.abort()
  }, [])

  const retryLast = useCallback(() => {
    const lastUser = [...messages].reverse().find((m) => m.role === "user")
    if (!lastUser) return
    setMessages(messages.filter((m) => m !== lastUser))
    sendMessage(lastUser.content)
  }, [messages, sendMessage])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      sendMessage(input)
    }
  }, [input, sendMessage])

  const lastIsStreaming =
    messages.length > 0 && messages[messages.length - 1].role === "assistant" && streaming

  return (
    <AnimatePresence>
      {open ? (
        <div>
          <motion.div
            key="global-chat-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="fixed inset-0 z-40 bg-black/20 lg:hidden"
            onClick={onClose}
          />
          <motion.div
            key="global-chat-panel"
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ duration: 0.2, ease: "easeOut" }}
            className="fixed top-0 right-0 z-50 h-full w-[420px] max-w-[90vw] border-l bg-background flex flex-col shadow-xl"
        >
          <div className="flex items-center justify-between px-4 py-3 border-b shrink-0">
            <div className="flex items-center gap-2 min-w-0">
              <HugeiconsIcon icon={AiChat02Icon} strokeWidth={2} className="size-4 shrink-0" />
              <div className="min-w-0">
                <p className="text-sm font-medium truncate">Ask About All Meetings</p>
                <p className="text-xs text-muted-foreground">
                  {meetings.length} meeting{meetings.length !== 1 ? "s" : ""}
                </p>
              </div>
            </div>
            <Button variant="ghost" size="icon-sm" onClick={onClose} title="Close">
              <HugeiconsIcon icon={Cancel01Icon} strokeWidth={2} />
            </Button>
          </div>

          <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3">
            {!configured ? (
              <div className="flex flex-col items-center justify-center h-full gap-3 text-muted-foreground">
                <HugeiconsIcon icon={Settings02Icon} strokeWidth={1.5} className="size-8" />
                <p className="text-xs text-center">AI is not configured.</p>
                {onOpenSettings && (
                  <Button variant="outline" size="sm" onClick={onOpenSettings}>
                    Configure in Settings
                  </Button>
                )}
              </div>
            ) : messages.length === 0 ? (
              <div className="flex flex-col gap-3 pt-8">
                <p className="text-xs text-muted-foreground text-center">
                  Ask anything about your meetings.
                </p>
                <div className="flex flex-wrap gap-1.5 justify-center">
                  {SUGGESTED_QUESTIONS.map((q) => (
                    <button
                      key={q}
                      type="button"
                      className="inline-flex items-center gap-1 rounded-full border border-border/60 px-2.5 py-1 text-xs text-muted-foreground hover:border-primary/30 hover:text-foreground transition-colors text-left"
                      onClick={() => sendMessage(q)}
                    >
                      {q}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                {messages.map((msg, i) => (
                  <motion.div
                    key={i}
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.15 }}
                    className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
                  >
                    <div
                      className={`max-w-[90%] rounded-xl px-3 py-2 ${
                        msg.role === "user"
                          ? "bg-primary text-primary-foreground"
                          : "bg-muted"
                      }`}
                    >
                      {msg.role === "user" ? (
                        <p className="text-xs whitespace-pre-wrap">{msg.content}</p>
                      ) : (
                        <div className="text-xs">
                          {msg.content ? (
                            <MarkdownView markdown={msg.content} />
                          ) : streaming && i === messages.length - 1 ? (
                            <span className="inline-flex items-center gap-1 text-muted-foreground">
                              <span className="inline-flex gap-0.5">
                                <span className="size-1 rounded-full bg-current animate-bounce [animation-delay:0ms]" />
                                <span className="size-1 rounded-full bg-current animate-bounce [animation-delay:150ms]" />
                                <span className="size-1 rounded-full bg-current animate-bounce [animation-delay:300ms]" />
                              </span>
                            </span>
                          ) : null}
                        </div>
                      )}
                    </div>
                  </motion.div>
                ))}

                {streaming && !lastIsStreaming && (
                  <div className="flex justify-start">
                    <div className="bg-muted rounded-xl px-3 py-2 text-xs text-muted-foreground">
                      <span className="inline-flex gap-0.5">
                        <span className="size-1 rounded-full bg-current animate-bounce [animation-delay:0ms]" />
                        <span className="size-1 rounded-full bg-current animate-bounce [animation-delay:150ms]" />
                        <span className="size-1 rounded-full bg-current animate-bounce [animation-delay:300ms]" />
                      </span>
                    </div>
                  </div>
                )}
              </div>
            )}

            {error && (
              <div className="mt-3 bg-destructive/10 rounded-lg p-2.5 text-xs text-destructive flex items-center gap-2">
                <HugeiconsIcon icon={AlertCircleIcon} strokeWidth={1.5} className="size-3.5 shrink-0" />
                {error}
              </div>
            )}
          </div>

          <div className="border-t px-3 py-2.5 shrink-0">
            <div className="flex items-end gap-1.5">
              <Textarea
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={configured ? "Ask about all meetings..." : "Configure AI in Settings"}
                disabled={!configured || streaming || meetings.length === 0}
                rows={2}
                className="min-h-0 resize-none text-xs"
              />
              <div className="flex items-center shrink-0">
                {streaming ? (
                  <Button variant="ghost" size="icon-sm" onClick={stopStreaming} title="Stop">
                    <HugeiconsIcon icon={StopIcon} strokeWidth={2} className="size-4" />
                  </Button>
                ) : (
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => sendMessage(input)}
                    disabled={!input.trim() || !configured || meetings.length === 0}
                    title="Send"
                  >
                    <HugeiconsIcon icon={ArrowRight01Icon} strokeWidth={2} className="size-4" />
                  </Button>
                )}
              </div>
            </div>

            {messages.length > 0 && (
              <div className="flex items-center gap-1.5 mt-1.5">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={retryLast}
                  disabled={streaming}
                  className="text-xs h-7"
                >
                  <HugeiconsIcon icon={RefreshIcon} strokeWidth={1.5} className="size-3 mr-1" />
                  Retry
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setMessages([])}
                  disabled={streaming}
                  className="text-xs h-7"
                >
                  <HugeiconsIcon icon={Cancel01Icon} strokeWidth={1.5} className="size-3 mr-1" />
                  Clear
                </Button>
              </div>
            )}
          </div>
        </motion.div>
        </div>
      ) : null}
    </AnimatePresence>
  )
}

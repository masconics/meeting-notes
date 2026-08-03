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
  FlashIcon,
  CheckmarkCircle02Icon,
} from "@hugeicons/core-free-icons"
import { motion, AnimatePresence } from "framer-motion"
import {
  drawerRightVariants,
  messageVariants,
  overlayVariants,
  transitions,
} from "@/lib/motion"
import { streamGlobalChat } from "@/lib/ai-service"
import { isAIConfigured } from "@/lib/ai-service"
import { GLOBAL_SUGGESTED_QUESTIONS } from "@/lib/constants"
import { applyChatAction, describeChatAction, parseChatActions, stripChatActions } from "@/lib/chat-actions"
import { MarkdownView } from "@/components/markdown-view"
import type { Meeting, ChatMessage } from "@/types"

interface GlobalChatProps {
  meetings: Meeting[]
  open: boolean
  onClose: () => void
  onOpenSettings?: () => void
  folderId?: string
}

export function GlobalChat({ meetings, open, onClose, onOpenSettings, folderId }: GlobalChatProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState("")
  const [streaming, setStreaming] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const abortRef = useRef<AbortController | null>(null)
  const configured = isAIConfigured()
  // Outcome of each proposed action card, keyed `${messageIndex}:${actionIndex}`.
  // Actions apply only on explicit user confirmation — never automatically.
  const [actionStates, setActionStates] = useState<Record<string, { status: "applied" | "dismissed" | "failed"; message?: string }>>({})

  const handleApplyAction = useCallback((key: string, action: ReturnType<typeof parseChatActions>[number]) => {
    const result = applyChatAction(action)
    setActionStates((prev) => ({
      ...prev,
      [key]: { status: result.ok ? "applied" : "failed", message: result.message },
    }))
  }, [])

  const handleDismissAction = useCallback((key: string) => {
    setActionStates((prev) => ({ ...prev, [key]: { status: "dismissed" } }))
  }, [])

  useEffect(() => {
    if (open && configured) {
      const t = setTimeout(() => inputRef.current?.focus(), 50)
      return () => clearTimeout(t)
    }
  }, [open, configured])

  // Closing the panel aborts any in-flight stream; sendMessage's finally
  // block resets the streaming flag, so no state update is needed here.
  useEffect(() => {
    if (!open) abortRef.current?.abort()
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
      const gen = streamGlobalChat(text.trim(), base, meetings, controller.signal, { folderId })
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
  }, [messages, streaming, meetings, folderId])

  const stopStreaming = useCallback(() => {
    abortRef.current?.abort()
  }, [])

  const retryLast = useCallback(() => {
    const lastUser = [...messages].reverse().find((m) => m.role === "user")
    if (!lastUser) return
    setActionStates({})
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
            variants={overlayVariants}
            initial="initial"
            animate="animate"
            exit="exit"
            transition={transitions.overlay}
            className="fixed inset-0 z-40 bg-black/20 lg:hidden"
            onClick={onClose}
          />
          <motion.div
            key="global-chat-panel"
            variants={drawerRightVariants}
            initial="initial"
            animate="animate"
            exit="exit"
            transition={transitions.panel}
            className="fixed top-0 right-0 z-50 h-full w-[420px] max-w-[90vw] border-l bg-background flex flex-col shadow-xl"
        >
          <div className="flex items-center justify-between px-4 py-3 border-b shrink-0">
            <div className="flex items-center gap-2 min-w-0">
              <span className="ai-mark shrink-0" data-ai={streaming ? "busy" : "active"}>
                <HugeiconsIcon icon={AiChat02Icon} strokeWidth={2} className="size-3.5 text-white" />
              </span>
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">
                  <span className="ai-label" data-ai={streaming ? "busy" : "idle"}>
                    Ask about all meetings
                  </span>
                </p>
                <p className="text-xs text-muted-foreground">
                  {meetings.length} meeting{meetings.length !== 1 ? "s" : ""}
                </p>
              </div>
            </div>
            <Button variant="ghost" size="icon-sm" onClick={onClose} title="Close">
              <HugeiconsIcon icon={Cancel01Icon} strokeWidth={2} />
            </Button>
          </div>

          <div ref={scrollRef} className="scroll-fade flex-1 overflow-y-auto px-4 py-3">
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
                  {GLOBAL_SUGGESTED_QUESTIONS.map((q) => (
                    <button
                      key={q}
                      type="button"
                      className="inline-flex items-center gap-1 rounded-full border border-border/60 px-2.5 py-1 text-left text-xs text-muted-foreground transition-[color,border-color,transform] duration-150 ease-out hover:border-primary/30 hover:text-foreground active:scale-[0.96]"
                      onClick={() => sendMessage(q)}
                    >
                      {q}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                {messages.map((msg, i) => {
                  const actions = msg.role === "assistant" ? parseChatActions(msg.content) : []
                  return (
                    <motion.div
                      // Timestamps can collide (user msg + assistant placeholder
                      // are created in the same tick), so key by position.
                      key={i}
                      variants={messageVariants}
                      initial="initial"
                      animate="animate"
                      transition={transitions.item}
                      className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
                    >
                      <div className="flex max-w-[90%] flex-col gap-1.5">
                        <div
                          className={`rounded-xl px-3 py-2 ${
                            msg.role === "user"
                              ? "bg-primary text-primary-foreground"
                              : "bg-muted"
                          }`}
                        >
                          {msg.role === "user" ? (
                            <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
                          ) : (
                            <div>
                              {msg.content ? (
                                <MarkdownView markdown={stripChatActions(msg.content)} />
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
                        {actions.length > 0 && (
                          <div className="flex flex-col gap-1.5">
                            {actions.map((action, ai) => {
                              const key = `${i}:${ai}`
                              const state = actionStates[key]
                              return (
                                <div key={key} className="rounded-lg border border-border/70 bg-card px-2.5 py-2 text-xs shadow-sm">
                                  <div className="flex items-center gap-1.5 text-foreground">
                                    <HugeiconsIcon icon={FlashIcon} strokeWidth={2} className="size-3.5 shrink-0 text-primary" />
                                    <span className="font-medium">{describeChatAction(action)}</span>
                                  </div>
                                  {state ? (
                                    <p className={`mt-1 flex items-center gap-1 ${state.status === "failed" ? "text-destructive" : "text-muted-foreground"}`}>
                                      {state.status === "applied" && (
                                        <HugeiconsIcon icon={CheckmarkCircle02Icon} strokeWidth={2} className="size-3.5 text-emerald-500" />
                                      )}
                                      {state.message ?? (state.status === "dismissed" ? "Dismissed" : "")}
                                    </p>
                                  ) : (
                                    <div className="mt-1.5 flex items-center gap-1.5">
                                      <Button size="xs" onClick={() => handleApplyAction(key, action)}>
                                        Apply
                                      </Button>
                                      <Button size="xs" variant="ghost" onClick={() => handleDismissAction(key)}>
                                        Dismiss
                                      </Button>
                                    </div>
                                  )}
                                </div>
                              )
                            })}
                          </div>
                        )}
                      </div>
                    </motion.div>
                  )
                })}

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
                className="min-h-0 resize-none text-sm"
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
                  onClick={() => { setMessages([]); setActionStates({}) }}
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

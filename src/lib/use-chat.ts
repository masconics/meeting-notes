import { useState, useRef, useCallback, useEffect } from "react"
import { streamChatResponse } from "@/lib/ai-service"
import type { Meeting, ChatMessage } from "@/types"

export function useChat(meeting: Meeting, onUpdate: (meeting: Meeting) => void, allMeetings?: Meeting[]) {
  const [messages, setMessages] = useState<ChatMessage[]>(() => meeting.chatHistory || [])
  const [input, setInput] = useState("")
  const [streaming, setStreaming] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const streamingRef = useRef("")
  const abortRef = useRef<AbortController | null>(null)
  const allMeetingsRef = useRef(allMeetings)

  useEffect(() => {
    allMeetingsRef.current = allMeetings
  }, [allMeetings])

  const persistHistory = useCallback((msgs: ChatMessage[]) => {
    setMessages(msgs)
    onUpdate({ ...meeting, chatHistory: msgs })
  }, [meeting, onUpdate])

  const sendMessage = useCallback(async (text: string) => {
    if (!text.trim() || streaming) return

    const userMsg: ChatMessage = {
      role: "user",
      content: text.trim(),
      timestamp: new Date().toISOString(),
    }
    const base = [...messages, userMsg]
    persistHistory(base)
    setInput("")
    setError(null)
    setStreaming(true)
    streamingRef.current = ""

    const assistantMsg: ChatMessage = {
      role: "assistant",
      content: "",
      timestamp: new Date().toISOString(),
    }
    setMessages([...base, assistantMsg])

    const controller = new AbortController()
    abortRef.current = controller

    try {
      const gen = streamChatResponse(
        base,
        meeting,
        allMeetingsRef.current,
        controller.signal
      )
      for await (const chunk of gen) {
        streamingRef.current += chunk
        setMessages([...base, { ...assistantMsg, content: streamingRef.current }])
      }
      if (streamingRef.current.trim()) {
        persistHistory([...base, { ...assistantMsg, content: streamingRef.current }])
      } else {
        persistHistory(base)
      }
    } catch (e) {
      const aborted = e instanceof DOMException && e.name === "AbortError"
      if (aborted && streamingRef.current.trim()) {
        persistHistory([...base, { ...assistantMsg, content: streamingRef.current }])
      } else {
        persistHistory(base)
        if (!aborted) setError(e instanceof Error ? e.message : "Chat failed")
      }
    } finally {
      abortRef.current = null
      setStreaming(false)
    }
  }, [messages, streaming, meeting, persistHistory])

  const stopStreaming = useCallback(() => {
    abortRef.current?.abort()
  }, [])

  const retryLast = useCallback(() => {
    const lastUser = [...messages].reverse().find((m) => m.role === "user")
    if (!lastUser) return
    setMessages(messages.filter((m) => m !== lastUser))
    sendMessage(lastUser.content)
  }, [messages, sendMessage])

  const copyMessage = useCallback(async (content: string, idx: number) => {
    await navigator.clipboard.writeText(content)
    setCopiedIdx(idx)
    setTimeout(() => setCopiedIdx((c) => (c === idx ? null : c)), 2000)
  }, [])

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages])

  useEffect(() => {
    return () => {
      abortRef.current?.abort()
    }
  }, [])

  const lastIsStreaming =
    messages.length > 0 && messages[messages.length - 1].role === "assistant" && streaming

  const resetChat = useCallback(() => {
    abortRef.current?.abort()
    setMessages([])
    setInput("")
    setError(null)
    setStreaming(false)
    streamingRef.current = ""
  }, [])

  return {
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
    resetChat,
  }
}

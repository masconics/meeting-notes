import { useState, useCallback, useEffect } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { HugeiconsIcon } from "@hugeicons/react"
import {
  AiMagicIcon,
  Cancel01Icon,
  Copy01Icon,
  AiChat02Icon,
  ArrowRight01Icon,
} from "@hugeicons/core-free-icons"

interface Action {
  label: string
  prompt: (selected: string) => string
  icon: typeof AiMagicIcon
}

const ACTIONS: Action[] = [
  {
    label: "Summarize",
    icon: AiMagicIcon,
    prompt: (s) => `Summarize the following text in 1-2 concise sentences using markdown with bold for key points:\n\n${s}`,
  },
  {
    label: "Explain",
    icon: AiChat02Icon,
    prompt: (s) => `Explain the following text clearly and simply using markdown formatting:\n\n${s}`,
  },
  {
    label: "Rephrase",
    icon: ArrowRight01Icon,
    prompt: (s) => `Rephrase the following text to be clearer and more professional while keeping the same meaning. Use markdown where appropriate:\n\n${s}`,
  },
  {
    label: "Expand",
    icon: Copy01Icon,
    prompt: (s) => `Expand on the following text with relevant details, context, and examples. Use markdown formatting with bullet points where appropriate:\n\n${s}`,
  },
]

const MENU_W = 200
const MENU_H = 230

interface SelectionContextMenuProps {
  containerRef: React.RefObject<HTMLElement | null>
  getSelectedText: () => string
  onInsert: (text: string) => void
  onError?: (msg: string) => void
}

export function useSelectionMenu({
  containerRef,
  getSelectedText,
  onInsert,
  onError,
}: SelectionContextMenuProps) {
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  const [loading, setLoading] = useState<string | null>(null)

  const close = useCallback(() => {
    setMenu(null)
  }, [])

  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    const handleContextMenu = (e: MouseEvent) => {
      const selection = window.getSelection()
      const text = selection?.toString().trim()
      if (!text || text.length < 3) {
        setMenu(null)
        return
      }
      e.preventDefault()
      e.stopPropagation()

      const vw = window.innerWidth
      const vh = window.innerHeight
      const x = Math.min(e.clientX, vw - MENU_W - 8)
      const y = Math.min(e.clientY, vh - MENU_H - 8)

      setMenu({ x, y })
    }

    const handleClick = () => {
      if (menu) close()
    }

    el.addEventListener("contextmenu", handleContextMenu)
    document.addEventListener("click", handleClick)
    return () => {
      el.removeEventListener("contextmenu", handleContextMenu)
      document.removeEventListener("click", handleClick)
    }
  }, [containerRef, menu, close])

  const executeAction = useCallback(
    async (action: Action) => {
      const selected = getSelectedText()
      if (!selected) return

      setLoading(action.label)

      try {
        const { callDeepSeek } = await import("@/lib/ai-service")
        const result = await callDeepSeek(
          [
            {
              role: "system",
              content: "You are a helpful assistant. Answer concisely and directly.",
            },
            { role: "user", content: action.prompt(selected) },
          ],
          {}
        )

        if (result) {
          close()
          onInsert(`\n\n${result.trim()}\n\n`)
        }
      } catch (e) {
        onError?.(e instanceof Error ? e.message : "Action failed")
      } finally {
        setLoading(null)
      }
    },
    [getSelectedText, onInsert, onError, close]
  )

  const menuElement = (
    <AnimatePresence>
      {menu && (
        <>
          <div className="fixed inset-0 z-40" onClick={close} />
          <motion.div
            initial={{ opacity: 0, scale: 0.92, y: -4 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.92, y: -4 }}
            transition={{ duration: 0.12 }}
            className="fixed z-50 min-w-[180px] rounded-2xl border border-border/60 bg-card/95 p-1.5 shadow-xl backdrop-blur-sm"
            style={{ left: menu.x, top: menu.y }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-2 py-1.5">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/50">
                AI Actions
              </span>
              <button
                onClick={close}
                className="text-muted-foreground/40 hover:text-muted-foreground"
              >
                <HugeiconsIcon icon={Cancel01Icon} strokeWidth={1.5} className="size-3" />
              </button>
            </div>
            <div className="h-px bg-border/40 mb-1" />
            {ACTIONS.map((action) => (
              <button
                key={action.label}
                onClick={() => executeAction(action)}
                disabled={loading !== null}
                className="flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-sm text-muted-foreground hover:bg-muted/60 hover:text-foreground transition-colors disabled:opacity-50"
              >
                <HugeiconsIcon
                  icon={action.icon}
                  strokeWidth={1.5}
                  className="size-3.5 shrink-0"
                />
                <span className="flex-1 text-left">{action.label}</span>
                {loading === action.label && (
                  <div className="size-3 border border-primary border-t-transparent rounded-full animate-spin shrink-0" />
                )}
              </button>
            ))}
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )

  return { menuElement, close }
}

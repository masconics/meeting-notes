import { useCallback, useRef, useEffect, useState } from "react"
import { EditorState } from "prosemirror-state"
import { EditorView } from "prosemirror-view"
import type { Fragment } from "prosemirror-model"
import "prosemirror-view/style/prosemirror.css"
import { keymap } from "prosemirror-keymap"
import { baseKeymap } from "prosemirror-commands"
import { history, undo, redo } from "prosemirror-history"
import { defaultMarkdownParser, defaultMarkdownSerializer } from "prosemirror-markdown"
import { InputRule, inputRules, wrappingInputRule, textblockTypeInputRule, smartQuotes, ellipsis, emDash } from "prosemirror-inputrules"

const markdownSchema = defaultMarkdownParser.schema

const blockInputRules = inputRules({
  rules: [
    textblockTypeInputRule(/^#\s$/, markdownSchema.nodes.heading, { level: 1 }),
    textblockTypeInputRule(/^##\s$/, markdownSchema.nodes.heading, { level: 2 }),
    textblockTypeInputRule(/^###\s$/, markdownSchema.nodes.heading, { level: 3 }),
    wrappingInputRule(/^\s*>\s$/, markdownSchema.nodes.blockquote),
    wrappingInputRule(/^\s*([-+*])\s$/, markdownSchema.nodes.bullet_list),
    wrappingInputRule(
      /^(\d+)\.\s$/,
      markdownSchema.nodes.ordered_list,
      (match) => ({ order: Number(match[1]) })
    ),
    textblockTypeInputRule(/^```$/, markdownSchema.nodes.code_block),
  ],
})

function parseMarkdown(value: string) {
  return defaultMarkdownParser.parse(value.trim()) || markdownSchema.topNodeType.createAndFill()!
}

function markInputRule(regexp: RegExp, markName: "strong" | "em" | "code" | "link", getAttrs?: (match: RegExpMatchArray) => Record<string, string> | null) {
  return new InputRule(regexp, (state, match, start, end) => {
    const text = match[1]
    if (!text) return null
    const markType = markdownSchema.marks[markName]
    const attrs = getAttrs?.(match) ?? null
    return state.tr
      .delete(start, end)
      .insertText(text, start)
      .addMark(start, start + text.length, markType.create(attrs))
      .removeStoredMark(markType)
  })
}

const inlineMarkdownRules = inputRules({
  rules: [
    markInputRule(/\*\*([^*]+)\*\*$/, "strong"),
    markInputRule(/__([^_]+)__$/, "strong"),
    markInputRule(/(?<!\*)\*([^*]+)\*$/, "em"),
    markInputRule(/(?<!_)_([^_]+)_$/, "em"),
    markInputRule(/`([^`]+)`$/, "code"),
    markInputRule(/\[([^\]]+)\]\((https?:\/\/[^)\s]+|mailto:[^)\s]+|tel:[^)\s]+|#[^)\s]+|\/[^)\s]*)\)$/, "link", (match) => ({ href: match[2] })),
  ],
})

type AiEditAction = "rewrite" | "summarize" | "expand" | "shorten"

const AI_ACTIONS: Array<{ id: AiEditAction; label: string }> = [
  { id: "rewrite", label: "Rewrite" },
  { id: "summarize", label: "Summarize" },
  { id: "expand", label: "Expand" },
  { id: "shorten", label: "Shorten" },
]

const AI_THINKING_LABEL = "Thinking..."
const AI_REVEAL_DELAY_MS = 24
const AI_INITIAL_DELAY_MS = 220

function wait(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("Aborted", "AbortError"))
      return
    }
    const timeout = window.setTimeout(resolve, ms)
    signal?.addEventListener("abort", () => {
      window.clearTimeout(timeout)
      reject(new DOMException("Aborted", "AbortError"))
    }, { once: true })
  })
}

function replacementContent(markdown: string, inline: boolean): Fragment {
  const doc = parseMarkdown(markdown)
  if (inline && doc.childCount === 1 && doc.firstChild?.type.name === "paragraph") {
    return doc.firstChild.content
  }
  return doc.content
}

interface ProseMirrorEditorProps {
  value: string
  onChange: (markdown: string) => void
  className?: string
  editorLabel?: string
}

export function ProseMirrorEditor({
  value,
  onChange,
  className = "",
  editorLabel = "Edit note",
}: ProseMirrorEditorProps) {
  const mountRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const aiBlockRef = useRef<HTMLElement | null>(null)
  const onChangeRef = useRef(onChange)
  const [aiMenu, setAiMenu] = useState<{ x: number; y: number; from: number; to: number; text: string } | null>(null)
  const [aiStreaming, setAiStreaming] = useState<AiEditAction | null>(null)
  const [aiError, setAiError] = useState<string | null>(null)
  useEffect(() => {
    onChangeRef.current = onChange
  })
  const initializedRef = useRef(false)

  const updateAiMenu = useCallback(() => {
    if (aiStreaming) return
    const view = viewRef.current
    if (!view || !view.hasFocus()) return
    const { from, to, empty } = view.state.selection
    const text = view.state.doc.textBetween(from, to, "\n").trim()
    if (empty || text.length < 3) {
      setAiMenu(null)
      return
    }
    const startCoords = view.coordsAtPos(from)
    const endCoords = view.coordsAtPos(to)
    const selection = window.getSelection()
    const selectionRect = selection && selection.rangeCount > 0
      ? selection.getRangeAt(0).getBoundingClientRect()
      : null
    const visualTop = selectionRect && selectionRect.height > 0 ? selectionRect.top : startCoords.top
    const visualBottom = selectionRect && selectionRect.height > 0 ? selectionRect.bottom : endCoords.bottom
    const visualLeft = selectionRect && selectionRect.width > 0 ? selectionRect.left : startCoords.left
    const toolbarHeight = 42
    const toolbarWidth = 340
    const hasRoomBelow = visualBottom + toolbarHeight + 10 < window.innerHeight
    setAiError(null)
    setAiMenu({
      x: Math.max(8, Math.min(visualLeft, window.innerWidth - toolbarWidth - 8)),
      y: hasRoomBelow ? visualBottom + 8 : Math.max(8, visualTop - toolbarHeight - 8),
      from,
      to,
      text,
    })
  }, [aiStreaming])

  const replaceAiRange = useCallback((range: { from: number; to: number; inline: boolean }, markdown: string) => {
    const view = viewRef.current
    if (!view) return
    const content = replacementContent(markdown || " ", range.inline)
    const tr = view.state.tr.replaceWith(range.from, range.to, content)
    view.dispatch(tr)
    range.to = range.from + content.size
    const domAtRange = view.domAtPos(range.from)
    const node = domAtRange.node.nodeType === Node.TEXT_NODE
      ? domAtRange.node.parentElement
      : domAtRange.node as HTMLElement
    const block = node?.closest?.("p, li, h1, h2, h3, h4, h5, h6, blockquote, pre") as HTMLElement | null
    if (block !== aiBlockRef.current) {
      aiBlockRef.current?.classList.remove("pm-ai-writing-block")
      aiBlockRef.current = block
    }
    aiBlockRef.current?.classList.add("pm-ai-writing-block")
  }, [])

  const runAiEdit = useCallback(async (action: AiEditAction) => {
    const view = viewRef.current
    const menu = aiMenu
    if (!view || !menu || aiStreaming) return

    const selectedText = menu.text
    const fullContext = defaultMarkdownSerializer.serialize(view.state.doc)
    const $from = view.state.doc.resolve(menu.from)
    const $to = view.state.doc.resolve(menu.to)
    const range = {
      from: menu.from,
      to: menu.to,
      inline: $from.sameParent($to) && $from.parent.inlineContent,
    }

    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    setAiStreaming(action)
    setAiError(null)
    setAiMenu({ ...menu, text: AI_THINKING_LABEL })
    view.dom.classList.add("pm-ai-writing")
    replaceAiRange(range, AI_THINKING_LABEL)

    try {
      const { streamRewriteSelection } = await import("@/lib/ai-service")
      let generated = ""
      let visible = ""
      await wait(AI_INITIAL_DELAY_MS, controller.signal)

      const reveal = async (target: string) => {
        while (visible.length < target.length) {
          if (controller.signal.aborted) throw new DOMException("Aborted", "AbortError")
          const remaining = target.length - visible.length
          const step = Math.max(1, Math.ceil(remaining / 10))
          visible = target.slice(0, visible.length + step)
          replaceAiRange(range, visible || AI_THINKING_LABEL)
          await wait(AI_REVEAL_DELAY_MS, controller.signal)
        }
      }

      for await (const chunk of streamRewriteSelection(selectedText, action, fullContext, controller.signal)) {
        generated += chunk
        await reveal(generated.trimStart())
      }
      if (generated.trim()) {
        await reveal(generated.trim())
        visible = generated.trim()
        replaceAiRange(range, visible)
      }
      await wait(120, controller.signal)
      setAiMenu(null)
    } catch (e) {
      if (!(e instanceof DOMException && e.name === "AbortError")) {
        setAiError(e instanceof Error ? e.message : "AI edit failed")
        replaceAiRange(range, selectedText)
      }
    } finally {
      view.dom.classList.remove("pm-ai-writing")
      aiBlockRef.current?.classList.remove("pm-ai-writing-block")
      aiBlockRef.current = null
      abortRef.current = null
      setAiStreaming(null)
    }
  }, [aiMenu, aiStreaming, replaceAiRange])

  const cancelAiEdit = useCallback(() => {
    abortRef.current?.abort()
    aiBlockRef.current?.classList.remove("pm-ai-writing-block")
    aiBlockRef.current = null
    abortRef.current = null
    setAiStreaming(null)
    setAiMenu(null)
  }, [])

  useEffect(() => {
    if (!mountRef.current || initializedRef.current) return
    initializedRef.current = true

    const doc = parseMarkdown(value)

    const state = EditorState.create({
      doc,
      plugins: [
        history(),
        keymap(baseKeymap),
        keymap({
          "Mod-z": undo,
          "Mod-Shift-z": redo,
          "Mod-y": redo,
        }),
        blockInputRules,
        inlineMarkdownRules,
        inputRules({ rules: [...smartQuotes, ellipsis, emDash] }),
      ],
    })

    const view = new EditorView(mountRef.current, {
      state,
      attributes: {
        role: "textbox",
        "aria-label": editorLabel,
        "aria-multiline": "true",
      },
      handlePaste(_view, event) {
        const text = event.clipboardData?.getData("text/plain")
        if (text) {
          const doc = defaultMarkdownParser.parse(text)
          if (doc && doc.content.size > 0) {
            const tr = _view.state.tr.replaceSelectionWith(doc)
            if (tr) {
              _view.dispatch(tr)
              return true
            }
          }
        }
        return false
      },
      dispatchTransaction(tr) {
        const newState = view.state.apply(tr)
        view.updateState(newState)
        if (tr.docChanged) {
          const md = defaultMarkdownSerializer.serialize(newState.doc)
          onChangeRef.current(md.trim())
        }
      },
    })

    view.dom.style.minHeight = "7rem"

    viewRef.current = view

    const handleSelection = () => window.setTimeout(updateAiMenu, 0)
    view.dom.addEventListener("mouseup", handleSelection)
    view.dom.addEventListener("keyup", handleSelection)

    return () => {
      view.dom.removeEventListener("mouseup", handleSelection)
      view.dom.removeEventListener("keyup", handleSelection)
      view.destroy()
      viewRef.current = null
      initializedRef.current = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    const currentMd = defaultMarkdownSerializer.serialize(view.state.doc)
    if (value.trim() !== currentMd.trim()) {
      const doc = parseMarkdown(value)
      const state = EditorState.create({ doc, plugins: view.state.plugins })
      view.updateState(state)
    }
  }, [value])

  return (
    <>
      <div
        ref={mountRef}
        className={`pm-editor ${className}`}
      />
      {aiMenu && (
        <div
          className="fixed z-50 flex items-center gap-1 rounded-2xl border border-border/70 bg-card/95 p-1 shadow-xl backdrop-blur"
          style={{ left: aiMenu.x, top: aiMenu.y }}
          onMouseDown={(e) => e.preventDefault()}
        >
          {AI_ACTIONS.map((action) => (
            <button
              key={action.id}
              type="button"
              disabled={aiStreaming !== null}
              onClick={() => runAiEdit(action.id)}
              className="h-7 rounded-xl px-2.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
            >
              {aiStreaming === action.id ? (
                <span className="inline-flex items-center gap-1">
                  <span className="size-1.5 rounded-full bg-primary animate-pulse" />
                  Writing
                </span>
              ) : action.label}
            </button>
          ))}
          <button
            type="button"
            onClick={cancelAiEdit}
            className="h-7 rounded-xl px-2 text-xs text-muted-foreground/60 transition-colors hover:bg-muted hover:text-foreground"
          >
            {aiStreaming ? "Stop" : "Close"}
          </button>
        </div>
      )}
      {aiError && (
        <div className="fixed bottom-16 left-1/2 z-50 -translate-x-1/2 rounded-2xl border border-destructive/20 bg-card px-3 py-2 text-xs text-destructive shadow-xl">
          {aiError}
        </div>
      )}
    </>
  )
}

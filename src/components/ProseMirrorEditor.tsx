import { useCallback, useRef, useEffect, useState } from "react"
import { Editor, rootCtx, defaultValueCtx, editorViewCtx } from "@milkdown/kit/core"
import { commonmark } from "@milkdown/kit/preset/commonmark"
import { gfm } from "@milkdown/kit/preset/gfm"
import { history, historyProviderConfig } from "@milkdown/kit/plugin/history"
import { listener, listenerCtx } from "@milkdown/kit/plugin/listener"
import { streaming, startStreamingCmd, pushChunkCmd, endStreamingCmd, abortStreamingCmd } from "@milkdown/plugin-streaming"
import { diff } from "@milkdown/plugin-diff"
import { Milkdown, MilkdownProvider, useEditor } from "@milkdown/react"
import { replaceAll, getMarkdown, callCommand } from "@milkdown/kit/utils"
import { TextSelection } from "@milkdown/kit/prose/state"
import "@milkdown/kit/prose/view/style/prosemirror.css"

type AiEditAction = "rewrite" | "summarize" | "expand" | "shorten"

const AI_ACTIONS: Array<{ id: AiEditAction; label: string }> = [
  { id: "rewrite", label: "Rewrite" },
  { id: "summarize", label: "Summarize" },
  { id: "expand", label: "Expand" },
  { id: "shorten", label: "Shorten" },
]

const AI_INSTRUCTIONS: Record<AiEditAction, string> = {
  rewrite: "Rewrite the selected text to be clearer and more polished while preserving the meaning.",
  summarize: "Summarize the selected text into a concise, useful version.",
  expand: "Expand the selected text with helpful detail while staying faithful to the surrounding notes.",
  shorten: "Make the selected text shorter and sharper while preserving the important meaning.",
}

interface ProseMirrorEditorProps {
  value: string
  onChange: (markdown: string) => void
  className?: string
  editorLabel?: string
}

function MilkdownEditorInner({
  value, onChange, className, editorLabel, onEditorReady,
}: {
  value: string; onChange: (markdown: string) => void; className: string; editorLabel: string; onEditorReady: (editor: Editor) => void
}) {
  const onChangeRef = useRef(onChange)
  const isExternalUpdate = useRef(false)
  useEffect(() => { onChangeRef.current = onChange })

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const editorFactory = useCallback(
    (root: HTMLElement) => Editor.make()
      .config((ctx) => {
        ctx.set(rootCtx, root)
        ctx.set(defaultValueCtx, value)
        ctx.set(historyProviderConfig.key, { newGroupDelay: 10000 })
        const listenerManager = ctx.get(listenerCtx)
        listenerManager.markdownUpdated((_ctx, md) => {
          if (isExternalUpdate.current) return
          onChangeRef.current(md)
        })
      })
      .use(commonmark).use(gfm).use(history).use(listener).use(streaming).use(diff),
    []
  )

  const { loading, get: getEditor } = useEditor(editorFactory, [])

  useEffect(() => {
    if (loading) return
    const editor = getEditor()
    if (editor) {
      onEditorReady(editor)
      editor.action((ctx) => {
        const view = ctx.get(editorViewCtx)
        view.dom.style.minHeight = "7rem"
        view.dom.setAttribute("role", "textbox")
        view.dom.setAttribute("aria-label", editorLabel)
        view.dom.setAttribute("aria-multiline", "true")
      })
    }
  }, [loading, getEditor, onEditorReady, editorLabel])

  useEffect(() => {
    const editor = getEditor()
    if (!editor || loading) return
    const currentMd = editor.action(getMarkdown())
    if (value !== currentMd) {
      isExternalUpdate.current = true
      editor.action(replaceAll(value))
      setTimeout(() => { isExternalUpdate.current = false }, 0)
    }
  }, [value, loading, getEditor])

  // The ProseMirror DOM only grows with content; clicks on the empty space
  // below it should still focus the editor (cursor at the end) so the note
  // is writable anywhere in the pane.
  const focusEditor = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (e.target !== e.currentTarget) return
      const editor = getEditor()
      editor?.action((ctx) => {
        const view = ctx.get(editorViewCtx)
        const end = view.state.doc.content.size
        view.dispatch(view.state.tr.setSelection(TextSelection.near(view.state.doc.resolve(end))))
        view.focus()
      })
    },
    [getEditor],
  )

  return <div className={`${className} h-full cursor-text`} onClick={focusEditor}><Milkdown /></div>
}

export function ProseMirrorEditor({
  value, onChange, className = "", editorLabel = "Edit note",
}: ProseMirrorEditorProps) {
  const editorRef = useRef<Editor | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const [aiMenu, setAiMenu] = useState<{ x: number; y: number; from: number; to: number; text: string } | null>(null)
  const [aiStreaming, setAiStreaming] = useState<AiEditAction | null>(null)
  const [aiError, setAiError] = useState<string | null>(null)
  const [showAiUndo, setShowAiUndo] = useState<{ from: number; to: number; originalText: string } | null>(null)

  const handleEditorReady = useCallback((editor: Editor) => {
    editorRef.current = editor
    const view = editor.action((ctx) => ctx.get(editorViewCtx))

    const handleSelection = () => {
      window.setTimeout(() => {
        if (aiStreaming) return
        const v = editor.action((ctx) => ctx.get(editorViewCtx))
        if (!v || !v.hasFocus()) return
        const { from, to, empty } = v.state.selection
        const text = v.state.doc.textBetween(from, to, "\n").trim()
        if (empty || text.length < 3) { setAiMenu(null); return }
        const startCoords = v.coordsAtPos(from)
        const endCoords = v.coordsAtPos(to)
        const sel = window.getSelection()
        const selRect = sel && sel.rangeCount > 0 ? sel.getRangeAt(0).getBoundingClientRect() : null
        const vTop = selRect && selRect.height > 0 ? selRect.top : startCoords.top
        const vBottom = selRect && selRect.height > 0 ? selRect.bottom : endCoords.bottom
        const vLeft = selRect && selRect.width > 0 ? selRect.left : startCoords.left
        const h = 42; const w = 340
        const room = vBottom + h + 10 < window.innerHeight
        setAiError(null)
        setAiMenu({ x: Math.max(8, Math.min(vLeft, window.innerWidth - w - 8)), y: room ? vBottom + 8 : Math.max(8, vTop - h - 8), from, to, text })
      }, 0)
    }

    view.dom.addEventListener("mouseup", handleSelection)
    view.dom.addEventListener("keyup", handleSelection)
    return () => {
      view.dom.removeEventListener("mouseup", handleSelection)
      view.dom.removeEventListener("keyup", handleSelection)
    }
  }, [])

  const runAiEdit = useCallback(async (action: AiEditAction) => {
    const editor = editorRef.current; const menu = aiMenu
    if (!editor || !menu || aiStreaming) return
    const orig = { from: menu.from, to: menu.to, originalText: menu.text }
    setShowAiUndo(null)
    const fullCtx = editor.action(getMarkdown())
    abortRef.current?.abort(); const ctrl = new AbortController(); abortRef.current = ctrl
    setAiStreaming(action); setAiError(null); setAiMenu({ ...menu, text: AI_INSTRUCTIONS[action] })
    try {
      editor.action(callCommand(startStreamingCmd.key, { insertAt: "selection" }))
      const { streamRewriteSelection } = await import("@/lib/ai-service")
      for await (const chunk of streamRewriteSelection(menu.text, action, fullCtx, ctrl.signal)) {
        editor.action(callCommand(pushChunkCmd.key, chunk))
      }
      editor.action(callCommand(endStreamingCmd.key))
      setShowAiUndo(orig)
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") editor.action(callCommand(abortStreamingCmd.key))
      else { setAiError(e instanceof Error ? e.message : "AI edit failed"); editor.action(callCommand(abortStreamingCmd.key)) }
    } finally { abortRef.current = null; setAiStreaming(null); setAiMenu(null) }
  }, [aiMenu, aiStreaming])

  const cancelAiEdit = useCallback(() => { abortRef.current?.abort(); abortRef.current = null; setAiStreaming(null); setAiMenu(null) }, [])
  const handleAiUndo = useCallback(() => {
    const editor = editorRef.current
    if (!editor || !showAiUndo) return
    const fullMd = editor.action(getMarkdown())
    onChange(fullMd.slice(0, showAiUndo.from) + showAiUndo.originalText + fullMd.slice(showAiUndo.to))
    setShowAiUndo(null)
  }, [showAiUndo, onChange])

  return (
    <>
      <MilkdownProvider>
        <MilkdownEditorInner value={value} onChange={onChange} className={`pm-editor ${className}`} editorLabel={editorLabel} onEditorReady={handleEditorReady} />
      </MilkdownProvider>
      {aiMenu && (
        <div className="fixed z-50 flex items-center gap-1 rounded-2xl border border-border/70 bg-card/95 p-1 shadow-xl backdrop-blur" style={{ left: aiMenu.x, top: aiMenu.y }} onMouseDown={(e) => e.preventDefault()}>
          {AI_ACTIONS.map((a) => (
            <button key={a.id} type="button" disabled={aiStreaming !== null} onClick={() => runAiEdit(a.id)} className="h-7 rounded-xl px-2.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50">
              {aiStreaming === a.id ? <span className="inline-flex items-center gap-1"><span className="size-1.5 rounded-full bg-primary animate-pulse" />Writing</span> : a.label}
            </button>
          ))}
          <button type="button" onClick={cancelAiEdit} className="h-7 rounded-xl px-2 text-xs text-muted-foreground/60 transition-colors hover:bg-muted hover:text-foreground">{aiStreaming ? "Stop" : "Close"}</button>
        </div>
      )}
      {aiError && <div className="fixed bottom-16 left-1/2 z-50 -translate-x-1/2 rounded-2xl border border-destructive/20 bg-card px-3 py-2 text-xs text-destructive shadow-xl">{aiError}</div>}
      {showAiUndo && (
        <div className="fixed bottom-4 left-1/2 z-50 -translate-x-1/2 rounded-2xl border border-border/70 bg-card/95 px-3 py-2 shadow-xl backdrop-blur flex items-center gap-2 text-xs" onMouseDown={(e) => e.preventDefault()}>
          <span className="text-muted-foreground">AI edit applied</span><span className="text-border/40">·</span>
          <button type="button" onClick={handleAiUndo} className="font-medium text-primary hover:text-primary/80 transition-colors">Undo</button>
        </div>
      )}
    </>
  )
}

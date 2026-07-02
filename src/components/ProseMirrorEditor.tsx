import { useCallback, useRef, useEffect, useState } from "react"
import { Editor, rootCtx, defaultValueCtx, editorViewCtx } from "@milkdown/kit/core"
import type { CmdKey } from "@milkdown/kit/core"
import {
  commonmark,
  toggleStrongCommand,
  toggleEmphasisCommand,
  toggleInlineCodeCommand,
  wrapInHeadingCommand,
  wrapInBulletListCommand,
  wrapInOrderedListCommand,
  wrapInBlockquoteCommand,
  createCodeBlockCommand,
  insertHrCommand,
} from "@milkdown/kit/preset/commonmark"
import { gfm } from "@milkdown/kit/preset/gfm"
import { history, historyProviderConfig } from "@milkdown/kit/plugin/history"
import { listener, listenerCtx } from "@milkdown/kit/plugin/listener"
import { streaming, startStreamingCmd, pushChunkCmd, endStreamingCmd, abortStreamingCmd } from "@milkdown/plugin-streaming"
import { diff } from "@milkdown/plugin-diff"
import { Milkdown, MilkdownProvider, useEditor } from "@milkdown/react"
import { replaceAll, getMarkdown, callCommand, $prose } from "@milkdown/kit/utils"
import { TextSelection, Plugin, PluginKey } from "@milkdown/kit/prose/state"
import type { EditorState } from "@milkdown/kit/prose/state"
import { Decoration, DecorationSet } from "@milkdown/kit/prose/view"
import "@milkdown/kit/prose/view/style/prosemirror.css"

// Show greyed placeholder text while the document is empty (a single empty
// paragraph). Implemented as a node decoration + CSS `::before` so the cursor
// stays put and nothing is inserted into the actual content.
const placeholderPlugin = (text: string) =>
  $prose(() => new Plugin({
    key: new PluginKey("note-placeholder"),
    props: {
      decorations(state) {
        const { doc } = state
        const empty =
          doc.childCount === 1 &&
          doc.firstChild?.isTextblock === true &&
          doc.firstChild.content.size === 0
        if (!empty || !doc.firstChild) return null
        return DecorationSet.create(doc, [
          Decoration.node(0, doc.firstChild.nodeSize, {
            class: "pm-empty",
            "data-placeholder": text,
          }),
        ])
      },
    },
  }))

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

// Which formatting is active at the current selection, so the toolbar can light
// up the matching buttons. Mark/node names match the commonmark schema.
function computeActiveKeys(state: EditorState): string[] {
  const keys: string[] = []
  const { schema, selection, storedMarks, doc } = state
  const { $from, from, to, empty } = selection
  const markActive = (name: string): boolean => {
    const type = schema.marks[name]
    if (!type) return false
    if (empty) return !!(storedMarks ?? $from.marks()).some((m) => m.type === type)
    return doc.rangeHasMark(from, to, type)
  }
  if (markActive("strong")) keys.push("strong")
  if (markActive("emphasis")) keys.push("emphasis")
  if (markActive("inlineCode")) keys.push("inlineCode")
  for (let d = $from.depth; d > 0; d--) {
    const node = $from.node(d)
    switch (node.type.name) {
      case "heading": keys.push(`h${node.attrs.level ?? 1}`); break
      case "bullet_list": keys.push("bullet_list"); break
      case "ordered_list": keys.push("ordered_list"); break
      case "blockquote": keys.push("blockquote"); break
      case "code_block": keys.push("code_block"); break
    }
  }
  return keys
}

const activeStatePlugin = (onActive: (keys: string[]) => void) =>
  $prose(() => new Plugin({
    key: new PluginKey("toolbar-active"),
    view: () => ({ update: (view) => onActive(computeActiveKeys(view.state)) }),
  }))

interface ProseMirrorEditorProps {
  value: string
  onChange: (markdown: string) => void
  className?: string
  editorLabel?: string
  placeholder?: string
  toolbar?: boolean
}

// Formatting toolbar items. `payload` is forwarded to commands that take one
// (heading level); the rest ignore it. Glyph labels keep the bar dependency-free.
type ToolbarItem =
  | { kind: "btn"; label: string; title: string; cmdKey: CmdKey<unknown>; payload?: unknown; className?: string; active?: string }
  | { kind: "sep" }

// `wrapInHeadingCommand.key` is CmdKey<number>; normalize to CmdKey<unknown> so
// every item shares one type (the payload is forwarded untyped to callCommand).
const heading = wrapInHeadingCommand.key as unknown as CmdKey<unknown>

const TOOLBAR_ITEMS: ToolbarItem[] = [
  { kind: "btn", label: "B", title: "Bold (⌘B)", cmdKey: toggleStrongCommand.key, className: "font-bold", active: "strong" },
  { kind: "btn", label: "I", title: "Italic (⌘I)", cmdKey: toggleEmphasisCommand.key, className: "italic", active: "emphasis" },
  { kind: "btn", label: "</>", title: "Inline code", cmdKey: toggleInlineCodeCommand.key, className: "font-mono text-[0.7rem]", active: "inlineCode" },
  { kind: "sep" },
  { kind: "btn", label: "H1", title: "Heading 1", cmdKey: heading, payload: 1, active: "h1" },
  { kind: "btn", label: "H2", title: "Heading 2", cmdKey: heading, payload: 2, active: "h2" },
  { kind: "btn", label: "H3", title: "Heading 3", cmdKey: heading, payload: 3, active: "h3" },
  { kind: "sep" },
  { kind: "btn", label: "•", title: "Bullet list", cmdKey: wrapInBulletListCommand.key, active: "bullet_list" },
  { kind: "btn", label: "1.", title: "Numbered list", cmdKey: wrapInOrderedListCommand.key, active: "ordered_list" },
  { kind: "btn", label: "❝", title: "Quote", cmdKey: wrapInBlockquoteCommand.key, active: "blockquote" },
  { kind: "btn", label: "{ }", title: "Code block", cmdKey: createCodeBlockCommand.key, className: "font-mono text-[0.7rem]", active: "code_block" },
  { kind: "btn", label: "—", title: "Divider", cmdKey: insertHrCommand.key },
]

function MilkdownEditorInner({
  value, onChange, className, editorLabel, placeholder, onActive, onEditorReady,
}: {
  value: string; onChange: (markdown: string) => void; className: string; editorLabel: string; placeholder: string; onActive: (keys: string[]) => void; onEditorReady: (editor: Editor) => void
}) {
  const onChangeRef = useRef(onChange)
  const onActiveRef = useRef(onActive)
  const isExternalUpdate = useRef(false)
  // The last markdown the editor itself emitted. The value-sync effect skips
  // re-applying a `value` that's just an echo of the user's own edit, so the
  // controlled `value` can't fight live editing (e.g. select-all + delete would
  // otherwise get restored by replaceAll).
  const lastEmittedRef = useRef(value)
  useEffect(() => { onChangeRef.current = onChange })
  useEffect(() => { onActiveRef.current = onActive })

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
          lastEmittedRef.current = md
          onChangeRef.current(md)
        })
      })
      .use(commonmark).use(gfm).use(history).use(listener).use(streaming).use(diff)
      .use(placeholderPlugin(placeholder))
      .use(activeStatePlugin((keys) => onActiveRef.current(keys))),
    []
  )

  const { loading, get: getEditor } = useEditor(editorFactory, [])
  const cleanupRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    return () => {
      cleanupRef.current?.()
    }
  }, [])

  useEffect(() => {
    if (loading) return
    const editor = getEditor()
    if (editor) {
      const cleanup = onEditorReady(editor)
      if (typeof cleanup === "function") cleanupRef.current = cleanup
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
    // Only re-apply genuinely external value changes — never an echo of what the
    // editor just emitted (which would clobber the user's in-flight edit).
    if (value !== currentMd && value !== lastEmittedRef.current) {
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
  value, onChange, className = "", editorLabel = "Edit note", placeholder = "Start writing…", toolbar = false,
}: ProseMirrorEditorProps) {
  const editorRef = useRef<Editor | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const [aiMenu, setAiMenu] = useState<{ x: number; y: number; from: number; to: number; text: string } | null>(null)
  const [aiStreaming, setAiStreaming] = useState<AiEditAction | null>(null)
  const [aiError, setAiError] = useState<string | null>(null)
  const [showAiUndo, setShowAiUndo] = useState<{ from: number; to: number; originalText: string } | null>(null)
  const [activeKeys, setActiveKeys] = useState<string[]>([])
  const activeSigRef = useRef("")
  // Only re-render the toolbar when the active-formatting set actually changes,
  // not on every cursor move.
  const handleActive = useCallback((keys: string[]) => {
    const sig = [...keys].sort().join(",")
    if (sig === activeSigRef.current) return
    activeSigRef.current = sig
    setActiveKeys(keys)
  }, [])

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

  // Apply a formatting command to the current selection, then return focus to
  // the editor so the user can keep typing. Buttons use onMouseDown/preventDefault
  // (below) so clicking the bar never steals the selection first.
  const runCommand = useCallback((cmdKey: CmdKey<unknown>, payload?: unknown) => {
    const editor = editorRef.current
    if (!editor) return
    // Focus first so the command runs against a live, focused selection, then
    // dispatch. (Buttons preventDefault on mousedown so the selection survives
    // the click.)
    editor.action((ctx) => ctx.get(editorViewCtx).focus())
    editor.action(callCommand(cmdKey, payload))
  }, [])

  const cancelAiEdit = useCallback(() => { abortRef.current?.abort(); abortRef.current = null; setAiStreaming(null); setAiMenu(null) }, [])
  const handleAiUndo = useCallback(() => {
    const editor = editorRef.current
    if (!editor || !showAiUndo) return
    const fullMd = editor.action(getMarkdown())
    onChange(fullMd.slice(0, showAiUndo.from) + showAiUndo.originalText + fullMd.slice(showAiUndo.to))
    setShowAiUndo(null)
  }, [showAiUndo, onChange])

  return (
    <div className={`flex min-h-0 flex-col ${className}`}>
      {toolbar && (
        <div className="pm-toolbar sticky top-0 z-10 mb-1 flex shrink-0 flex-wrap items-center gap-0.5 border-b border-border/50 bg-background/85 py-1.5 backdrop-blur" role="toolbar" aria-label="Formatting">
          {TOOLBAR_ITEMS.map((item, i) =>
            item.kind === "sep" ? (
              <span key={`sep-${i}`} className="mx-1 h-4 w-px bg-border/60" aria-hidden="true" />
            ) : (
              <button
                key={`${item.label}-${i}`}
                type="button"
                title={item.title}
                aria-label={item.title}
                aria-pressed={item.active ? activeKeys.includes(item.active) : undefined}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => runCommand(item.cmdKey, item.payload)}
                className={`flex h-7 min-w-7 items-center justify-center rounded-lg px-1.5 text-xs transition-colors hover:bg-muted hover:text-foreground ${
                  item.active && activeKeys.includes(item.active)
                    ? "bg-muted text-foreground"
                    : "text-muted-foreground"
                } ${item.className ?? ""}`}
              >
                {item.label}
              </button>
            )
          )}
        </div>
      )}
      <MilkdownProvider>
        <MilkdownEditorInner value={value} onChange={onChange} className="pm-editor min-h-0 flex-1" editorLabel={editorLabel} placeholder={placeholder} onActive={handleActive} onEditorReady={handleEditorReady} />
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
    </div>
  )
}

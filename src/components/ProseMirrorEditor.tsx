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
  turnIntoTextCommand,
  liftListItemCommand,
} from "@milkdown/kit/preset/commonmark"
import { lift } from "@milkdown/kit/prose/commands"
import { gfm, remarkGFMPlugin } from "@milkdown/kit/preset/gfm"
import { history, historyProviderConfig } from "@milkdown/kit/plugin/history"
import { listener, listenerCtx } from "@milkdown/kit/plugin/listener"
import { streaming, startStreamingCmd, pushChunkCmd, endStreamingCmd, abortStreamingCmd } from "@milkdown/plugin-streaming"
import { diff } from "@milkdown/plugin-diff"
import { Milkdown, MilkdownProvider, useEditor } from "@milkdown/react"
import { replaceAll, getMarkdown, callCommand, markdownToSlice, $prose } from "@milkdown/kit/utils"
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

function looksLikeMarkdown(text: string): boolean {
  const value = text.trim()
  if (!value) return false

  const blockSyntax =
    /(?:^|\n)\s{0,3}(?:#{1,6}\s+|>\s?|[-+*]\s+|\d+[.)]\s+|`{3,}|~{3,}|(?:-{3,}|_{3,}|\*{3,})\s*$|\|[^\n]+\|(?:\n|$))/m
  const inlineSyntax =
    /(?:\*\*[^*\n]+\*\*|__[^_\n]+__|~~[^~\n]+~~|`[^`\n]+`|!?\[[^\]\n]+\]\([^)]+\))/

  return blockSyntax.test(value) || inlineSyntax.test(value)
}

const markdownPastePlugin = $prose((ctx) => new Plugin({
  key: new PluginKey("markdown-paste"),
  props: {
    handlePaste(view, event) {
      const markdown = event.clipboardData?.getData("text/plain")
      if (!markdown || !looksLikeMarkdown(markdown)) return false

      try {
        const slice = markdownToSlice(markdown)(ctx)
        view.dispatch(view.state.tr.replaceSelection(slice).scrollIntoView())
        return true
      } catch {
        return false
      }
    },
  },
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
// Mark commands (bold/italic/code) toggle natively; block commands are one-way
// "apply" commands, so `off` declares how to undo them when the button is
// re-clicked while active: a Milkdown command key, or "lift" for wrapping
// nodes (blockquote) that ProseMirror's lift command unwraps.
type ToolbarItem =
  | { kind: "btn"; label: string; title: string; cmdKey: CmdKey<unknown>; payload?: unknown; className?: string; active?: string; off?: CmdKey<unknown> | "lift" }
  | { kind: "sep" }

// `wrapInHeadingCommand.key` is CmdKey<number>; normalize to CmdKey<unknown> so
// every item shares one type (the payload is forwarded untyped to callCommand).
const heading = wrapInHeadingCommand.key as unknown as CmdKey<unknown>
const toText = turnIntoTextCommand.key as unknown as CmdKey<unknown>
const liftListItem = liftListItemCommand.key as unknown as CmdKey<unknown>

const TOOLBAR_ITEMS: ToolbarItem[] = [
  { kind: "btn", label: "B", title: "Bold (⌘B)", cmdKey: toggleStrongCommand.key, className: "font-bold", active: "strong" },
  { kind: "btn", label: "I", title: "Italic (⌘I)", cmdKey: toggleEmphasisCommand.key, className: "italic", active: "emphasis" },
  { kind: "btn", label: "</>", title: "Inline code", cmdKey: toggleInlineCodeCommand.key, className: "font-mono text-[0.7rem]", active: "inlineCode" },
  { kind: "sep" },
  { kind: "btn", label: "H1", title: "Heading 1", cmdKey: heading, payload: 1, active: "h1", off: toText },
  { kind: "btn", label: "H2", title: "Heading 2", cmdKey: heading, payload: 2, active: "h2", off: toText },
  { kind: "btn", label: "H3", title: "Heading 3", cmdKey: heading, payload: 3, active: "h3", off: toText },
  { kind: "sep" },
  { kind: "btn", label: "•", title: "Bullet list", cmdKey: wrapInBulletListCommand.key, active: "bullet_list", off: liftListItem },
  { kind: "btn", label: "1.", title: "Numbered list", cmdKey: wrapInOrderedListCommand.key, active: "ordered_list", off: liftListItem },
  { kind: "btn", label: "❝", title: "Quote", cmdKey: wrapInBlockquoteCommand.key, active: "blockquote", off: "lift" },
  { kind: "btn", label: "{ }", title: "Code block", cmdKey: createCodeBlockCommand.key, className: "font-mono text-[0.7rem]", active: "code_block", off: toText },
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

  // The factory intentionally captures the initial `value`/`placeholder` only:
  // the editor is created once, later value changes flow through the sync
  // effect below (replaceAll), never through re-creation.
  const editorFactory = useCallback(
    (root: HTMLElement) => Editor.make()
      .config((ctx) => {
        ctx.set(rootCtx, root)
        ctx.set(defaultValueCtx, value)
        ctx.set(historyProviderConfig.key, { newGroupDelay: 10000 })
        // GFM strikethrough requires paired tildes. Treat single-tilde syntax
        // literally instead of incorrectly rendering values such as H~2~O as
        // deleted text (some Markdown dialects use that form for subscripts).
        ctx.set(remarkGFMPlugin.options.key, { singleTilde: false })
        const listenerManager = ctx.get(listenerCtx)
        listenerManager.markdownUpdated((_ctx, md) => {
          if (isExternalUpdate.current) return
          lastEmittedRef.current = md
          onChangeRef.current(md)
        })
      })
      .use(commonmark).use(gfm).use(history).use(listener).use(streaming).use(diff)
      .use(placeholderPlugin(placeholder))
      .use(activeStatePlugin((keys) => onActiveRef.current(keys)))
      .use(markdownPastePlugin),
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
  // Mirror of aiStreaming for the selection handler, which is bound once in
  // handleEditorReady and would otherwise close over a stale value.
  const aiStreamingRef = useRef<AiEditAction | null>(null)
  useEffect(() => { aiStreamingRef.current = aiStreaming }, [aiStreaming])
  const [aiError, setAiError] = useState<string | null>(null)
  // Full markdown snapshot from before the AI edit. Undo restores the whole
  // document — selection offsets are ProseMirror positions and can't be used
  // to splice the serialized markdown string.
  const [showAiUndo, setShowAiUndo] = useState<{ previousMarkdown: string } | null>(null)
  const [activeKeys, setActiveKeys] = useState<string[]>([])
  const activeSigRef = useRef("")
  // Latest active-formatting keys for event handlers (toolbar toggle-off
  // decisions) without re-binding them on every selection change.
  const activeKeysRef = useRef<string[]>([])
  const toolbarRef = useRef<HTMLDivElement | null>(null)
  const aiMenuRef = useRef<HTMLDivElement | null>(null)

  // The popup is fixed-position, so anything that moves the text under it
  // (scroll, resize) or shifts the user's attention elsewhere (mousedown
  // outside it) dismisses it — otherwise it lingers over the toolbar and
  // content. Suppressed while streaming so the Stop button stays reachable.
  useEffect(() => {
    if (!aiMenu) return
    const closeUnlessStreaming = () => {
      if (!aiStreamingRef.current) setAiMenu(null)
    }
    const onDocMouseDown = (e: MouseEvent) => {
      if (e.target instanceof Node && aiMenuRef.current?.contains(e.target)) return
      closeUnlessStreaming()
    }
    document.addEventListener("mousedown", onDocMouseDown, true)
    window.addEventListener("scroll", closeUnlessStreaming, true)
    window.addEventListener("resize", closeUnlessStreaming)
    return () => {
      document.removeEventListener("mousedown", onDocMouseDown, true)
      window.removeEventListener("scroll", closeUnlessStreaming, true)
      window.removeEventListener("resize", closeUnlessStreaming)
    }
  }, [aiMenu])
  // Only re-render the toolbar when the active-formatting set actually changes,
  // not on every cursor move.
  const handleActive = useCallback((keys: string[]) => {
    activeKeysRef.current = keys
    const sig = [...keys].sort().join(",")
    if (sig === activeSigRef.current) return
    activeSigRef.current = sig
    setActiveKeys(keys)
  }, [])

  const handleEditorReady = useCallback((editor: Editor) => {
    editorRef.current = editor
    const view = editor.action((ctx) => ctx.get(editorViewCtx))

    const updateMenu = () => {
      window.setTimeout(() => {
        if (aiStreamingRef.current) return
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
        // Never place the popup above the formatting toolbar — a selection
        // whose rect starts off-screen (select-all, tall drags) would
        // otherwise pin it over the toolbar/header.
        const minY = (toolbarRef.current?.getBoundingClientRect().bottom ?? 0) + 6
        const room = vBottom + h + 10 < window.innerHeight
        setAiError(null)
        setAiMenu({
          x: Math.max(8, Math.min(vLeft, window.innerWidth - w - 8)),
          y: Math.max(minY, room ? vBottom + 8 : vTop - h - 8),
          from, to, text,
        })
      }, 0)
    }

    const handleMouseUp = () => updateMenu()
    const handleKeyUp = (e: KeyboardEvent) => {
      // Escape dismisses; shortcut chords (⌘B, ⌘A…) and bare modifier
      // releases are formatting/navigation, not a "select for AI" gesture —
      // they must not summon or move the popup.
      if (e.key === "Escape") { setAiMenu(null); return }
      if (e.metaKey || e.ctrlKey || e.altKey) return
      if (e.key === "Meta" || e.key === "Control" || e.key === "Alt" || e.key === "Shift") return
      updateMenu()
    }

    view.dom.addEventListener("mouseup", handleMouseUp)
    view.dom.addEventListener("keyup", handleKeyUp)
    return () => {
      view.dom.removeEventListener("mouseup", handleMouseUp)
      view.dom.removeEventListener("keyup", handleKeyUp)
    }
  }, [])

  const runAiEdit = useCallback(async (action: AiEditAction) => {
    const editor = editorRef.current; const menu = aiMenu
    if (!editor || !menu || aiStreaming) return
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
      setShowAiUndo({ previousMarkdown: fullCtx })
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") editor.action(callCommand(abortStreamingCmd.key))
      else { setAiError(e instanceof Error ? e.message : "AI edit failed"); editor.action(callCommand(abortStreamingCmd.key)) }
    } finally { abortRef.current = null; setAiStreaming(null); setAiMenu(null) }
  }, [aiMenu, aiStreaming])

  // Apply a formatting command to the current selection, then return focus to
  // the editor so the user can keep typing. Buttons use onMouseDown/preventDefault
  // (below) so clicking the bar never steals the selection first.
  const runToolbarItem = useCallback((item: Extract<ToolbarItem, { kind: "btn" }>) => {
    const editor = editorRef.current
    if (!editor) return
    // Formatting from the toolbar dismisses the AI popup so the two never
    // fight over the same selection (kept open only mid-stream, for Stop).
    if (!aiStreamingRef.current) setAiMenu(null)
    // Focus first so the command runs against a live, focused selection, then
    // dispatch. (Buttons preventDefault on mousedown so the selection survives
    // the click.)
    editor.action((ctx) => ctx.get(editorViewCtx).focus())
    // Re-clicking an active block button toggles the formatting back off.
    const isActive = item.active ? activeKeysRef.current.includes(item.active) : false
    if (isActive && item.off) {
      if (item.off === "lift") {
        editor.action((ctx) => {
          const view = ctx.get(editorViewCtx)
          lift(view.state, view.dispatch)
        })
      } else {
        editor.action(callCommand(item.off))
      }
      return
    }
    editor.action(callCommand(item.cmdKey, item.payload))
  }, [])

  const cancelAiEdit = useCallback(() => { abortRef.current?.abort(); abortRef.current = null; setAiStreaming(null); setAiMenu(null) }, [])
  const handleAiUndo = useCallback(() => {
    const editor = editorRef.current
    if (!editor || !showAiUndo) return
    // replaceAll dispatches through the editor, so the markdownUpdated
    // listener fires and propagates the restored document via onChange.
    editor.action(replaceAll(showAiUndo.previousMarkdown))
    setShowAiUndo(null)
  }, [showAiUndo])

  return (
    <div className={`flex min-h-0 flex-col ${className}`}>
      {toolbar && (
        <div ref={toolbarRef} className="pm-toolbar sticky top-0 z-10 mb-4 flex shrink-0 flex-wrap items-center gap-0.5 rounded-xl border border-border/70 bg-background/95 p-1 shadow-sm backdrop-blur" role="toolbar" aria-label="Formatting">
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
                onClick={() => runToolbarItem(item)}
                className={`flex h-7 min-w-7 items-center justify-center rounded-lg px-1.5 text-xs font-medium transition-colors hover:bg-muted hover:text-foreground ${
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
        <div ref={aiMenuRef} className="fixed z-50 flex items-center gap-1 rounded-2xl border border-border/70 bg-card/95 p-1 shadow-xl backdrop-blur" style={{ left: aiMenu.x, top: aiMenu.y }} onMouseDown={(e) => e.preventDefault()}>
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

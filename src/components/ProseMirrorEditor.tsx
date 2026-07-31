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
  createCodeBlockCommand,
  insertHrCommand,
  turnIntoTextCommand,
  liftListItemCommand,
} from "@milkdown/kit/preset/commonmark"
import { lift } from "@milkdown/kit/prose/commands"
import { findWrapping } from "@milkdown/kit/prose/transform"
import { gfm, remarkGFMPlugin } from "@milkdown/kit/preset/gfm"
import { history, historyProviderConfig } from "@milkdown/kit/plugin/history"
import { listener, listenerCtx } from "@milkdown/kit/plugin/listener"
import { streaming, startStreamingCmd, pushChunkCmd, endStreamingCmd, abortStreamingCmd, streamingPluginKey } from "@milkdown/plugin-streaming"
import { diff } from "@milkdown/plugin-diff"
import { Milkdown, MilkdownProvider, useEditor } from "@milkdown/react"
import { replaceAll, getMarkdown, callCommand, markdownToSlice, $prose } from "@milkdown/kit/utils"
import { TextSelection, Plugin, PluginKey } from "@milkdown/kit/prose/state"
import type { Command, EditorState } from "@milkdown/kit/prose/state"
import { Decoration, DecorationSet } from "@milkdown/kit/prose/view"
import { NodeRange } from "@milkdown/kit/prose/model"
import type { Node as PMNode } from "@milkdown/kit/prose/model"
import { HugeiconsIcon } from "@hugeicons/react"
import { ArrowDown01Icon, ArrowUp01Icon, Cancel01Icon, Link01Icon, Search01Icon } from "@hugeicons/core-free-icons"
import { loadSnippets } from "@/lib/storage"
import { decodeHljsEntities, highlightCode } from "@/lib/highlight"
import { toast } from "@/components/ui/toaster"
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
// "custom" = the freeform "Ask AI" instruction typed into the selection popup.
type AiStreamKind = AiEditAction | "custom"

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

// Which formatting is active at the current selection, so the selection menu
// can light up the matching buttons. Mark/node names match the commonmark schema.
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
    key: new PluginKey("format-active"),
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

// Pasting a URL over a non-empty selection links the selected text instead of
// replacing it with the raw URL — the single most common linking gesture in
// modern editors. Bare-URL pastes with no selection fall through untouched.
const URL_LIKE = /^https?:\/\/\S+$/
const linkPastePlugin = $prose(() => new Plugin({
  key: new PluginKey("link-paste"),
  props: {
    handlePaste(view, event) {
      const { from, to, empty, $from } = view.state.selection
      if (empty || $from.parent.type.name === "code_block") return false
      const text = event.clipboardData?.getData("text/plain")?.trim()
      if (!text || !URL_LIKE.test(text)) return false
      const link = view.state.schema.marks.link
      if (!link) return false
      view.dispatch(view.state.tr.addMark(from, to, link.create({ href: text })).scrollIntoView())
      return true
    },
  },
}))

// Slash commands: "/" at the start of a block opens an insert menu. The plugin
// only *detects* the trigger and reports position + query to React, which
// renders the menu and owns the highlighted item; key events route back through
// `handlers.key` so Enter/arrows/Esc are deterministic and never reach the
// document. Anything that breaks the trigger (space, cursor move, selection)
// closes the menu naturally on the next view update.
interface SlashMenuState { from: number; to: number; query: string; x: number; y: number }
interface SlashMenuHandlers {
  streaming: () => boolean
  change: (s: SlashMenuState | null) => void
  key: (e: KeyboardEvent) => boolean
}
const slashMenuPlugin = (handlers: { current: SlashMenuHandlers }) =>
  $prose(() => new Plugin({
    key: new PluginKey("slash-menu"),
    view: () => ({
      update: (view) => {
        const api = handlers.current
        if (api.streaming()) { api.change(null); return }
        const { selection } = view.state
        const $from = selection.$from
        if (!selection.empty || !$from.parent.isTextblock || $from.parent.type.name === "code_block") {
          api.change(null); return
        }
        const before = $from.parent.textBetween(0, $from.parentOffset, "\ufffc", "\ufffc")
        const m = /^\/([^\s/]{0,24})$/.exec(before)
        if (!m) { api.change(null); return }
        const from = $from.pos - m[0].length
        const coords = view.coordsAtPos(from)
        api.change({
          from, to: $from.pos, query: m[1],
          x: Math.max(8, Math.min(coords.left, window.innerWidth - 268)),
          y: coords.bottom + 6,
        })
      },
    }),
    props: {
      handleKeyDown: (_view, event) => handlers.current.key(event),
    },
  }))

// Text-expansion shortcuts (";myemail" + space → the stored expansion, rendered
// as markdown). Snippets are read from storage at keystroke time, so Settings
// edits apply without recreating the editor. Single undo step restores the
// trigger if the expansion wasn't wanted.
function expandSnippetVars(text: string): string {
  const now = new Date()
  return text
    .replaceAll("{{date}}", now.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" }))
    .replaceAll("{{time}}", now.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }))
    .replaceAll("{{datetime}}", now.toLocaleString(undefined, { year: "numeric", month: "long", day: "numeric", hour: "numeric", minute: "2-digit" }))
}

const snippetExpandPlugin = $prose((ctx) => new Plugin({
  key: new PluginKey("snippet-expand"),
  props: {
    handleTextInput(view, from, to, text) {
      if (text !== " ") return false
      const $from = view.state.doc.resolve(from)
      if (!$from.parent.isTextblock || $from.parent.type.name === "code_block") return false
      const before = $from.parent.textBetween(
        Math.max(0, $from.parentOffset - 80),
        $from.parentOffset,
        "\ufffc",
        "\ufffc",
      )
      const match = /;([A-Za-z][A-Za-z0-9_-]{0,31})$/.exec(before)
      if (!match) return false
      const snippet = loadSnippets().find(
        (s) => s.trigger.trim().toLowerCase() === match[1].toLowerCase(),
      )
      if (!snippet) return false
      try {
        const slice = markdownToSlice(expandSnippetVars(snippet.expansion))(ctx)
        const start = from - match[0].length
        // Replace can reject a multi-block slice that doesn't fit at the
        // cursor — in that case leave the typed text alone.
        view.dispatch(view.state.tr.replace(start, to, slice).scrollIntoView())
        return true
      } catch {
        return false
      }
    },
  },
}))

// Syntax highlighting for code blocks, drawn as inline decorations from
// highlight.js token output. hljs emits HTML like <span class="hljs-keyword">
// over entity-escaped text; walking it with a stack maps each token back onto
// plain-text offsets inside the code_block node.
//
// Highlight ranges are cached per code_block node in a WeakMap. ProseMirror
// nodes are immutable/persistent: a node untouched by a transaction keeps its
// identity, so only code blocks that actually changed get re-highlighted —
// without this, every keystroke re-ran hljs over every block in the document.
// Ranges are stored relative to the node's content start and re-anchored to
// the node's current position when read back.
interface HighlightRange { from: number; to: number; cls: string }
const highlightCache = new WeakMap<PMNode, HighlightRange[]>()

function nodeHighlightRanges(node: PMNode): HighlightRange[] {
  const cached = highlightCache.get(node)
  if (cached) return cached
  const ranges: HighlightRange[] = []
  const code = node.textContent
  if (code.trim()) {
    try {
      const lang = typeof node.attrs.language === "string" ? node.attrs.language : ""
      const { html } = highlightCode(code, lang)
      let offset = 0
      const stack: string[] = []
      for (const m of html.matchAll(/<span class="([^"]+)">|<\/span>|[^<]+/g)) {
        const token = m[0]
        if (token.startsWith("<span")) {
          if (m[1]) stack.push(m[1])
          continue
        }
        if (token === "</span>") {
          stack.pop()
          continue
        }
        const text = decodeHljsEntities(token)
        if (stack.length > 0 && text.length > 0) {
          // Clamp to the node's content: a desynced token stream must never
          // produce an out-of-range decoration and take the editor down.
          const to = Math.min(offset + text.length, node.content.size)
          if (offset < to) ranges.push({ from: offset, to, cls: stack.join(" ") })
        }
        offset += text.length
      }
    } catch {
      // Highlighting is decorative — a failure must never break editing.
    }
  }
  highlightCache.set(node, ranges)
  return ranges
}

function buildCodeDecorations(doc: PMNode): DecorationSet {
  const decorations: Decoration[] = []
  doc.descendants((node, pos) => {
    if (node.type.name !== "code_block") return true
    const base = pos + 1
    for (const r of nodeHighlightRanges(node)) {
      decorations.push(Decoration.inline(base + r.from, base + r.to, { class: r.cls }))
    }
    return false
  })
  return DecorationSet.create(doc, decorations)
}

const codeHighlightPlugin = $prose(() => new Plugin({
  key: new PluginKey("code-highlight"),
  props: {
    decorations(state) {
      return buildCodeDecorations(state.doc)
    },
  },
}))

// "AI is writing" treatment, in the spirit of Notion AI / Raycast: while the
// streaming plugin applies chunks, the freshly written range [insertPos,
// insertEndPos] shimmers with a soft gradient sweep and a comet caret rides
// the stream head; when the stream ends the highlight settles out over ~0.8s
// instead of snapping off. All decorations — the document is never touched.
interface AiGlowState { settled: { from: number; to: number } | null }
const aiGlowKey = new PluginKey<AiGlowState>("ai-writing-glow")
const AI_GLOW_SETTLE_MS = 800

const aiWritingGlowPlugin = $prose(() => new Plugin({
  key: aiGlowKey,
  state: {
    init: (): AiGlowState => ({ settled: null }),
    apply(tr, value, oldState, newState): AiGlowState {
      const meta = tr.getMeta(aiGlowKey) as AiGlowState | undefined
      if (meta) return meta
      const was = streamingPluginKey.getState(oldState)?.active === true
      const now = streamingPluginKey.getState(newState)?.active === true
      if (now) return { settled: null }
      if (was && !now) {
        // Freeze the just-written range so it can fade out gracefully.
        const s = streamingPluginKey.getState(oldState)
        const from = s?.insertPos ?? null
        const to = s?.insertEndPos ?? null
        if (from != null && to != null && to > from) return { settled: { from, to } }
        return { settled: null }
      }
      if (value.settled && tr.docChanged) {
        const from = tr.mapping.map(value.settled.from, -1)
        const to = tr.mapping.map(value.settled.to, 1)
        return { settled: from < to ? { from, to } : null }
      }
      return value
    },
  },
  view: () => {
    let timer: ReturnType<typeof setTimeout> | null = null
    return {
      update: (view) => {
        // Root class hides the native caret while the comet rides the stream.
        const active = streamingPluginKey.getState(view.state)?.active === true
        view.dom.classList.toggle("pm-ai-active", active)
        const settled = aiGlowKey.getState(view.state)?.settled
        if (settled && !timer) {
          timer = setTimeout(() => {
            timer = null
            if (view.dom.isConnected) {
              view.dispatch(view.state.tr.setMeta(aiGlowKey, { settled: null }))
            }
          }, AI_GLOW_SETTLE_MS)
        }
      },
      destroy: () => { if (timer) clearTimeout(timer) },
    }
  },
  props: {
    decorations(state) {
      const s = streamingPluginKey.getState(state)
      if (s?.active && s.insertPos != null) {
        const from = Math.max(0, Math.min(s.insertPos, state.doc.content.size))
        const to = Math.max(from, Math.min(s.insertEndPos ?? from, state.doc.content.size))
        const decos: Decoration[] = []
        if (to > from) {
          decos.push(Decoration.inline(from, to, { class: "pm-ai-writing" }))
          // ::selection supports neither border-radius nor padding, so a
          // same-block selection over the sheen gets a second class that
          // paints a rounded, padded wash (ProseMirror merges classes on
          // overlaps, so bounds stay exact). A cross-block selection must NOT
          // get the wash: per-fragment pads there merge into one translucent
          // slab that cuts through the text geometry — the native
          // (brand-tinted) highlight, which tracks every line correctly,
          // is left to render instead.
          const sel = state.selection
          const selFrom = Math.max(from, sel.from)
          const selTo = Math.min(to, sel.to)
          if (!sel.empty && selFrom < selTo &&
              state.doc.resolve(selFrom).parent === state.doc.resolve(selTo).parent) {
            decos.push(Decoration.inline(selFrom, selTo, { class: "pm-ai-selected" }))
          }
        }
        decos.push(Decoration.widget(to, () => {
          const el = document.createElement("span")
          el.className = "pm-ai-caret"
          el.setAttribute("aria-hidden", "true")
          return el
        }, { side: 1, key: "pm-ai-caret" }))
        return DecorationSet.create(state.doc, decos)
      }
      const settled = aiGlowKey.getState(state)?.settled
      if (settled && settled.to > settled.from && settled.to <= state.doc.content.size) {
        return DecorationSet.create(state.doc, [
          Decoration.inline(settled.from, settled.to, { class: "pm-ai-settled" }),
        ])
      }
      return DecorationSet.empty
    },
  },
}))

// In-note find (⌘F): match ranges arrive via transaction meta from the find
// bar; on document edits they are remapped so highlights survive typing.
interface FindState { matches: { from: number; to: number }[]; active: number }
const findPluginKey = new PluginKey<FindState>("find-highlight")

const findHighlightPlugin = $prose(() => new Plugin({
  key: findPluginKey,
  state: {
    init: (): FindState => ({ matches: [], active: -1 }),
    apply(tr, value): FindState {
      const meta = tr.getMeta(findPluginKey) as FindState | undefined
      if (meta) return meta
      if (tr.docChanged) {
        return {
          ...value,
          matches: value.matches
            .map(m => ({ from: tr.mapping.map(m.from, -1), to: tr.mapping.map(m.to, 1) }))
            .filter(m => m.from < m.to),
        }
      }
      return value
    },
  },
  props: {
    decorations(state) {
      const v = findPluginKey.getState(state)
      if (!v || v.matches.length === 0) return DecorationSet.empty
      return DecorationSet.create(
        state.doc,
        v.matches.map((m, i) =>
          Decoration.inline(m.from, m.to, { class: i === v.active ? "pm-find-match pm-find-match-active" : "pm-find-match" })
        )
      )
    },
  },
}))

interface ProseMirrorEditorProps {
  value: string
  onChange: (markdown: string) => void
  className?: string
  editorLabel?: string
  placeholder?: string
  /** Show AI actions in the selection menu (the formatting rows always show). Defaults to true. */
  aiPopup?: boolean
}

// Selection-menu formatting. The sticky top toolbar was migrated into the
// Notion-style floating menu that appears over a text selection: inline marks
// as buttons, block types in a "Turn into" dropdown. `payload` is forwarded
// to commands that take one (heading level); the rest ignore it.
// Mark commands (bold/italic/code) toggle natively; block commands are one-way
// "apply" commands, so `off` declares how to undo them when the item is
// re-picked while active: a Milkdown command, or "lift" for wrapping
// nodes (blockquote) that ProseMirror's lift command unwraps.
//
// Items hold the command *plugin*, never its key: Milkdown's $command assigns
// `.key` lazily inside the plugin's prepare step, i.e. only while an editor is
// being created. This module evaluates before any editor exists, so reading
// `.key` at module scope snapshots `undefined` forever — every menu click
// then crashes inside CommandManager.get (undefined.id) and nothing applies.
// The key must be resolved at click time, when the editor (and its keys)
// definitely exists.
type CmdRef = { key: CmdKey<unknown> }

// One formatting command + how to toggle it back off. Shared by the inline
// buttons and the "Turn into" dropdown entries.
interface FormatCommand { cmd?: CmdRef; custom?: Command; payload?: unknown; active?: string; off?: CmdRef | "lift" }
type FormatItem = FormatCommand & { label: string; title: string; className?: string }
interface TurnIntoItem extends FormatCommand { id: string; label: string }

// Milkdown's WrapInBlockquote only tries the selection's innermost block
// range. Inside a list item (`paragraph block*`) a blockquote can't wrap the
// paragraph at index 0, so the stock command silently no-ops there — the
// button looks dead. This falls back to progressively outer ranges until one
// accepts the wrap, so quoting from inside a list item quotes the list.
const wrapInBlockquoteSmart: Command = (state, dispatch) => {
  const blockquote = state.schema.nodes.blockquote
  const range = state.selection.$from.blockRange(state.selection.$to)
  if (!blockquote || !range) return false
  for (let depth = range.depth; depth >= 0; depth--) {
    const r = depth === range.depth ? range : new NodeRange(state.selection.$from, state.selection.$to, depth)
    const wrapping = findWrapping(r, blockquote)
    if (wrapping) {
      if (dispatch) dispatch(state.tr.wrap(r, wrapping).scrollIntoView())
      return true
    }
  }
  return false
}

// `wrapInHeadingCommand.key` is CmdKey<number>; normalize to CmdKey<unknown> so
// every item shares one type (the payload is forwarded untyped to callCommand).
const heading = wrapInHeadingCommand as unknown as CmdRef
const toText = turnIntoTextCommand as unknown as CmdRef
const liftListItem = liftListItemCommand as unknown as CmdRef

// Inline-mark buttons on the selection menu's top row.
const INLINE_FORMAT: FormatItem[] = [
  { label: "B", title: "Bold (⌘B)", cmd: toggleStrongCommand, className: "font-bold", active: "strong" },
  { label: "I", title: "Italic (⌘I)", cmd: toggleEmphasisCommand, className: "italic", active: "emphasis" },
  { label: "</>", title: "Inline code", cmd: toggleInlineCodeCommand, className: "font-mono text-[0.7rem]", active: "inlineCode" },
]

// "Turn into" dropdown entries (the block type of the selection's block),
// Notion-style. id "text" is handled specially — it unwraps whatever block
// formatting is active (see turnIntoText). Picking the already-active entry
// toggles the formatting back off via `off`. The divider stays in the slash
// menu only: it inserts a node rather than turning a block into one.
const TURN_INTO_ITEMS: TurnIntoItem[] = [
  { id: "text", label: "Text" },
  { id: "h1", label: "Heading 1", active: "h1", cmd: heading, payload: 1, off: toText },
  { id: "h2", label: "Heading 2", active: "h2", cmd: heading, payload: 2, off: toText },
  { id: "h3", label: "Heading 3", active: "h3", cmd: heading, payload: 3, off: toText },
  { id: "bullet", label: "Bullet list", active: "bullet_list", cmd: wrapInBulletListCommand, off: liftListItem },
  { id: "ordered", label: "Numbered list", active: "ordered_list", cmd: wrapInOrderedListCommand, off: liftListItem },
  { id: "quote", label: "Quote", active: "blockquote", custom: wrapInBlockquoteSmart, off: "lift" },
  { id: "code", label: "Code block", active: "code_block", cmd: createCodeBlockCommand, off: toText },
]

// Slash-menu entries reuse the exact command refs of the selection menu so
// both paths always apply identical formatting. `keywords` is the filter
// corpus for the query typed after "/".
interface SlashItem { id: string; label: string; glyph: string; keywords: string; cmd?: CmdRef; custom?: Command; payload?: unknown }
const SLASH_ITEMS: SlashItem[] = [
  { id: "h1", label: "Heading 1", glyph: "H1", keywords: "h1 heading title big", cmd: heading, payload: 1 },
  { id: "h2", label: "Heading 2", glyph: "H2", keywords: "h2 heading subtitle section", cmd: heading, payload: 2 },
  { id: "h3", label: "Heading 3", glyph: "H3", keywords: "h3 heading subsection small", cmd: heading, payload: 3 },
  { id: "bullet", label: "Bullet list", glyph: "•", keywords: "bullet list unordered points ul", cmd: wrapInBulletListCommand },
  { id: "ordered", label: "Numbered list", glyph: "1.", keywords: "numbered ordered list steps ol", cmd: wrapInOrderedListCommand },
  { id: "quote", label: "Quote", glyph: "❝", keywords: "quote blockquote callout", custom: wrapInBlockquoteSmart },
  { id: "code", label: "Code block", glyph: "{ }", keywords: "code block snippet pre monospace", cmd: createCodeBlockCommand },
  { id: "divider", label: "Divider", glyph: "—", keywords: "divider horizontal rule separator hr line", cmd: insertHrCommand },
]

function MilkdownEditorInner({
  value, onChange, className, editorLabel, placeholder, onActive, onEditorReady, slashApiRef,
}: {
  value: string; onChange: (markdown: string) => void; className: string; editorLabel: string; placeholder: string; onActive: (keys: string[]) => void; onEditorReady: (editor: Editor) => void; slashApiRef: { current: SlashMenuHandlers }
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
      .use(markdownPastePlugin)
      .use(linkPastePlugin)
      .use(slashMenuPlugin(slashApiRef))
      .use(snippetExpandPlugin)
      .use(codeHighlightPlugin)
      .use(aiWritingGlowPlugin)
      .use(findHighlightPlugin),
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
  value, onChange, className = "", editorLabel = "Edit note", placeholder = "Start writing…", aiPopup = true,
}: ProseMirrorEditorProps) {
  const editorRef = useRef<Editor | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  // The selection menu's dwell timer and the selection range the user
  // explicitly dismissed — it stays closed until a different range is
  // selected, so closing it doesn't just resummon on the next keyup.
  const aiMenuTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const aiMenuDismissedRef = useRef<{ from: number; to: number } | null>(null)
  // Remember the selection the user walked away from so the popup doesn't
  // resummon for that exact range on the next keyup — selecting a different
  // range re-arms it (the equality check in updateMenu no longer matches).
  const markAiMenuDismissed = useCallback(() => {
    const v = editorRef.current?.action((ctx) => ctx.get(editorViewCtx))
    if (!v) return
    const { from, to } = v.state.selection
    if (from !== to) aiMenuDismissedRef.current = { from, to }
  }, [])
  // Cancel any in-flight AI stream on unmount (e.g. navigating away
  // mid-stream): stops the fetch and prevents commands landing on a
  // destroyed editor.
  useEffect(() => () => { abortRef.current?.abort() }, [])
  const [aiMenu, setAiMenu] = useState<{ x: number; y: number; from: number; to: number; text: string } | null>(null)
  // Mirror of the open popup's selection range for the selection handler:
  // if the selection moves on (mid-gesture drift), the popup must close
  // immediately rather than chase the gesture with a stale range.
  const aiMenuRangeRef = useRef<{ from: number; to: number } | null>(null)
  useEffect(() => {
    aiMenuRangeRef.current = aiMenu ? { from: aiMenu.from, to: aiMenu.to } : null
  }, [aiMenu])
  const [aiStreaming, setAiStreaming] = useState<AiStreamKind | null>(null)
  // Mirror of aiStreaming for the selection handler, which is bound once in
  // handleEditorReady and would otherwise close over a stale value.
  const aiStreamingRef = useRef<AiStreamKind | null>(null)
  useEffect(() => { aiStreamingRef.current = aiStreaming }, [aiStreaming])
  const [aiCustomInput, setAiCustomInput] = useState("")
  // Full markdown snapshot from before the AI edit. Undo restores the whole
  // document — selection offsets are ProseMirror positions and can't be used
  // to splice the serialized markdown string.
  const aiUndoMarkdownRef = useRef<string | null>(null)
  const [activeKeys, setActiveKeys] = useState<string[]>([])
  const activeSigRef = useRef("")
  // Latest active-formatting keys for event handlers (menu toggle-off
  // decisions) without re-binding them on every selection change.
  const activeKeysRef = useRef<string[]>([])
  const aiMenuRef = useRef<HTMLDivElement | null>(null)

  // --- Slash commands ("/") ---------------------------------------------
  // `slash` mirrors what the plugin reports; sig-deduped like the
  // active-formatting state so view updates don't re-render on every keystroke.
  const [slash, setSlash] = useState<SlashMenuState | null>(null)
  const slashRef = useRef<SlashMenuState | null>(null)
  const slashSigRef = useRef("")
  const [slashIndex, setSlashIndex] = useState(0)
  const slashIndexRef = useRef(0)
  const slashMenuRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => { slashIndexRef.current = slashIndex }, [slashIndex])

  const closeSlash = useCallback(() => {
    slashSigRef.current = ""
    slashRef.current = null
    setSlash(null)
    setSlashIndex(0)
  }, [])

  const handleSlashChange = useCallback((s: SlashMenuState | null) => {
    const sig = s ? `${s.from}:${s.to}:${s.query}` : ""
    if (sig === slashSigRef.current) return
    slashSigRef.current = sig
    slashRef.current = s
    setSlash(s)
    setSlashIndex(0)
  }, [])

  const applySlash = useCallback((item: SlashItem) => {
    const editor = editorRef.current
    const s = slashRef.current
    closeSlash()
    if (!editor || !s) return
    // Remove the "/query" trigger text, then run the command where it stood.
    editor.action((ctx) => {
      const view = ctx.get(editorViewCtx)
      view.focus()
      view.dispatch(view.state.tr.delete(s.from, s.to))
    })
    if (item.custom) {
      editor.action((ctx) => {
        const view = ctx.get(editorViewCtx)
        item.custom!(view.state, view.dispatch, view)
      })
    } else if (item.cmd) {
      editor.action(callCommand(item.cmd.key, item.payload))
    }
  }, [closeSlash])
  const applySlashRef = useRef(applySlash)
  useEffect(() => { applySlashRef.current = applySlash }, [applySlash])

  // Deterministic keyboard contract while the menu is open: arrows move,
  // Enter applies, Esc closes — all swallowed so the document never sees them.
  const handleSlashKey = useCallback((e: KeyboardEvent): boolean => {
    const s = slashRef.current
    if (!s) return false
    if (e.key === "Escape") { closeSlash(); return true }
    const q = s.query.toLowerCase()
    const items = SLASH_ITEMS.filter((i) => !q || i.keywords.includes(q) || i.label.toLowerCase().includes(q))
    if (items.length === 0) return false
    if (e.key === "ArrowDown") { setSlashIndex((i) => (i + 1) % items.length); return true }
    if (e.key === "ArrowUp") { setSlashIndex((i) => (i - 1 + items.length) % items.length); return true }
    if (e.key === "Enter") { applySlashRef.current(items[Math.min(slashIndexRef.current, items.length - 1)]); return true }
    return false
  }, [closeSlash])

  // Handlers object handed to the plugin at editor-creation time. The plugin
  // reads `.current` at event time, so late assignment here is safe.
  const slashApiRef = useRef<SlashMenuHandlers>({ streaming: () => false, change: () => {}, key: () => false })
  useEffect(() => {
    slashApiRef.current = {
      streaming: () => aiStreamingRef.current !== null,
      change: handleSlashChange,
      key: handleSlashKey,
    }
  }, [handleSlashChange, handleSlashKey])

  // Scroll/resize/click-outside dismiss the menu; it is fixed-position over
  // the caret and must not linger detached from its anchor.
  useEffect(() => {
    if (!slash) return
    const onDocMouseDown = (e: MouseEvent) => {
      if (e.target instanceof Node && slashMenuRef.current?.contains(e.target)) return
      closeSlash()
    }
    document.addEventListener("mousedown", onDocMouseDown, true)
    window.addEventListener("scroll", closeSlash, true)
    window.addEventListener("resize", closeSlash)
    return () => {
      document.removeEventListener("mousedown", onDocMouseDown, true)
      window.removeEventListener("scroll", closeSlash, true)
      window.removeEventListener("resize", closeSlash)
    }
  }, [slash, closeSlash])

  // The selection menu is fixed-position, so anything that moves the text
  // under it (scroll, resize) or shifts the user's attention elsewhere
  // (mousedown outside it) dismisses it — otherwise it lingers detached over
  // the content. Suppressed while streaming so the Stop button stays reachable.
  useEffect(() => {
    if (!aiMenu) return
    const closeUnlessStreaming = () => {
      if (!aiStreamingRef.current) { markAiMenuDismissed(); setAiMenu(null) }
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
  }, [aiMenu, markAiMenuDismissed])
  // Only re-render the menu when the active-formatting set actually changes,
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
      if (aiMenuTimerRef.current) clearTimeout(aiMenuTimerRef.current)
      // Close immediately on collapse/short selection so typing-to-replace
      // and cursor moves stay snappy; only *showing* is dwell-delayed.
      const v0 = editor.action((ctx) => ctx.get(editorViewCtx))
      if (!v0) return
      const sel0 = v0.state.selection
      // Popup already open but the selection moved on (user still dragging or
      // shift-extending)? Close it now — the dwell will re-summon it for the
      // settled range. Never leave it hovering over a stale selection.
      const openRange = aiMenuRangeRef.current
      if (openRange && (sel0.from !== openRange.from || sel0.to !== openRange.to)) setAiMenu(null)
      const text0 = v0.state.doc.textBetween(sel0.from, sel0.to, "\n").trim()
      if (sel0.empty || text0.length < 3) { setAiMenu(null); return }
      aiMenuTimerRef.current = window.setTimeout(() => {
        aiMenuTimerRef.current = null
        if (aiStreamingRef.current) return
        const v = editor.action((ctx) => ctx.get(editorViewCtx))
        if (!v || !v.hasFocus()) return
        const { from, to, empty } = v.state.selection
        // The selection must be the one the dwell started on — if the user
        // is still dragging or shift-extending, don't pop up mid-gesture.
        if (from !== sel0.from || to !== sel0.to) return
        const text = v.state.doc.textBetween(from, to, "\n").trim()
        if (empty || text.length < 3) { setAiMenu(null); return }
        // Explicitly dismissed for this exact selection — stay closed until
        // a different range is selected.
        const dismissed = aiMenuDismissedRef.current
        if (dismissed && dismissed.from === from && dismissed.to === to) return
        const startCoords = v.coordsAtPos(from)
        const endCoords = v.coordsAtPos(to)
        const sel = window.getSelection()
        const selRect = sel && sel.rangeCount > 0 ? sel.getRangeAt(0).getBoundingClientRect() : null
        const vTop = selRect && selRect.height > 0 ? selRect.top : startCoords.top
        const vBottom = selRect && selRect.height > 0 ? selRect.bottom : endCoords.bottom
        const vLeft = selRect && selRect.width > 0 ? selRect.left : startCoords.left
        const h = 116; const w = 340
        // Never place the menu off the top edge — a selection whose rect
        // starts off-screen (select-all, tall drags) would otherwise pin it
        // over the header.
        const minY = 6
        const room = vBottom + h + 10 < window.innerHeight
        setAiMenu({
          x: Math.max(8, Math.min(vLeft, window.innerWidth - w - 8)),
          y: Math.max(minY, room ? vBottom + 8 : vTop - h - 8),
          from, to, text,
        })
      }, 300) // dwell: only summon when the selection settles
    }

    const handleMouseUp = () => updateMenu()
    const handleKeyUp = (e: KeyboardEvent) => {
      // Escape dismisses; shortcut chords (⌘B, ⌘A…) and bare modifier
      // releases are formatting/navigation, not a deliberate selection
      // gesture — they must not summon or move the menu.
      if (e.key === "Escape") { markAiMenuDismissed(); setAiMenu(null); return }
      if (e.metaKey || e.ctrlKey || e.altKey) return
      if (e.key === "Meta" || e.key === "Control" || e.key === "Alt" || e.key === "Shift") return
      updateMenu()
    }

    view.dom.addEventListener("mouseup", handleMouseUp)
    view.dom.addEventListener("keyup", handleKeyUp)
    return () => {
      if (aiMenuTimerRef.current) clearTimeout(aiMenuTimerRef.current)
      view.dom.removeEventListener("mouseup", handleMouseUp)
      view.dom.removeEventListener("keyup", handleKeyUp)
    }
  }, [markAiMenuDismissed])

  const runAiEdit = useCallback(async (action: AiStreamKind, customInstruction?: string) => {
    const editor = editorRef.current; const menu = aiMenu
    if (!editor || !menu || aiStreaming) return
    if (action === "custom" && !customInstruction?.trim()) return
    aiUndoMarkdownRef.current = null
    toast.dismiss("ai-edit-undo")
    const fullCtx = editor.action(getMarkdown())
    abortRef.current?.abort(); const ctrl = new AbortController(); abortRef.current = ctrl
    const shown = action === "custom" ? customInstruction!.trim() : AI_INSTRUCTIONS[action]
    setAiStreaming(action); setAiMenu({ ...menu, text: shown })
    if (action === "custom") setAiCustomInput("")
    try {
      editor.action(callCommand(startStreamingCmd.key, { insertAt: "selection" }))
      const { streamRewriteSelection, streamCustomEdit } = await import("@/lib/ai-service")
      const gen = action === "custom"
        ? streamCustomEdit(menu.text, customInstruction!.trim(), fullCtx, ctrl.signal)
        : streamRewriteSelection(menu.text, action, fullCtx, ctrl.signal)
      for await (const chunk of gen) {
        editor.action(callCommand(pushChunkCmd.key, chunk))
      }
      editor.action(callCommand(endStreamingCmd.key))
      aiUndoMarkdownRef.current = fullCtx
      toast("AI edit applied", {
        id: "ai-edit-undo",
        action: {
          label: "Undo",
          onClick: () => {
            const prev = aiUndoMarkdownRef.current
            if (!prev) return
            // replaceAll dispatches through the editor, so the markdownUpdated
            // listener fires and propagates the restored document via onChange.
            editorRef.current?.action(replaceAll(prev))
            aiUndoMarkdownRef.current = null
          },
        },
      })
    } catch (e) {
      if (!(e instanceof DOMException && e.name === "AbortError")) {
        toast.error(e instanceof Error ? e.message : "AI edit failed")
      }
      try {
        editor.action(callCommand(abortStreamingCmd.key))
      } catch {
        // The editor was destroyed while the stream was in flight (navigated
        // away) — nothing left to abort in the document.
      }
    } finally { abortRef.current = null; setAiStreaming(null); setAiMenu(null) }
  }, [aiMenu, aiStreaming])

  // Apply a formatting command to the current selection, then return focus to
  // the editor so the user can keep typing. Buttons use onMouseDown/preventDefault
  // (below) so clicking the menu never steals the selection first. The menu
  // stays open so the user can stack bold + italic + link on one selection.
  const runFormatItem = useCallback((item: FormatCommand) => {
    const editor = editorRef.current
    if (!editor) return
    // Focus first so the command runs against a live, focused selection, then
    // dispatch. (Buttons preventDefault on mousedown so the selection survives
    // the click.)
    editor.action((ctx) => ctx.get(editorViewCtx).focus())
    // Re-picking an active block item toggles the formatting back off.
    const isActive = item.active ? activeKeysRef.current.includes(item.active) : false
    if (isActive && item.off) {
      if (item.off === "lift") {
        editor.action((ctx) => {
          const view = ctx.get(editorViewCtx)
          lift(view.state, view.dispatch)
        })
      } else {
        editor.action(callCommand(item.off.key))
      }
      return
    }
    // `.key` is resolved here — not at module scope — because $command only
    // assigns it during editor creation (see FormatCommand above).
    if (item.custom) {
      editor.action((ctx) => {
        const view = ctx.get(editorViewCtx)
        item.custom!(view.state, view.dispatch, view)
      })
    } else if (item.cmd) {
      editor.action(callCommand(item.cmd.key, item.payload))
    }
  }, [])

  // --- "Turn into" dropdown (Notion-style block switcher) ------------------
  const [turnIntoOpen, setTurnIntoOpen] = useState(false)
  const turnIntoRef = useRef<HTMLDivElement | null>(null)

  // "Text" unwraps whichever block formatting is active: lift out of lists
  // and quotes, turn headings/code blocks back into plain paragraphs.
  const turnIntoText = useCallback(() => {
    const editor = editorRef.current
    if (!editor) return
    const keys = activeKeysRef.current
    editor.action((ctx) => ctx.get(editorViewCtx).focus())
    if (keys.includes("bullet_list") || keys.includes("ordered_list")) {
      editor.action(callCommand(liftListItem.key))
    } else if (keys.includes("blockquote")) {
      editor.action((ctx) => {
        const view = ctx.get(editorViewCtx)
        lift(view.state, view.dispatch)
      })
    } else if (keys.some((k) => k === "code_block" || /^h[1-6]$/.test(k))) {
      editor.action(callCommand(toText.key))
    }
  }, [])

  const applyTurnInto = useCallback((item: TurnIntoItem) => {
    setTurnIntoOpen(false)
    if (item.id === "text") { turnIntoText(); return }
    runFormatItem(item)
  }, [runFormatItem, turnIntoText])

  // Mousedown anywhere outside the dropdown closes just it (the menu itself
  // has its own dismissal); scroll/resize close the whole menu already.
  useEffect(() => {
    if (!turnIntoOpen) return
    const onDocMouseDown = (e: MouseEvent) => {
      if (e.target instanceof Node && turnIntoRef.current?.contains(e.target)) return
      setTurnIntoOpen(false)
    }
    document.addEventListener("mousedown", onDocMouseDown, true)
    return () => document.removeEventListener("mousedown", onDocMouseDown, true)
  }, [turnIntoOpen])

  const cancelAiEdit = useCallback(() => { abortRef.current?.abort(); abortRef.current = null; setAiStreaming(null); markAiMenuDismissed(); setAiMenu(null) }, [markAiMenuDismissed])

  // --- Inline link editing on the selection popup -------------------------
  // linkDraft is null while closed; opening prefills the selection's existing
  // href (if any) so editing a link is as fast as adding one.
  const [linkDraft, setLinkDraft] = useState<string | null>(null)
  // Menu closed → dropdown and link input reset with it, so a reopened menu
  // always starts clean, not on a stale half-typed URL or an open dropdown.
  useEffect(() => { if (!aiMenu) { setTurnIntoOpen(false); setLinkDraft(null) } }, [aiMenu])

  const openLinkDraft = useCallback(() => {
    const menu = aiMenu
    if (!menu) return
    let existing = ""
    editorRef.current?.action((ctx) => {
      const view = ctx.get(editorViewCtx)
      const linkType = view.state.schema.marks.link
      if (!linkType) return
      const $from = view.state.doc.resolve(Math.min(menu.from, view.state.doc.content.size))
      const $to = view.state.doc.resolve(Math.min(menu.to, view.state.doc.content.size))
      const marks = $from.marksAcross($to) ?? []
      const found = marks.find((m) => m.type === linkType)
      existing = typeof found?.attrs.href === "string" ? found.attrs.href : ""
    })
    setLinkDraft(existing)
  }, [aiMenu])

  // Enter applies; an empty field removes the link. Scheme-less input gets
  // https:// so "example.com" works as typed.
  const applyLinkDraft = useCallback((raw: string) => {
    const editor = editorRef.current
    const menu = aiMenu
    setLinkDraft(null)
    if (!editor || !menu) return
    editor.action((ctx) => {
      const view = ctx.get(editorViewCtx)
      const linkType = view.state.schema.marks.link
      if (!linkType) return
      const from = Math.min(menu.from, view.state.doc.content.size)
      const to = Math.min(menu.to, view.state.doc.content.size)
      if (from >= to) return
      const value = raw.trim()
      const tr = view.state.tr
      if (value) {
        const href = /^[a-z][a-z0-9+.-]*:/i.test(value) ? value : `https://${value}`
        tr.addMark(from, to, linkType.create({ href }))
      } else {
        tr.removeMark(from, to, linkType)
      }
      view.dispatch(tr)
      view.focus()
    })
  }, [aiMenu])

  // --- In-note find (⌘F) ------------------------------------------------
  const [findOpen, setFindOpen] = useState(false)
  const [findQuery, setFindQuery] = useState("")
  const [findIndex, setFindIndex] = useState(-1)
  const [findCount, setFindCount] = useState(0)
  const findInputRef = useRef<HTMLInputElement | null>(null)
  const findMatchesRef = useRef<{ from: number; to: number }[]>([])
  const findIndexRef = useRef(-1)

  const computeFindMatches = useCallback((query: string) => {
    const editor = editorRef.current
    if (!editor) return []
    return editor.action((ctx) => {
      const view = ctx.get(editorViewCtx)
      const q = query.trim().toLowerCase()
      const out: { from: number; to: number }[] = []
      if (!q) return out
      view.state.doc.descendants((node, pos) => {
        if (out.length >= 200) return false
        if (!node.isText || !node.text) return true
        const hay = node.text.toLowerCase()
        let i = hay.indexOf(q)
        while (i !== -1 && out.length < 200) {
          out.push({ from: pos + i, to: pos + i + q.length })
          i = hay.indexOf(q, i + 1)
        }
        return true
      })
      return out
    })
  }, [])

  const syncFindDecorations = useCallback((matches: { from: number; to: number }[], active: number) => {
    editorRef.current?.action((ctx) => {
      const view = ctx.get(editorViewCtx)
      view.dispatch(view.state.tr.setMeta(findPluginKey, { matches, active }))
    })
  }, [])

  // App dispatches open-note-find on ⌘F while the editor view is active.
  useEffect(() => {
    const handler = () => {
      setFindOpen(true)
      requestAnimationFrame(() => { findInputRef.current?.focus(); findInputRef.current?.select() })
    }
    window.addEventListener("open-note-find", handler)
    return () => window.removeEventListener("open-note-find", handler)
  }, [])

  // Recompute matches when the query or document changes while the bar is open.
  useEffect(() => {
    if (!findOpen) return
    const matches = computeFindMatches(findQuery)
    findMatchesRef.current = matches
    setFindCount(matches.length)
    const idx = matches.length === 0 ? -1 : Math.min(Math.max(findIndexRef.current, 0), matches.length - 1)
    findIndexRef.current = idx
    setFindIndex(idx)
    syncFindDecorations(matches, idx)
  }, [findOpen, findQuery, value, computeFindMatches, syncFindDecorations])

  const jumpFind = useCallback((dir: 1 | -1) => {
    const matches = findMatchesRef.current
    if (matches.length === 0) return
    const next = ((findIndexRef.current < 0 ? (dir === 1 ? -1 : 0) : findIndexRef.current) + dir + matches.length) % matches.length
    findIndexRef.current = next
    setFindIndex(next)
    const m = matches[next]
    editorRef.current?.action((ctx) => {
      const view = ctx.get(editorViewCtx)
      const tr = view.state.tr.setSelection(TextSelection.create(view.state.doc, m.from, m.to))
      view.dispatch(tr.scrollIntoView().setMeta(findPluginKey, { matches, active: next }))
    })
  }, [])

  const closeFind = useCallback(() => {
    setFindOpen(false)
    setFindQuery("")
    findIndexRef.current = -1
    setFindIndex(-1)
    findMatchesRef.current = []
    setFindCount(0)
    syncFindDecorations([], -1)
  }, [syncFindDecorations])

  // Bridge for app-level AI streams: note-editor's Enhance dispatches these
  // window events so generated notes write into the editor live through the
  // milkdown streaming plugin (incremental, history-friendly) instead of a
  // full replaceAll per chunk — and get the same glow as selection edits.
  useEffect(() => {
    const start = () => {
      const editor = editorRef.current
      if (!editor) return
      editor.action(replaceAll(""))
      editor.action((ctx) => {
        const view = ctx.get(editorViewCtx)
        view.dispatch(view.state.tr.setSelection(TextSelection.atEnd(view.state.doc)))
      })
      editor.action(callCommand(startStreamingCmd.key, { insertAt: "cursor" }))
    }
    const chunk = (e: Event) => {
      const text = (e as CustomEvent<string>).detail
      if (typeof text !== "string" || !text) return
      editorRef.current?.action(callCommand(pushChunkCmd.key, text))
    }
    const end = () => { editorRef.current?.action(callCommand(endStreamingCmd.key)) }
    const abort = () => { editorRef.current?.action(callCommand(abortStreamingCmd.key, { keep: true })) }
    window.addEventListener("editor-stream-start", start)
    window.addEventListener("editor-stream-chunk", chunk)
    window.addEventListener("editor-stream-end", end)
    window.addEventListener("editor-stream-abort", abort)
    return () => {
      window.removeEventListener("editor-stream-start", start)
      window.removeEventListener("editor-stream-chunk", chunk)
      window.removeEventListener("editor-stream-end", end)
      window.removeEventListener("editor-stream-abort", abort)
    }
  }, [])

  // Label for the "Turn into" trigger: the selection's current block type.
  const currentBlockLabel = TURN_INTO_ITEMS.find((t) => t.active && activeKeys.includes(t.active))?.label ?? "Text"
  // Flip the dropdown upward when the menu sits too low for ~8 rows below it.
  const turnIntoDropUp = aiMenu !== null && aiMenu.y + 380 > window.innerHeight

  return (
    <div className={`flex min-h-0 flex-col ${className}`}>
      {findOpen && (
        <div className="mb-2 flex shrink-0 items-center gap-2 rounded-md border border-border/70 bg-muted/30 px-3 py-1.5" role="search" aria-label="Find in note">
          <HugeiconsIcon icon={Search01Icon} strokeWidth={2} className="size-3.5 shrink-0 text-muted-foreground" />
          <input
            ref={findInputRef}
            value={findQuery}
            onChange={(e) => { findIndexRef.current = -1; setFindQuery(e.target.value) }}
            onKeyDown={(e) => {
              if (e.key === "Enter") { e.preventDefault(); jumpFind(e.shiftKey ? -1 : 1) }
              else if (e.key === "Escape") { e.preventDefault(); closeFind() }
            }}
            placeholder="Find in note…"
            className="h-6 w-48 bg-transparent text-xs outline-none placeholder:text-muted-foreground/60"
          />
          <span className="min-w-12 text-[11px] text-muted-foreground tabular-nums">
            {findQuery && (findCount === 0 ? "No results" : `${findIndex + 1}/${findCount}`)}
          </span>
          <button
            type="button"
            onClick={() => jumpFind(-1)}
            disabled={findCount === 0}
            aria-label="Previous match"
            title="Previous (⇧↵)"
            className="rounded p-0.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-40"
          >
            <HugeiconsIcon icon={ArrowUp01Icon} strokeWidth={2} className="size-3.5" />
          </button>
          <button
            type="button"
            onClick={() => jumpFind(1)}
            disabled={findCount === 0}
            aria-label="Next match"
            title="Next (↵)"
            className="rounded p-0.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-40"
          >
            <HugeiconsIcon icon={ArrowDown01Icon} strokeWidth={2} className="size-3.5" />
          </button>
          <button
            type="button"
            onClick={closeFind}
            aria-label="Close find"
            className="ml-auto rounded p-0.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <HugeiconsIcon icon={Cancel01Icon} strokeWidth={2} className="size-3.5" />
          </button>
        </div>
      )}
      <MilkdownProvider>
        <MilkdownEditorInner value={value} onChange={onChange} className="pm-editor min-h-0 flex-1" editorLabel={editorLabel} placeholder={placeholder} onActive={handleActive} onEditorReady={handleEditorReady} slashApiRef={slashApiRef} />
      </MilkdownProvider>
      {slash && (() => {
        const q = slash.query.toLowerCase()
        const items = SLASH_ITEMS.filter((i) => !q || i.keywords.includes(q) || i.label.toLowerCase().includes(q))
        if (items.length === 0) return null
        const hl = Math.min(slashIndex, items.length - 1)
        return (
          <div
            ref={slashMenuRef}
            role="listbox"
            aria-label="Insert block"
            className="fixed z-50 w-64 overflow-hidden rounded-lg border border-border/70 bg-card/95 p-1 shadow-xl backdrop-blur"
            style={{ left: slash.x, top: slash.y }}
            onMouseDown={(e) => e.preventDefault()}
          >
            <p className="px-2 pb-0.5 pt-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60">Insert block</p>
            {items.map((item, i) => (
              <button
                key={item.id}
                type="button"
                role="option"
                aria-selected={i === hl}
                onMouseEnter={() => setSlashIndex(i)}
                onClick={() => applySlash(item)}
                className={`flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-xs transition-colors ${
                  i === hl ? "bg-muted text-foreground" : "text-muted-foreground"
                }`}
              >
                <span className="flex h-6 w-7 shrink-0 items-center justify-center rounded border border-border/60 bg-background font-mono text-[10px]">{item.glyph}</span>
                <span className="min-w-0 flex-1 truncate">{item.label}</span>
              </button>
            ))}
          </div>
        )
      })()}
      {aiMenu && (
        <div
          ref={aiMenuRef}
          className="fixed z-50 flex flex-col gap-1 rounded-lg border border-border/70 bg-card/95 p-1 shadow-xl backdrop-blur"
          style={{ left: aiMenu.x, top: aiMenu.y }}
          // Clicking buttons must not steal the editor selection — but the
          // custom-instruction input needs focus, so let its mousedown through.
          onMouseDown={(e) => { if (!(e.target instanceof HTMLInputElement)) e.preventDefault() }}
        >
          <div className="flex items-center gap-0.5 border-b border-border/60 pb-1">
            {/* Turn into — the block type of the selection's block */}
            <div ref={turnIntoRef} className="relative">
              <button
                type="button"
                title="Turn into"
                aria-label="Turn into"
                aria-haspopup="listbox"
                aria-expanded={turnIntoOpen}
                onClick={() => setTurnIntoOpen((v) => !v)}
                className="flex h-7 items-center gap-1 rounded px-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                <span className="max-w-24 truncate">{currentBlockLabel}</span>
                <HugeiconsIcon icon={ArrowDown01Icon} strokeWidth={2} className={`size-3 shrink-0 transition-transform ${turnIntoOpen ? "rotate-180" : ""}`} />
              </button>
              {turnIntoOpen && (
                <div
                  role="listbox"
                  aria-label="Turn into"
                  className={`absolute left-0 z-10 w-40 overflow-hidden rounded-md border border-border/70 bg-card/95 p-1 shadow-xl backdrop-blur ${turnIntoDropUp ? "bottom-full mb-1" : "top-full mt-1"}`}
                >
                  {TURN_INTO_ITEMS.map((t) => {
                    const isActive = t.id === "text"
                      ? !TURN_INTO_ITEMS.some((o) => o.active && activeKeys.includes(o.active))
                      : (t.active ? activeKeys.includes(t.active) : false)
                    return (
                      <button
                        key={t.id}
                        type="button"
                        role="option"
                        aria-selected={isActive}
                        onClick={() => applyTurnInto(t)}
                        className={`flex w-full items-center rounded px-2 py-1.5 text-left text-xs transition-colors ${
                          isActive ? "bg-muted font-medium text-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground"
                        }`}
                      >
                        {t.label}
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
            <span className="mx-1 h-4 w-px bg-border/60" aria-hidden="true" />
            {INLINE_FORMAT.map((item, i) => (
              <button
                key={`${item.label}-${i}`}
                type="button"
                title={item.title}
                aria-label={item.title}
                aria-pressed={item.active ? activeKeys.includes(item.active) : undefined}
                onClick={() => runFormatItem(item)}
                className={`flex h-7 min-w-7 items-center justify-center rounded px-1.5 text-xs font-medium transition-colors hover:bg-muted hover:text-foreground ${
                  item.active && activeKeys.includes(item.active)
                    ? "bg-muted text-foreground"
                    : "text-muted-foreground"
                } ${item.className ?? ""}`}
              >
                {item.label}
              </button>
            ))}
            <span className="mx-1 h-4 w-px bg-border/60" aria-hidden="true" />
            <button
              type="button"
              title="Link — Enter applies, empty removes"
              aria-label="Add or edit link"
              onClick={openLinkDraft}
              className="flex h-7 min-w-7 items-center justify-center rounded px-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <HugeiconsIcon icon={Link01Icon} strokeWidth={2} className="size-3.5" />
            </button>
          </div>
          {aiPopup && (
            <div className="flex items-center gap-1">
              {AI_ACTIONS.map((a) => (
                <button key={a.id} type="button" disabled={aiStreaming !== null} onClick={() => runAiEdit(a.id)} className="h-7 rounded-md px-2.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50">
                  {aiStreaming === a.id ? <span className="inline-flex items-center gap-1"><span className="size-1.5 rounded-full bg-primary animate-pulse" />Writing</span> : a.label}
                </button>
              ))}
              <button type="button" onClick={cancelAiEdit} className="h-7 rounded-md px-2 text-xs text-muted-foreground/60 transition-colors hover:bg-muted hover:text-foreground">{aiStreaming ? "Stop" : "Close"}</button>
            </div>
          )}
          {aiStreaming === "custom" ? (
            <div className="flex items-center gap-1.5 border-t border-border/60 px-2 pt-1 pb-0.5 text-xs text-muted-foreground">
              <span className="size-1.5 shrink-0 rounded-full bg-primary animate-pulse" />
              <span className="max-w-[260px] truncate">{aiMenu.text}</span>
            </div>
          ) : linkDraft !== null ? (
            <div className="flex items-center gap-1 border-t border-border/60 pt-1">
              <input
                type="text"
                autoFocus
                value={linkDraft}
                onChange={(e) => setLinkDraft(e.target.value)}
                placeholder="Paste or type a URL — Enter to link"
                aria-label="Link URL for selection"
                className="h-7 w-[280px] rounded-md bg-transparent px-2 text-xs outline-none placeholder:text-muted-foreground/50"
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault()
                    applyLinkDraft(linkDraft)
                  } else if (e.key === "Escape") {
                    e.preventDefault()
                    setLinkDraft(null)
                  }
                }}
              />
              <button
                type="button"
                onClick={() => applyLinkDraft(linkDraft)}
                className="h-7 shrink-0 rounded-md px-2.5 text-xs font-medium text-primary transition-colors hover:bg-muted"
              >
                Link
              </button>
            </div>
          ) : aiStreaming === null && aiPopup && (
            <div className="flex items-center gap-1 border-t border-border/60 pt-1">
              <input
                type="text"
                value={aiCustomInput}
                onChange={(e) => setAiCustomInput(e.target.value)}
                placeholder="Ask AI… e.g. “make it sound apologetic”"
                aria-label="Custom AI instruction for selection"
                className="h-7 w-[280px] rounded-md bg-transparent px-2 text-xs outline-none placeholder:text-muted-foreground/50"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && aiCustomInput.trim()) {
                    e.preventDefault()
                    runAiEdit("custom", aiCustomInput)
                  } else if (e.key === "Escape") {
                    e.preventDefault()
                    markAiMenuDismissed()
                    setAiMenu(null)
                  }
                }}
              />
              <button
                type="button"
                disabled={!aiCustomInput.trim()}
                onClick={() => runAiEdit("custom", aiCustomInput)}
                className="h-7 shrink-0 rounded-md px-2.5 text-xs font-medium text-primary transition-colors hover:bg-muted disabled:opacity-40"
              >
                Ask
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

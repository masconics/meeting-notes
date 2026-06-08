import { useRef, useEffect } from "react"
import { EditorState } from "prosemirror-state"
import { EditorView } from "prosemirror-view"
import "prosemirror-view/style/prosemirror.css"
import { schema } from "prosemirror-schema-basic"
import { keymap } from "prosemirror-keymap"
import { baseKeymap } from "prosemirror-commands"
import { history, undo, redo } from "prosemirror-history"
import { defaultMarkdownParser, defaultMarkdownSerializer } from "prosemirror-markdown"
import { inputRules, wrappingInputRule, textblockTypeInputRule, smartQuotes, ellipsis, emDash } from "prosemirror-inputrules"

const blockInputRules = inputRules({
  rules: [
    textblockTypeInputRule(/^#\s$/, schema.nodes.heading, { level: 1 }),
    textblockTypeInputRule(/^##\s$/, schema.nodes.heading, { level: 2 }),
    textblockTypeInputRule(/^###\s$/, schema.nodes.heading, { level: 3 }),
    wrappingInputRule(/^\s*>\s$/, schema.nodes.blockquote),
    textblockTypeInputRule(/^```$/, schema.nodes.code_block),
  ],
})

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
  const onChangeRef = useRef(onChange)
  useEffect(() => {
    onChangeRef.current = onChange
  })
  const initializedRef = useRef(false)

  useEffect(() => {
    if (!mountRef.current || initializedRef.current) return
    initializedRef.current = true

    const doc = defaultMarkdownParser.parse(value) || schema.topNodeType.createAndFill()!

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
        inputRules({ rules: [...smartQuotes, ellipsis, emDash] }),
      ],
    })

    const view = new EditorView(mountRef.current, {
      state,
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
          onChangeRef.current(md)
        }
      },
    })

    view.dom.style.minHeight = "7rem"

    viewRef.current = view

    return () => {
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
    if (value !== currentMd) {
      const doc = defaultMarkdownParser.parse(value) || schema.topNodeType.createAndFill()!
      const state = EditorState.create({ doc, plugins: view.state.plugins })
      view.updateState(state)
    }
  }, [value])

  return (
    <div
      ref={mountRef}
      role="textbox"
      aria-label={editorLabel}
      aria-multiline="true"
      className={`pm-editor ${className}`}
    />
  )
}

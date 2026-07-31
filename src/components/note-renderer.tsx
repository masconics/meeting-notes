import { MarkdownView } from "@/components/markdown-view"

interface NoteRendererProps {
  content: string
  className?: string
  editable?: boolean
  onChange?: (content: string) => void
  viewMode?: "wysiwyg" | "source"
  placeholder?: string
  /** Show AI actions in the selection menu (the formatting rows always show). Defaults to true. */
  aiPopup?: boolean
}

export function NoteRenderer({ content, className = "", editable = false, onChange, viewMode = "wysiwyg", placeholder = "Start writing your notes…", aiPopup = true }: NoteRendererProps) {
  // The live editor advertises its power gestures right in the canvas; the
  // plain copy stays for the source textarea and read-only empty state.
  const editorPlaceholder =
    placeholder === "Start writing your notes…"
      ? "Start writing — type “/” for blocks, select text to format"
      : placeholder
  if (editable) {
    if (viewMode === "source") {
      return (
        <div className="flex min-h-0 flex-1 flex-col">
          <textarea
            value={content}
            onChange={(e) => onChange?.(e.target.value)}
            className={`${className} h-full min-h-0 flex-1 w-full resize-none overflow-auto border-0 bg-transparent outline-none font-mono text-sm leading-relaxed text-foreground placeholder:text-muted-foreground/40`}
            placeholder={placeholder}
            spellCheck={false}
          />
        </div>
      )
    }

    return (
      <MarkdownView
        markdown={content}
        editable
        onChange={onChange}
        editorLabel="Edit note body"
        placeholder={editorPlaceholder}
        aiPopup={aiPopup}
        className={className}
      />
    )
  }

  if (!content?.trim()) {
    return (
      <div className={`${className} text-muted-foreground/40 italic`}>
        {placeholder}
      </div>
    )
  }

  return <MarkdownView markdown={content} className={className} />
}

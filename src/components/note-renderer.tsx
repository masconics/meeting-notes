import { MarkdownView } from "@/components/markdown-view"

interface NoteRendererProps {
  content: string
  className?: string
  editable?: boolean
  onChange?: (content: string) => void
  viewMode?: "wysiwyg" | "source"
  placeholder?: string
  toolbar?: boolean
}

export function NoteRenderer({ content, className = "", editable = false, onChange, viewMode = "wysiwyg", placeholder = "Start writing your notes…", toolbar = false }: NoteRendererProps) {
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
        placeholder={placeholder}
        toolbar={toolbar}
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

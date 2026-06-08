import { useMemo } from "react"
import { MarkdownView, renderMarkdown } from "@/components/markdown-view"

interface NoteRendererProps {
  content: string
  className?: string
  editable?: boolean
  onChange?: (content: string) => void
}

export function NoteRenderer({ content, className = "", editable = false, onChange }: NoteRendererProps) {
  const html = useMemo(() => renderMarkdown(content), [content])

  if (editable) {
    return (
      <MarkdownView
        markdown={content}
        editable
        onChange={onChange}
        editorLabel="Edit note body"
        className={className}
      />
    )
  }

  if (!content.trim()) {
    return (
      <div className={`${className} text-muted-foreground/40 italic`}>
        Start writing...
      </div>
    )
  }

  return (
    <div
      className={`mdx-content ${className}`}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}

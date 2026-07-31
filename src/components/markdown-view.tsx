import { useMemo } from "react"
import { ProseMirrorEditor } from "@/components/ProseMirrorEditor"
import { renderMarkdownHtml } from "@/lib/render-markdown"

interface MarkdownViewProps {
  markdown?: string | null
  className?: string
  editable?: boolean
  onChange?: (markdown: string) => void
  editorLabel?: string
  placeholder?: string
  /** Show AI actions in the selection menu (the formatting rows always show). Defaults to true. */
  aiPopup?: boolean
}

export function MarkdownView({
  markdown,
  className,
  editable = false,
  onChange,
  editorLabel = "Edit markdown",
  placeholder,
  aiPopup = true,
}: MarkdownViewProps) {
  const html = useMemo(() => (markdown ? renderMarkdownHtml(markdown) : ""), [markdown])

  if (editable && onChange) {
    return (
      <ProseMirrorEditor
        value={markdown ?? ""}
        onChange={onChange}
        editorLabel={editorLabel}
        placeholder={placeholder}
        aiPopup={aiPopup}
        className={`min-h-0 flex-1 ${className ?? ""}`}
      />
    )
  }

  return <div className={`mdx-content ${className ?? ""}`} dangerouslySetInnerHTML={{ __html: html }} />
}

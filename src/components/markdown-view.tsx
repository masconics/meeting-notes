import { useMemo } from "react"
import { marked } from "marked"
import { ProseMirrorEditor } from "@/components/ProseMirrorEditor"

interface MarkdownViewProps {
  markdown?: string | null
  className?: string
  editable?: boolean
  onChange?: (markdown: string) => void
  editorLabel?: string
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
}

function cleanMarkdown(markdown: string): string {
  return markdown.trim().replace(/^```(?:markdown|md)?\s*\n?/i, "").replace(/\n?```\s*$/i, "")
}

function safeUrl(href: string): string {
  const trimmed = href.trim()
  if (/^(https?:|mailto:|tel:|#|\/)/i.test(trimmed)) return trimmed
  return "#"
}

function createRenderer() {
  const renderer = new marked.Renderer()
  renderer.link = function ({ href, title, tokens }) {
    const safeHref = safeUrl(href ?? "")
    const titleAttr = title ? ` title="${escapeHtml(title)}"` : ""
    const external = /^(https?:|mailto:|tel:)/i.test(safeHref) ? ` target="_blank" rel="noreferrer noopener"` : ""
    const text = this.parser.parseInline(tokens)
    return `<a href="${escapeHtml(safeHref)}"${titleAttr}${external}>${text}</a>`
  }
  renderer.image = function ({ href, title, text }) {
    const safeHref = safeUrl(href ?? "")
    const titleAttr = title ? ` title="${escapeHtml(title)}"` : ""
    return `<img src="${escapeHtml(safeHref)}" alt="${escapeHtml(text ?? "")}"${titleAttr} loading="lazy" />`
  }
  return renderer
}

export function renderMarkdown(markdown: string): string {
  try {
    return marked.parse(cleanMarkdown(markdown), { breaks: true, gfm: true, renderer: createRenderer() }) as string
  } catch {
    return escapeHtml(markdown)
  }
}

export function MarkdownView({
  markdown,
  className,
  editable = false,
  onChange,
  editorLabel = "Edit markdown",
}: MarkdownViewProps) {
  const html = useMemo(() => (markdown ? renderMarkdown(markdown) : ""), [markdown])

  if (editable && onChange) {
    return (
      <ProseMirrorEditor
        value={markdown ?? ""}
        onChange={onChange}
        editorLabel={editorLabel}
        className={`be-editor min-h-0 flex-1 ${className ?? ""}`}
      />
    )
  }

  return <div className={`mdx-content ${className ?? ""}`} dangerouslySetInnerHTML={{ __html: html }} />
}

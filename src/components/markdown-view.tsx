import { useMemo } from "react"
import { marked } from "marked"
import { ProseMirrorEditor } from "@/components/ProseMirrorEditor"
import { stripMarkdownFence } from "@/lib/format"

interface MarkdownViewProps {
  markdown?: string | null
  className?: string
  editable?: boolean
  onChange?: (markdown: string) => void
  editorLabel?: string
  placeholder?: string
  toolbar?: boolean
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
}

function cleanMarkdown(markdown: string): string {
  return stripMarkdownFence(
    markdown.replace(/\\n/g, "\n").replace(/\\t/g, "\t")
  )
}

function safeUrl(href: string): string {
  const trimmed = href.trim()
  const SAFE = /^(https?:\/\/|mailto:|tel:|#|\/[^/])/i
  if (SAFE.test(trimmed) && !/^(javascript|data|vbscript):/i.test(trimmed)) return trimmed
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
  renderer.table = function (token) {
    let headerCells = ""
    for (let i = 0; i < token.header.length; i++) {
      headerCells += this.tablecell(token.header[i])
    }
    const theadHtml = this.tablerow({ text: headerCells })

    let bodyRows = ""
    for (let i = 0; i < token.rows.length; i++) {
      let rowCells = ""
      for (let j = 0; j < token.rows[i].length; j++) {
        rowCells += this.tablecell(token.rows[i][j])
      }
      bodyRows += this.tablerow({ text: rowCells })
    }

    return `<div class="mdx-table-wrapper"><table><thead>${theadHtml}</thead><tbody>${bodyRows}</tbody></table></div>`
  }
  return renderer
}

function renderMarkdown(markdown: string): string {
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
  placeholder,
  toolbar = false,
}: MarkdownViewProps) {
  const html = useMemo(() => (markdown ? renderMarkdown(markdown) : ""), [markdown])

  if (editable && onChange) {
    return (
      <ProseMirrorEditor
        value={markdown ?? ""}
        onChange={onChange}
        editorLabel={editorLabel}
        placeholder={placeholder}
        toolbar={toolbar}
        className={`min-h-0 flex-1 ${className ?? ""}`}
      />
    )
  }

  return <div className={`mdx-content ${className ?? ""}`} dangerouslySetInnerHTML={{ __html: html }} />
}

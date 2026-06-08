import { useMemo } from "react"
import { marked } from "marked"

const renderer = new marked.Renderer()
const linkRenderer = { ...renderer }
linkRenderer.link = ({ href, title, text }) => {
  const t = title ? ` title="${title}"` : ""
  return `<a href="${href}"${t} target="_blank" rel="noopener noreferrer">${text}</a>`
}

marked.setOptions({
  renderer: linkRenderer,
  breaks: true,
  gfm: true,
})

interface MarkdownViewProps {
  markdown?: string | null
  className?: string
}

export function MarkdownView({ markdown, className }: MarkdownViewProps) {
  const html = useMemo(() => {
    if (!markdown) return ""
    try {
      return marked.parse(markdown) as string
    } catch {
      return markdown.replace(/</g, "&lt;").replace(/>/g, "&gt;")
    }
  }, [markdown])

  return (
    <div
      className={`mdx-content ${className ?? ""}`}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}

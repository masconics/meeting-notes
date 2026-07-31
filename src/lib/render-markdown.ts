import { marked } from "marked"
import { highlightCode } from "@/lib/highlight"
import { stripMarkdownFence } from "@/lib/format"

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
  renderer.code = function ({ text, lang }) {
    const { html, language } = highlightCode(text, lang ?? undefined)
    const shown = lang?.trim() || language
    const langAttr = shown ? ` data-language="${escapeHtml(shown)}"` : ""
    const langClass = shown ? ` language-${escapeHtml(shown)}` : ""
    return `<pre${langAttr}><code class="hljs${langClass}">${html}</code></pre>`
  }
  renderer.link = function ({ href, title, tokens }) {
    const safeHref = safeUrl(href ?? "")
    const titleAttr = title ? ` title="${escapeHtml(title)}"` : ""
    const external = /^(https?:|mailto:|tel:)/i.test(safeHref) ? ` target="_blank" rel="noreferrer noopener"` : ""
    const text = this.parser.parseInline(tokens)
    return `<a href="${escapeHtml(safeHref)}"${titleAttr}${external}>${text}</a>`
  }
  renderer.image = function ({ href, title, text }) {
    const safeHref = safeUrl(href ?? "")
    return `<img src="${escapeHtml(safeHref)}" alt="${escapeHtml(text ?? "")}" title="${escapeHtml(title ?? "")}" loading="lazy" />`
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

/** Render markdown to sanitized, highlighted HTML — shared by the note views
 * and the copy-as-rich-text path so both produce identical markup. */
export function renderMarkdownHtml(markdown: string): string {
  try {
    return marked.parse(cleanMarkdown(markdown), { breaks: true, gfm: true, renderer: createRenderer() }) as string
  } catch {
    return escapeHtml(markdown)
  }
}

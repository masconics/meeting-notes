// Shared syntax highlighting (highlight.js, common-languages bundle for size).
// Used by both the read-only markdown renderer and the editor's code-block
// decoration plugin so highlighting looks identical in writing and reading.
import hljs from "highlight.js/lib/common"

// Languages that plausibly appear in meeting notes — constraining auto-detect
// to this subset avoids exotic guesses on short snippets.
const AUTO_SUBSET = [
  "javascript", "typescript", "python", "bash", "shell", "json", "sql", "yaml",
  "xml", "css", "java", "go", "rust", "c", "cpp", "csharp", "ruby", "php",
  "swift", "kotlin", "markdown", "ini", "dockerfile", "diff", "plaintext",
]

export interface HighlightResult {
  /** HTML with <span class="hljs-*"> tokens. */
  html: string
  /** The language actually used (explicit or detected); "" for plain text. */
  language: string
}

/** Highlight `code`. Explicit languages win; without one, auto-detect only
 *  kicks in for longer snippets (short ones mis-detect too often to be worth
 *  it) and stays within the meeting-note subset. */
export function highlightCode(code: string, language?: string): HighlightResult {
  const lang = language?.trim().toLowerCase() ?? ""
  try {
    if (lang && hljs.getLanguage(lang)) {
      return { html: hljs.highlight(code, { language: lang }).value, language: lang }
    }
    if (code.trim().length >= 40) {
      const auto = hljs.highlightAuto(code, AUTO_SUBSET)
      // Relevance 3+ accepts correctly-detected one-liners (typical meeting-note
      // snippets score ~4-6); plain prose stays below that within the subset.
      if (auto.language && auto.relevance >= 3) {
        return { html: auto.value, language: auto.language }
      }
    }
  } catch { /* fall through to plain */ }
  return { html: escapeHtml(code), language: "" }
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;")
}

const ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#x27;": "'",
}

/** Inverse of the escaping highlight.js applies — needed when mapping its HTML
 *  output back onto plain-text offsets (e.g. ProseMirror decorations). */
export function decodeHljsEntities(s: string): string {
  return s.replace(/&(?:amp|lt|gt|quot);|&#x27;/g, (e) => ENTITIES[e] ?? e)
}

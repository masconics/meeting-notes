export interface ChecklistLine {
  kind: "item" | "text"
  checked?: boolean
  body?: string
  raw: string
}

/** Parse GFM-style checklist lines from recipe digests. */
export function parseChecklistMarkdown(markdown: string): ChecklistLine[] {
  return markdown.split("\n").map((raw) => {
    const m = raw.match(/^(\s*)[-*+]\s+\[([ xX])\]\s+(.*)$/)
    if (m) {
      return {
        kind: "item" as const,
        checked: m[2].toLowerCase() === "x",
        body: m[3],
        raw,
      }
    }
    return { kind: "text" as const, raw }
  })
}

export function toggleChecklistLine(markdown: string, lineIndex: number): string {
  const lines = markdown.split("\n")
  if (lineIndex < 0 || lineIndex >= lines.length) return markdown
  const line = lines[lineIndex]
  if (/^\s*[-*+]\s+\[\s\]\s+/.test(line)) {
    lines[lineIndex] = line.replace(/\[\s\]/, "[x]")
  } else if (/^\s*[-*+]\s+\[[xX]\]\s+/.test(line)) {
    lines[lineIndex] = line.replace(/\[[xX]\]/, "[ ]")
  }
  return lines.join("\n")
}

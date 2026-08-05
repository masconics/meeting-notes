// Parse source citations from AI answers and render-friendly meeting links.
// Model is instructed to cite as: [[meeting:MEETING_ID|Optional Title]]

export interface MeetingCitation {
  meetingId: string
  title: string
  /** Full match including brackets, for stripping if needed. */
  raw: string
  index: number
}

const CITE_RE = /\[\[meeting:([^\]|]+)(?:\|([^\]]+))?\]\]/gi

export function parseMeetingCitations(text: string): MeetingCitation[] {
  if (!text) return []
  const out: MeetingCitation[] = []
  const seen = new Set<string>()
  let m: RegExpExecArray | null
  const re = new RegExp(CITE_RE.source, "gi")
  while ((m = re.exec(text)) !== null) {
    const meetingId = m[1].trim()
    if (!meetingId || seen.has(meetingId)) continue
    seen.add(meetingId)
    out.push({
      meetingId,
      title: (m[2] || meetingId).trim(),
      raw: m[0],
      index: m.index,
    })
  }
  return out
}

/** Replace [[meeting:id|title]] with markdown links for MarkdownView. */
export function citationsToMarkdown(text: string): string {
  if (!text) return text
  return text.replace(CITE_RE, (_full, id: string, title?: string) => {
    const label = (title || id).trim()
    // Hash route used by the app: #editor/<id>
    return `[${label}](#editor/${id.trim()})`
  })
}

/** Strip citation tokens for plain clipboard copy. */
export function stripCitations(text: string): string {
  if (!text) return text
  return text.replace(CITE_RE, (_full, id: string, title?: string) => {
    return title?.trim() || id.trim()
  })
}

export const CITATION_INSTRUCTION = `CITATIONS: When you use information from a specific meeting, cite it inline as [[meeting:MEETING_ID|Meeting Title]] using the exact id from the context. Place citations after the claim. Prefer citing rather than inventing. If context lists (id: …) on knowledge items, use the meetingId field when present, or the meeting ids in RELATED MEETINGS blocks.`

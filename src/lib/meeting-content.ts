import type { Meeting } from "@/types"

export function buildMeetingContent(meeting: Meeting): string {
  const parts = [meeting.title]
  if (meeting.notes) parts.push(meeting.notes)
  if (meeting.transcript) parts.push(meeting.transcript.slice(0, 2000))
  if (meeting.structuredNotes) {
    for (const section of meeting.structuredNotes) {
      parts.push(section.title, section.content)
    }
  }
  if (meeting.enhancedNotes) parts.push(meeting.enhancedNotes)
  if (meeting.brief) parts.push(meeting.brief)
  return parts.join(" ")
}

export function contentHash(meeting: Meeting): string {
  const source =
    meeting.title +
    (meeting.notes || "") +
    (meeting.transcript || "").slice(0, 1000)
  let hash = 0
  for (let i = 0; i < source.length; i++) {
    const chr = source.charCodeAt(i)
    hash = ((hash << 5) - hash) + chr
    hash |= 0
  }
  return String(hash)
}

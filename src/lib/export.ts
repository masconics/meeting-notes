import type { Meeting } from "@/types"

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  })
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
  })
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  if (m === 0) return `${s}s`
  return `${m}m ${s}s`
}

export function toMarkdown(meeting: Meeting): string {
  const parts: string[] = []

  parts.push(`# ${meeting.title}`)
  parts.push(`**Date:** ${formatDate(meeting.date)} at ${formatTime(meeting.date)} · ${formatDuration(meeting.duration)}`)
  parts.push("")

  if (meeting.transcript) {
    parts.push("## Transcript")
    parts.push(meeting.transcript)
    parts.push("")
  }

  if (meeting.notes) {
    parts.push("## Notes")
    parts.push(meeting.notes)
    parts.push("")
  }

  if (meeting.structuredNotes && meeting.structuredNotes.length > 0) {
    parts.push("## Structured Notes")
    for (const section of meeting.structuredNotes) {
      parts.push(`### ${section.title}`)
      parts.push(section.content)
      parts.push("")
    }
  }

  return parts.join("\n")
}

export function toPlainText(meeting: Meeting): string {
  const parts: string[] = []

  parts.push(meeting.title)
  parts.push(`Date: ${formatDate(meeting.date)} at ${formatTime(meeting.date)} · ${formatDuration(meeting.duration)}`)
  parts.push("")

  if (meeting.transcript) {
    parts.push("Transcript")
    parts.push(meeting.transcript)
    parts.push("")
  }

  if (meeting.notes) {
    parts.push("Notes")
    parts.push(meeting.notes)
    parts.push("")
  }

  if (meeting.structuredNotes && meeting.structuredNotes.length > 0) {
    parts.push("Structured Notes")
    for (const section of meeting.structuredNotes) {
      parts.push(section.title)
      parts.push(section.content)
      parts.push("")
    }
  }

  return parts.join("\n")
}

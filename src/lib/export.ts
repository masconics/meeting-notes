import type { Meeting } from "@/types"

export async function exportAllMeetings(): Promise<boolean> {
  const { loadMeetings } = await import("@/lib/storage")
  const meetings = loadMeetings()
  if (meetings.length === 0) return false

  const data = JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), meetings }, null, 2)
  const filename = `meeting-notes-export-${new Date().toISOString().slice(0, 10)}.json`

  try {
    const { save } = await import("@tauri-apps/plugin-dialog")
    const filePath = await save({
      defaultPath: filename,
      filters: [{ name: "JSON", extensions: ["json"] }],
    })
    if (!filePath) return false
    const { writeTextFile } = await import("@tauri-apps/plugin-fs")
    await writeTextFile(filePath, data)
    return true
  } catch {
    const blob = new Blob([data], { type: "application/json" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
    return true
  }
}

export async function exportAllMeetingsMarkdown(): Promise<boolean> {
  const { loadMeetings } = await import("@/lib/storage")
  const meetings = loadMeetings()
  if (meetings.length === 0) return false

  const dateStr = new Date().toISOString().slice(0, 10)
  const content = meetings.map((m, i) => {
    const md = toMarkdown(m)
    return i === 0 ? md : `\n\n---\n\n${md}`
  }).join("")
  const filename = `meetings-${dateStr}.md`

  try {
    const { save } = await import("@tauri-apps/plugin-dialog")
    const filePath = await save({
      defaultPath: filename,
      filters: [{ name: "Markdown", extensions: ["md"] }],
    })
    if (!filePath) return false
    const { writeTextFile } = await import("@tauri-apps/plugin-fs")
    await writeTextFile(filePath, content)
    return true
  } catch {
    const blob = new Blob([content], { type: "text/markdown" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
    return true
  }
}

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

export async function copyAllAsJson(): Promise<void> {
  const { loadMeetings } = await import("@/lib/storage")
  const meetings = loadMeetings()
  const data = JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), meetings }, null, 2)
  await navigator.clipboard.writeText(data)
}

export async function saveToFile(meeting: Meeting, format: "md" | "txt"): Promise<boolean> {
  const content = format === "md" ? toMarkdown(meeting) : toPlainText(meeting)
  const ext = format === "md" ? ".md" : ".txt"
  const filename = `${meeting.title.replace(/[<>:"/\\|?*\x00-\x1f]/g, "").slice(0, 50)}${ext}`

  try {
    const { save } = await import("@tauri-apps/plugin-dialog")
    const filePath = await save({
      defaultPath: filename,
      filters: [{
        name: format === "md" ? "Markdown" : "Text",
        extensions: [format],
      }],
    })
    if (!filePath) return false

    const { writeTextFile } = await import("@tauri-apps/plugin-fs")
    await writeTextFile(filePath, content)
    return true
  } catch {
    const blob = new Blob([content], { type: "text/plain" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
    return true
  }
}

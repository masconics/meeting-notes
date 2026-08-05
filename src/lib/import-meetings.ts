// Import meetings from Myna export JSON, Granola-style JSON, or Markdown files.

import type { Meeting } from "@/types"

export interface ImportResult {
  meetings: Meeting[]
  skipped: number
  source: "myna-json" | "granola" | "markdown" | "unknown"
  errors: string[]
}

function uuid(): string {
  return crypto.randomUUID()
}

function asString(v: unknown): string {
  return typeof v === "string" ? v : v == null ? "" : String(v)
}

function parseDate(v: unknown): string {
  if (typeof v === "string" && v.trim()) {
    const d = new Date(v)
    if (!Number.isNaN(d.getTime())) return d.toISOString()
  }
  if (typeof v === "number" && Number.isFinite(v)) {
    // Granola sometimes uses seconds or ms
    const ms = v < 1e12 ? v * 1000 : v
    const d = new Date(ms)
    if (!Number.isNaN(d.getTime())) return d.toISOString()
  }
  return new Date().toISOString()
}

function normalizeMeeting(partial: Partial<Meeting> & { title?: string }): Meeting {
  const id = asString(partial.id) || uuid()
  return {
    id,
    title: asString(partial.title) || "Imported note",
    date: parseDate(partial.date),
    duration: typeof partial.duration === "number" ? partial.duration : 0,
    transcript: asString(partial.transcript),
    notes: asString(partial.notes) || asString(partial.enhancedNotes) || asString(partial.transcript),
    manualNotes: partial.manualNotes ? asString(partial.manualNotes) : undefined,
    description: partial.description ? asString(partial.description) : undefined,
    templateId: partial.templateId,
    structuredNotes: partial.structuredNotes,
    enhancedNotes: partial.enhancedNotes ? asString(partial.enhancedNotes) : undefined,
    chatHistory: partial.chatHistory,
    speakerLabels: partial.speakerLabels,
    transcriptSegments: partial.transcriptSegments,
    brief: partial.brief ? asString(partial.brief) : undefined,
    folderIds: partial.folderIds,
    calendarEventId: partial.calendarEventId,
    attendees: partial.attendees,
    personIds: partial.personIds,
    recipeOutputs: partial.recipeOutputs,
  }
}

/** Myna Notes export: { version, meetings: Meeting[] } or bare Meeting[] */
function tryMynaJson(data: unknown): Meeting[] | null {
  if (Array.isArray(data)) {
    if (data.length === 0) return []
    if (data.every((m) => m && typeof m === "object" && ("notes" in m || "transcript" in m || "title" in m))) {
      return data.map((m) => normalizeMeeting(m as Partial<Meeting>))
    }
    return null
  }
  if (data && typeof data === "object") {
    const obj = data as Record<string, unknown>
    if (Array.isArray(obj.meetings)) {
      return obj.meetings.map((m) => normalizeMeeting(m as Partial<Meeting>))
    }
  }
  return null
}

/**
 * Granola / generic note exports.
 * Supports shapes like:
 * - { documents: [{ title, notes, transcript, created_at }] }
 * - { notes: [...] }
 * - single { title, panel, transcript }
 */
function tryGranolaJson(data: unknown): Meeting[] | null {
  if (!data || typeof data !== "object") return null
  const obj = data as Record<string, unknown>

  const candidates: unknown[] = []
  if (Array.isArray(obj.documents)) candidates.push(...obj.documents)
  else if (Array.isArray(obj.notes)) candidates.push(...obj.notes)
  else if (Array.isArray(obj.meetings)) return null // handled by myna
  else if ("title" in obj || "transcript" in obj || "panel" in obj || "summary" in obj) {
    candidates.push(obj)
  } else {
    return null
  }

  if (candidates.length === 0) return null

  const meetings: Meeting[] = []
  for (const raw of candidates) {
    if (!raw || typeof raw !== "object") continue
    const n = raw as Record<string, unknown>
    const title = asString(n.title || n.name || n.heading)
    const notes = asString(
      n.notes ||
        n.markdown ||
        n.summary ||
        n.enhanced_notes ||
        n.panel ||
        (typeof n.content === "string" ? n.content : ""),
    )
    const transcript = asString(n.transcript || n.transcription || n.raw_transcript)
    if (!title && !notes && !transcript) continue
    meetings.push(
      normalizeMeeting({
        id: asString(n.id) || uuid(),
        title: title || "Imported from Granola",
        date: parseDate(n.created_at || n.createdAt || n.date || n.updated_at),
        duration: typeof n.duration === "number" ? n.duration : 0,
        notes: notes || transcript,
        transcript,
        attendees: Array.isArray(n.attendees)
          ? (n.attendees as { name?: string; email?: string }[]).map((a) => ({
              name: asString(a.name),
              email: a.email ? asString(a.email) : undefined,
            }))
          : undefined,
      }),
    )
  }
  return meetings.length > 0 ? meetings : null
}

/** Split markdown by `---` horizontal rules or `# ` top-level titles into meetings. */
function parseMarkdownMeetings(md: string): Meeting[] {
  const text = md.trim()
  if (!text) return []

  // Prefer explicit HR splits (Myna bulk export style).
  if (/\n---\n/.test(text)) {
    return text
      .split(/\n---\n/)
      .map((block) => block.trim())
      .filter(Boolean)
      .map((block) => markdownBlockToMeeting(block))
  }

  // Else split on H1 headings.
  const parts = text.split(/(?=^# )/m).map((p) => p.trim()).filter(Boolean)
  if (parts.length > 1) {
    return parts.map((block) => markdownBlockToMeeting(block))
  }

  return [markdownBlockToMeeting(text)]
}

function markdownBlockToMeeting(block: string): Meeting {
  const lines = block.split("\n")
  let title = "Imported note"
  let bodyStart = 0
  if (lines[0]?.startsWith("# ")) {
    title = lines[0].replace(/^#\s+/, "").trim() || title
    bodyStart = 1
  }
  // Skip common meta lines like **Date:** …
  while (bodyStart < lines.length) {
    const l = lines[bodyStart].trim()
    if (!l || /^\*\*[\w\s]+:\*\*/.test(l) || /^Date:|^Duration:/.test(l)) {
      bodyStart++
      continue
    }
    break
  }
  const body = lines.slice(bodyStart).join("\n").trim()
  return normalizeMeeting({
    title,
    notes: body,
    transcript: "",
    date: new Date().toISOString(),
  })
}

export function parseImportPayload(raw: string, fileName?: string): ImportResult {
  const errors: string[] = []
  const trimmed = raw.trim()
  if (!trimmed) {
    return { meetings: [], skipped: 0, source: "unknown", errors: ["File is empty"] }
  }

  const looksJson = trimmed.startsWith("{") || trimmed.startsWith("[")
  const ext = (fileName || "").toLowerCase()

  if (looksJson || ext.endsWith(".json")) {
    try {
      const data = JSON.parse(trimmed) as unknown
      const myna = tryMynaJson(data)
      if (myna) {
        return { meetings: myna, skipped: 0, source: "myna-json", errors }
      }
      const granola = tryGranolaJson(data)
      if (granola) {
        return { meetings: granola, skipped: 0, source: "granola", errors }
      }
      errors.push("JSON did not match Myna or Granola shapes")
      return { meetings: [], skipped: 0, source: "unknown", errors }
    } catch (e) {
      errors.push(e instanceof Error ? e.message : "Invalid JSON")
      // Fall through to markdown if extension suggests it
      if (ext.endsWith(".json")) {
        return { meetings: [], skipped: 0, source: "unknown", errors }
      }
    }
  }

  const meetings = parseMarkdownMeetings(trimmed)
  return {
    meetings,
    skipped: 0,
    source: "markdown",
    errors,
  }
}

/** Open file picker and return parsed meetings (null if cancelled). */
export async function pickAndImportMeetings(): Promise<ImportResult | null> {
  const { open } = await import("@tauri-apps/plugin-dialog")
  const selected = await open({
    multiple: false,
    filters: [
      { name: "Notes export", extensions: ["json", "md", "markdown", "txt"] },
    ],
  })
  if (!selected || typeof selected !== "string") return null

  const { readTextFile } = await import("@tauri-apps/plugin-fs")
  const raw = await readTextFile(selected)
  const fileName = selected.split("/").pop()
  return parseImportPayload(raw, fileName)
}

/**
 * Merge imported meetings into existing list.
 * Skips imports whose id already exists (unless forceNewIds).
 */
export function mergeImportedMeetings(
  existing: Meeting[],
  imported: Meeting[],
  opts?: { forceNewIds?: boolean },
): { meetings: Meeting[]; added: number; skipped: number } {
  const byId = new Set(existing.map((m) => m.id))
  const next = [...existing]
  let added = 0
  let skipped = 0

  for (const m of imported) {
    let meeting = m
    if (opts?.forceNewIds || byId.has(m.id)) {
      if (byId.has(m.id) && !opts?.forceNewIds) {
        skipped++
        continue
      }
      meeting = { ...m, id: uuid() }
    }
    byId.add(meeting.id)
    next.unshift(meeting)
    added++
  }

  return { meetings: next, added, skipped }
}

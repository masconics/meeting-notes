import type { CalendarEvent, KnowledgeItem, Meeting, MeetingAttendee } from "@/types"
import { loadKnowledgeGraph, loadMeetings } from "@/lib/storage"
import { findRelatedMeetings } from "@/lib/context-memory"

export interface BriefInput {
  title: string
  attendees?: MeetingAttendee[]
  calendarEventId?: string
  meetingId?: string
}

export interface AssembledBrief {
  markdown: string
  relatedMeetingIds: string[]
  openActionIds: string[]
}

/** Structured prep for the editor rail — not a markdown essay. */
export interface PrepOpenLoop {
  id: string
  text: string
  assignee?: string
  meetingId: string
  meetingTitle?: string
}

export interface PrepContext {
  openLoops: PrepOpenLoop[]
  relatedMeetingIds: string[]
}

function attendeeNames(attendees: MeetingAttendee[] | undefined): string[] {
  return (attendees ?? [])
    .map((a) => a.name.trim())
    .filter(Boolean)
}

function personMatches(item: KnowledgeItem, names: string[]): boolean {
  if (!names.length) return false
  const assignee = (item.assignee ?? "").toLowerCase()
  if (!assignee) return false
  return names.some((n) => {
    const lower = n.toLowerCase()
    return assignee === lower || assignee.includes(lower) || lower.includes(assignee)
  })
}

function probeMeeting(input: BriefInput): Meeting {
  return {
    id: input.meetingId ?? `brief-${Date.now()}`,
    title: input.title || "Upcoming meeting",
    date: new Date().toISOString(),
    duration: 0,
    transcript: "",
    notes: attendeeNames(input.attendees).join(", "),
    attendees: input.attendees,
    calendarEventId: input.calendarEventId,
  }
}

/**
 * Open action items linked to this meeting’s people or related past notes.
 * Prefer this for UI over a generated markdown “brief”.
 */
export function getPrepContext(input: BriefInput): PrepContext {
  const meetings = loadMeetings()
  const byId = new Map(meetings.map((m) => [m.id, m]))
  const probe = probeMeeting(input)
  const related = findRelatedMeetings(probe, meetings, 5)
  const relatedIds = related.map((r) => r.meetingId)
  const names = attendeeNames(input.attendees)
  // Also match speaker-like names from title-less notes via attendees only.
  const graph = loadKnowledgeGraph()
  const openActions = graph.items.filter((item) => {
    if (item.kind !== "action_item") return false
    if (item.status !== "open" && item.status !== "unknown") return false
    if (input.meetingId && item.meetingId === input.meetingId) return true
    if (relatedIds.includes(item.meetingId)) return true
    return personMatches(item, names)
  })

  const openLoops: PrepOpenLoop[] = openActions.slice(0, 12).map((a) => ({
    id: a.id,
    text: a.text,
    assignee: a.assignee,
    meetingId: a.meetingId,
    meetingTitle: byId.get(a.meetingId)?.title,
  }))

  return { openLoops, relatedMeetingIds: relatedIds }
}

/** Assemble a local markdown brief (for export / legacy). Prefer getPrepContext for UI. */
export function assembleBriefLocally(input: BriefInput): AssembledBrief {
  const meetings = loadMeetings()
  const prep = getPrepContext(input)
  const relatedMeetings = meetings.filter((m) => prep.relatedMeetingIds.includes(m.id))
  const names = attendeeNames(input.attendees)
  const probe = probeMeeting(input)

  const lines: string[] = [`### ${probe.title}`, ""]

  if (names.length) {
    lines.push("**People**", ...names.map((n) => `- ${n}`), "")
  }

  if (relatedMeetings.length) {
    lines.push("**Related**")
    for (const m of relatedMeetings) {
      const date = new Date(m.date).toLocaleDateString()
      lines.push(`- ${m.title} (${date})`)
    }
    lines.push("")
  }

  if (prep.openLoops.length) {
    lines.push("**Open loops**")
    for (const a of prep.openLoops) {
      const owner = a.assignee ? ` — ${a.assignee}` : ""
      lines.push(`- [ ] ${a.text}${owner}`)
    }
    lines.push("")
  }

  return {
    markdown: lines.join("\n").trim(),
    relatedMeetingIds: prep.relatedMeetingIds,
    openActionIds: prep.openLoops.map((a) => a.id),
  }
}

export async function buildMeetingBrief(
  input: BriefInput,
  opts?: { polishWithAI?: boolean },
): Promise<AssembledBrief> {
  const local = assembleBriefLocally(input)
  if (!opts?.polishWithAI) return local

  try {
    const { isAIConfigured, polishBrief } = await import("@/lib/ai-service")
    if (!isAIConfigured()) return local
    const polished = await polishBrief(local.markdown, input.title)
    return { ...local, markdown: polished || local.markdown }
  } catch {
    return local
  }
}

export function briefFromCalendarEvent(event: CalendarEvent): BriefInput {
  return {
    title: event.title,
    attendees: event.attendees,
    calendarEventId: event.id,
  }
}

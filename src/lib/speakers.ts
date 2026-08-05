// Speaker labeling helpers: seed from calendar, rename across transcript, dual-channel maps.

import type { MeetingAttendee, SpeakerLabel } from "@/types"
import { SPEAKER_TAILWIND_COLORS } from "@/lib/constants"

const CHANNEL_ALIASES = ["Me", "Them", "Speaker 1", "Speaker 2", "Speaker 3", "Speaker 4"] as const

/** Seed speaker labels from calendar attendees when none exist yet. */
export function seedSpeakersFromAttendees(
  attendees: MeetingAttendee[] | undefined,
  existing: SpeakerLabel[] = [],
): SpeakerLabel[] {
  if (existing.length > 0) return existing
  const names = (attendees ?? [])
    .map((a) => a.name.trim())
    .filter(Boolean)
  if (names.length === 0) return existing

  const seen = new Set<string>()
  const labels: SpeakerLabel[] = []
  for (const name of names) {
    const key = name.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    labels.push({
      name,
      color: SPEAKER_TAILWIND_COLORS[labels.length % SPEAKER_TAILWIND_COLORS.length],
    })
  }
  return labels
}

/**
 * Dual-channel defaults: Me = local user, Them = first other attendee when known.
 * Returns map used by stream-transcript for live labels.
 */
export function channelLabelMap(opts: {
  speakers?: SpeakerLabel[]
  attendees?: MeetingAttendee[]
  selfName?: string
}): { mic: string; system: string } {
  const self =
    opts.selfName?.trim() ||
    opts.speakers?.find((s) => /^me$/i.test(s.name))?.name ||
    "Me"

  const others = [
    ...(opts.speakers ?? []).map((s) => s.name),
    ...(opts.attendees ?? []).map((a) => a.name),
  ]
    .map((n) => n.trim())
    .filter((n) => n && !/^me$/i.test(n) && n.toLowerCase() !== self.toLowerCase())

  const them = others[0] || "Them"
  return { mic: self, system: them }
}

/** Escape for use inside a RegExp character class / pattern. */
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

/**
 * Rename a speaker label in transcript text.
 * Matches line-start labels like `Me:`, `Them:`, `Priya:`.
 * When `applyAll` is true, rewrites every occurrence of the old label.
 */
export function renameSpeakerInTranscript(
  transcript: string,
  oldName: string,
  newName: string,
): string {
  const from = oldName.trim()
  const to = newName.trim()
  if (!transcript || !from || !to || from === to) return transcript

  const re = new RegExp(`(^|\\n)(${escapeRegExp(from)})(\\s*:)`, "gi")
  return transcript.replace(re, `$1${to}$3`)
}

/** Apply rename to notes + raw transcript + speakerLabels array. */
export function applySpeakerRename(input: {
  oldName: string
  newName: string
  transcript: string
  notes: string
  speakers: SpeakerLabel[]
}): {
  transcript: string
  notes: string
  speakers: SpeakerLabel[]
} {
  const { oldName, newName } = input
  const to = newName.trim()
  if (!to) {
    return {
      transcript: input.transcript,
      notes: input.notes,
      speakers: input.speakers,
    }
  }

  const speakers = input.speakers.map((s) =>
    s.name.toLowerCase() === oldName.trim().toLowerCase() ? { ...s, name: to } : s,
  )

  // If old label wasn't in the list (e.g. "Them"), add the new name.
  const hasNew = speakers.some((s) => s.name.toLowerCase() === to.toLowerCase())
  const nextSpeakers = hasNew
    ? speakers
    : [
        ...speakers,
        {
          name: to,
          color: SPEAKER_TAILWIND_COLORS[speakers.length % SPEAKER_TAILWIND_COLORS.length],
        },
      ]

  return {
    transcript: renameSpeakerInTranscript(input.transcript, oldName, to),
    notes: renameSpeakerInTranscript(input.notes, oldName, to),
    speakers: nextSpeakers,
  }
}

/** Generic channel labels that benefit from one-click rename. */
export function isGenericSpeakerName(name: string): boolean {
  const n = name.trim()
  if (!n) return true
  if (CHANNEL_ALIASES.some((a) => a.toLowerCase() === n.toLowerCase())) return true
  return /^speaker\s*\d+$/i.test(n)
}

/** Merge AI-detected names with calendar attendees and existing labels. */
export function mergeSpeakerNames(
  existing: SpeakerLabel[],
  detected: string[],
  attendees?: MeetingAttendee[],
): SpeakerLabel[] {
  const out = [...existing]
  const seen = new Set(out.map((s) => s.name.toLowerCase()))

  const candidates = [
    ...detected,
    ...(attendees ?? []).map((a) => a.name),
  ]

  for (const raw of candidates) {
    const name = raw?.trim()
    if (!name) continue
    const key = name.toLowerCase()
    if (seen.has(key)) continue
    if (isGenericSpeakerName(name) && existing.length > 0) continue
    seen.add(key)
    out.push({
      name,
      color: SPEAKER_TAILWIND_COLORS[out.length % SPEAKER_TAILWIND_COLORS.length],
    })
  }
  return out
}

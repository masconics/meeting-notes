/**
 * Apply AI-suggested concept tags to a meeting.
 * Reuses existing tags (case-insensitive); creates new ones when needed.
 * Never removes tags the user already assigned.
 */
import type { Meeting } from "@/types"
import {
  assignMeetingToFolder,
  createFolder,
  loadFolders,
  loadMeetings,
} from "@/lib/storage"
import { suggestMeetingTags } from "@/lib/ai-service"

const TAG_COLORS = [
  "oklch(0.556 0 0)",
  "var(--brand)",
  "oklch(0.62 0.14 155)",
  "oklch(0.72 0.14 80)",
  "oklch(0.6 0.18 25)",
  "oklch(0.58 0.16 305)",
]

export type AutoTagResult = {
  folderIds: string[]
  /** Tags newly linked to this meeting (may include existing catalog tags). */
  applied: string[]
  /** Tags created in the catalog for the first time. */
  created: string[]
}

export async function autoTagMeeting(
  meeting: Pick<Meeting, "id" | "title" | "notes" | "transcript" | "folderIds">,
): Promise<AutoTagResult> {
  const folders = loadFolders()
  const existingNames = folders.map((f) => f.name)
  const suggested = await suggestMeetingTags({
    title: meeting.title,
    notes: meeting.notes,
    transcript: meeting.transcript,
    existingTags: existingNames,
  })

  if (suggested.length === 0) {
    return {
      folderIds: meeting.folderIds ?? [],
      applied: [],
      created: [],
    }
  }

  const byLower = new Map(folders.map((f) => [f.name.toLowerCase(), f]))
  const applied: string[] = []
  const created: string[] = []
  const ids = new Set(meeting.folderIds ?? [])

  for (const raw of suggested) {
    const key = raw.toLowerCase()
    let folder = byLower.get(key)
    if (!folder) {
      folder = createFolder(raw, TAG_COLORS[byLower.size % TAG_COLORS.length])
      byLower.set(key, folder)
      created.push(folder.name)
    }
    if (!ids.has(folder.id)) {
      assignMeetingToFolder(meeting.id, folder.id)
      ids.add(folder.id)
      applied.push(folder.name)
    }
  }

  // Prefer storage after assign (rebuilds denormalized folder.meetingIds too).
  const stored = loadMeetings().find((m) => m.id === meeting.id)
  const folderIds = stored?.folderIds ?? [...ids]

  return {
    folderIds,
    applied,
    created,
  }
}

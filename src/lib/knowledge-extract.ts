import type { Meeting, KnowledgeItem, KnowledgeKind } from "@/types"
import { callDeepSeek } from "@/lib/deepseek-client"
import { withVocabulary } from "@/lib/dictionary"
import { parseChecklistMarkdown } from "@/lib/checklist"

function cleanJsonResponse(text: string): string {
  return text.trim()
    .replace(/^```(?:json)?\s*\n?/i, "")
    .replace(/\n?```\s*$/, "")
}

const VALID_KINDS: KnowledgeKind[] = [
  "decision", "action_item", "key_point", "question", "commitment", "risk",
]

interface RawItem {
  kind?: string
  text?: string
  speaker?: string
  assignee?: string
  topics?: string[]
  sourceExcerpt?: string
}

export async function extractKnowledgeItems(
  meeting: Meeting,
  notes: string,
): Promise<KnowledgeItem[]> {
  if (!notes.trim()) return []

  const prompt = `You are a meeting knowledge extractor. Analyze these meeting notes and extract structured knowledge items as a JSON array.

For each item, include these fields:
- "kind": one of "decision", "action_item", "key_point", "question", "commitment", "risk"
- "text": a concise statement of the knowledge (1-2 sentences)
- "speaker": who said or proposed it (only if clearly identifiable from the notes, otherwise omit)
- "assignee": for action_items only — who is responsible (omit if not an action_item or unknown)
- "topics": array of 1-3 topic labels in lowercase kebab-case (e.g. "budget", "hiring", "product-roadmap")
- "sourceExcerpt": a short quote from the notes supporting this item

Rules:
- Extract ONLY facts present in the notes — do not invent or hallucinate
- Each item must be atomic: one piece of knowledge per item
- Aim for 5-15 items covering the most important content
- Use lowercase kebab-case for all topic labels
- Omit fields you cannot fill rather than using null

Return ONLY a JSON array. No markdown, no code fences, no explanation.

MEETING TITLE: ${meeting.title || "(untitled)"}

MEETING NOTES:
${notes.slice(0, 8000)}`

  try {
    const response = await callDeepSeek([
      { role: "system", content: withVocabulary("You are a meeting knowledge extraction tool. You respond only with valid JSON arrays.") },
      { role: "user", content: prompt },
    ], { thinking: true })

    const raw: RawItem[] = JSON.parse(cleanJsonResponse(response))
    if (!Array.isArray(raw)) return []

    const now = new Date().toISOString()
    const items: KnowledgeItem[] = raw
      .filter((r) => r.text && typeof r.text === "string" && r.text.trim())
      .map((r) => {
        const kind = VALID_KINDS.includes(r.kind as KnowledgeKind)
          ? r.kind as KnowledgeKind
          : "key_point"
        return {
          id: crypto.randomUUID(),
          kind,
          text: r.text!.trim(),
          meetingId: meeting.id,
          speaker: r.speaker?.trim() || undefined,
          assignee: kind === "action_item" ? r.assignee?.trim() || undefined : undefined,
          status: kind === "action_item" ? "open" : "unknown",
          topics: Array.isArray(r.topics)
            ? r.topics.filter((t) => typeof t === "string" && t.trim()).slice(0, 3)
            : [],
          sourceExcerpt: r.sourceExcerpt?.trim() || undefined,
          extractedAt: now,
        }
      })

    return items
  } catch {
    return []
  }
}

/**
 * Fallback: turn an action-digest checklist into knowledge action items when
 * the dedicated extractor returns nothing (or to fill gaps).
 */
export function knowledgeItemsFromActionDigest(
  meetingId: string,
  digestMarkdown: string,
): KnowledgeItem[] {
  if (!digestMarkdown.trim()) return []
  const now = new Date().toISOString()
  const items: KnowledgeItem[] = []

  for (const line of parseChecklistMarkdown(digestMarkdown)) {
    if (line.kind !== "item" || !line.body?.trim()) continue
    // Prefer "Owner — task" / "Owner - task" patterns from the recipe prompt.
    const split = line.body.match(/^(.+?)\s+[—–-]\s+(.+)$/)
    let assignee: string | undefined
    let text = line.body.trim()
    if (split) {
      const maybeOwner = split[1].trim()
      const maybeTask = split[2].trim()
      if (maybeOwner && maybeOwner.toLowerCase() !== "unassigned" && maybeTask) {
        assignee = maybeOwner
        text = maybeTask
      }
    }
    items.push({
      id: crypto.randomUUID(),
      kind: "action_item",
      text,
      meetingId,
      assignee,
      status: line.checked ? "resolved" : "open",
      topics: [],
      extractedAt: now,
    })
  }
  return items
}

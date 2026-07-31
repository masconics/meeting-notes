import type { KnowledgeItem, KnowledgeEdge, KnowledgeEdgeKind, Meeting } from "@/types"
import { callDeepSeek } from "@/lib/deepseek-client"
import { cosineSimilarity } from "@/lib/embedding"

const TOP_K_CANDIDATES = 5
const VALID_EDGE_KINDS: KnowledgeEdgeKind[] = ["follows_up_on", "supersedes", "contradicts"]

function cleanJsonResponse(text: string): string {
  return text.trim()
    .replace(/^```(?:json)?\s*\n?/i, "")
    .replace(/\n?```\s*$/, "")
}

export function findLinkCandidates(
  newItems: KnowledgeItem[],
  existingItems: KnowledgeItem[],
  topK = TOP_K_CANDIDATES,
): Map<string, KnowledgeItem[]> {
  const result = new Map<string, KnowledgeItem[]>()

  for (const newItem of newItems) {
    if (!newItem.embedding || newItem.embedding.length === 0) continue
    const scored = existingItems
      .filter((e) => e.embedding && e.embedding.length > 0 && e.id !== newItem.id)
      .map((e) => ({
        item: e,
        score: cosineSimilarity(newItem.embedding!, e.embedding!),
      }))
      .filter((s) => s.score > 0.3)
      .sort((a, b) => b.score - a.score)
      .slice(0, topK)

    if (scored.length > 0) {
      result.set(newItem.id, scored.map((s) => s.item))
    }
  }

  return result
}

interface RawLink {
  newItemId?: string
  existingItemId?: string
  kind?: string
  reason?: string
}

export async function linkKnowledgeItems(
  newItems: KnowledgeItem[],
  candidates: Map<string, KnowledgeItem[]>,
  meetings: Meeting[],
): Promise<KnowledgeEdge[]> {
  if (candidates.size === 0) return []

  const meetingMap = new Map(meetings.map((m) => [m.id, m]))
  const meetingLabel = (id: string) => {
    const m = meetingMap.get(id)
    return m ? `${m.title || "Untitled"} (${new Date(m.date).toLocaleDateString(undefined, { month: "short", day: "numeric" })})` : "Unknown"
  }

  const newItemsJson = newItems
    .filter((i) => candidates.has(i.id))
    .map((i) => JSON.stringify({ id: i.id, kind: i.kind, text: i.text, topics: i.topics }))
    .join(",\n  ")

  let candidatesSection = ""
  for (const [newItemId, candidateItems] of candidates) {
    const newItem = newItems.find((i) => i.id === newItemId)
    if (!newItem) continue
    candidatesSection += `New item "${newItem.text.slice(0, 80)}":\n`
    for (const c of candidateItems) {
      candidatesSection += `  - id: ${c.id}, kind: ${c.kind}, text: "${c.text}", from: ${meetingLabel(c.meetingId)}\n`
    }
    candidatesSection += "\n"
  }

  const prompt = `You are a meeting knowledge linker. Find relationships between new items and existing items from previous meetings.

Edge types:
- "follows_up_on": the new item continues, advances, or acts on the existing item (e.g. an action item completing a prior decision)
- "supersedes": the new item replaces or overrides the existing item (e.g. a new decision changes a prior one)
- "contradicts": the new item conflicts with the existing item

NEW ITEMS:
[
  ${newItemsJson}
]

CANDIDATE EXISTING ITEMS:
${candidatesSection || "(none)"}

Rules:
- Only link items with a genuine semantic relationship
- When in doubt, do not link
- "supersedes" and "follows_up_on" usually go from the NEW item to an EXISTING item
- Return an empty array if no relationships exist

Return ONLY a JSON array: [{"newItemId": "...", "existingItemId": "...", "kind": "follows_up_on", "reason": "brief explanation"}]`

  try {
    const response = await callDeepSeek([
      { role: "system", content: "You are a knowledge graph linker. Respond only with valid JSON arrays." },
      { role: "user", content: prompt },
    ], { thinking: true })

    const raw: RawLink[] = JSON.parse(cleanJsonResponse(response))
    if (!Array.isArray(raw)) return []

    const validNewIds = new Set(newItems.map((i) => i.id))
    const validExistingIds = new Set(
      [...candidates.values()].flat().map((i) => i.id),
    )
    const now = new Date().toISOString()

    return raw
      .filter((r) =>
        r.newItemId && r.existingItemId &&
        validNewIds.has(r.newItemId) &&
        validExistingIds.has(r.existingItemId) &&
        VALID_EDGE_KINDS.includes(r.kind as KnowledgeEdgeKind),
      )
      .map((r) => ({
        id: crypto.randomUUID(),
        fromId: r.newItemId!,
        toId: r.existingItemId!,
        kind: r.kind as KnowledgeEdgeKind,
        reason: r.reason?.trim() || undefined,
        createdAt: now,
      }))
  } catch {
    return []
  }
}

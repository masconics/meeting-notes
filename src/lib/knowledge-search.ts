import type { Meeting, KnowledgeItem, KnowledgeEdge } from "@/types"
import { loadKnowledgeGraph } from "@/lib/storage"
import { tokenize } from "@/lib/context-memory"
import { embedText, cosineSimilarity } from "@/lib/embedding"

const SEMANTIC_WEIGHT = 0.73
const LEXICAL_WEIGHT = 0.384
const DEFAULT_LIMIT = 20
const TOPIC_BOOST_WEIGHT = 0.15
const HOT_TOPIC_THRESHOLD = 2

export interface RelatedEdge {
  edge: KnowledgeEdge
  otherItem: KnowledgeItem
  otherMeeting?: Meeting
  outgoing: boolean
}

export interface KnowledgeSearchResult {
  item: KnowledgeItem
  score: number
  signals: { semantic: number; lexical: number; topicBoost: number }
  meeting?: Meeting
  edges: RelatedEdge[]
}

function lexicalScore(queryTokens: string[], itemText: string): number {
  if (queryTokens.length === 0) return 0
  const itemTokenSet = new Set(tokenize(itemText))
  if (itemTokenSet.size === 0) return 0
  let overlap = 0
  for (const t of queryTokens) {
    if (itemTokenSet.has(t)) overlap++
  }
  return overlap / queryTokens.length
}

export async function searchKnowledge(
  query: string,
  allMeetings: Meeting[],
  options?: {
    excludeMeetingId?: string
    limit?: number
  },
): Promise<KnowledgeSearchResult[]> {
  const graph = loadKnowledgeGraph()
  if (graph.items.length === 0) return []

  const excludeId = options?.excludeMeetingId
  const limit = options?.limit ?? DEFAULT_LIMIT
  const candidates = excludeId
    ? graph.items.filter((i) => i.meetingId !== excludeId)
    : graph.items

  if (candidates.length === 0) return []

  const meetingMap = new Map(allMeetings.map((m) => [m.id, m]))
  const itemMap = new Map(graph.items.map((i) => [i.id, i]))
  const queryTokens = tokenize(query)

  let queryEmbedding: number[] | null = null
  try {
    queryEmbedding = await embedText(query)
  } catch {
    queryEmbedding = null
  }

  const scored: KnowledgeSearchResult[] = candidates.map((item) => {
    const semantic =
      queryEmbedding && item.embedding && item.embedding.length > 0
        ? Math.max(0, cosineSimilarity(queryEmbedding, item.embedding))
        : 0
    const lexical = lexicalScore(queryTokens, item.text)
    const raw = semantic * SEMANTIC_WEIGHT + lexical * LEXICAL_WEIGHT
    return {
      item,
      score: raw,
      signals: { semantic, lexical, topicBoost: 0 },
      meeting: meetingMap.get(item.meetingId),
      edges: [],
    }
  })

  const withScore = scored.filter((r) => r.score > 0)
  if (withScore.length === 0) return []

  withScore.sort((a, b) => b.score - a.score)

  const topItems = withScore.slice(0, 5)
  const hotTopicCounts = new Map<string, number>()
  for (const r of topItems) {
    for (const topic of r.item.topics) {
      hotTopicCounts.set(topic, (hotTopicCounts.get(topic) ?? 0) + 1)
    }
  }
  const hotTopics = new Set(
    [...hotTopicCounts.entries()]
      .filter(([, count]) => count >= HOT_TOPIC_THRESHOLD)
      .map(([topic]) => topic),
  )

  if (hotTopics.size > 0) {
    const maxBase = withScore[0]?.score ?? 1
    for (const r of withScore) {
      const overlap = r.item.topics.filter((t) => hotTopics.has(t)).length
      if (overlap > 0) {
        const boost = TOPIC_BOOST_WEIGHT * (overlap / Math.max(r.item.topics.length, 1)) * maxBase
        r.score += boost
        r.signals.topicBoost = boost
      }
    }
    withScore.sort((a, b) => b.score - a.score)
  }

  const topResults = withScore.slice(0, limit)

  for (const r of topResults) {
    r.edges = graph.edges
      .filter((e) => e.fromId === r.item.id || e.toId === r.item.id)
      .flatMap((e) => {
        const outgoing = e.fromId === r.item.id
        const otherId = outgoing ? e.toId : e.fromId
        const otherItem = itemMap.get(otherId)
        if (!otherItem) return []
        return [{
          edge: e,
          otherItem,
          otherMeeting: meetingMap.get(otherItem.meetingId),
          outgoing,
        }]
      })
  }

  const maxScore = topResults[0]?.score ?? 1
  return topResults.map((r) => ({
    ...r,
    score: maxScore > 0 ? r.score / maxScore : 0,
  }))
}

const KIND_LABELS: Record<string, string> = {
  decision: "Decisions",
  action_item: "Action Items",
  key_point: "Key Points",
  question: "Open Questions",
  commitment: "Commitments",
  risk: "Risks",
}

const KIND_ORDER = ["decision", "action_item", "key_point", "commitment", "question", "risk"]

const EDGE_LABELS_OUT: Record<string, string> = {
  follows_up_on: "Follows up on",
  supersedes: "Supersedes",
  contradicts: "Contradicts",
}

const EDGE_LABELS_IN: Record<string, string> = {
  follows_up_on: "Followed up by",
  supersedes: "Superseded by",
  contradicts: "Contradicted by",
}

function meetingLabel(meeting: Meeting | undefined): string {
  if (!meeting) return "Unknown meeting"
  const date = new Date(meeting.date).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  })
  return `${meeting.title || "Untitled"} (${date})`
}

export function buildKnowledgeContextBlock(
  results: KnowledgeSearchResult[],
  maxChars = 3000,
): string {
  if (results.length === 0) return ""

  const byKind = new Map<string, KnowledgeSearchResult[]>()
  for (const r of results) {
    const group = byKind.get(r.item.kind) ?? []
    group.push(r)
    byKind.set(r.item.kind, group)
  }

  let context = "## Knowledge from past meetings\n\n"

  for (const kind of KIND_ORDER) {
    const group = byKind.get(kind)
    if (!group || group.length === 0) continue

    context += `### ${KIND_LABELS[kind] ?? kind}\n`
    for (const r of group) {
      const status =
        r.item.kind === "action_item" && r.item.status === "open"
          ? "[open] "
          : r.item.kind === "action_item" && r.item.status === "resolved"
            ? "[resolved] "
            : ""
      const assignee = r.item.assignee ? ` — assigned to ${r.item.assignee}` : ""
      const source = meetingLabel(r.meeting)
      context += `- ${status}"${r.item.text}" (id: ${r.item.id})${assignee} — ${source}\n`

      for (const re of r.edges) {
        const label = re.outgoing
          ? EDGE_LABELS_OUT[re.edge.kind] ?? re.edge.kind
          : EDGE_LABELS_IN[re.edge.kind] ?? re.edge.kind
        const otherSource = meetingLabel(re.otherMeeting)
        context += `  → ${label}: "${re.otherItem.text.slice(0, 100)}" — ${otherSource}\n`
      }

      if (context.length > maxChars) {
        context += `\n(more results truncated)\n`
        return context.trimEnd()
      }
    }
    context += "\n"
  }

  return context.trimEnd()
}

import type { Meeting, MemoryEntry, RelatedMeeting } from "@/types"
import { loadMemory, upsertMemoryEntry, removeMemoryEntry } from "@/lib/storage"

const STOP_WORDS = new Set([
  "the", "a", "an", "and", "or", "but", "in", "on", "at", "to", "for",
  "of", "with", "by", "from", "is", "are", "was", "were", "be", "been",
  "being", "have", "has", "had", "do", "does", "did", "will", "would",
  "could", "should", "may", "might", "can", "shall", "you", "your",
  "yours", "we", "our", "ours", "they", "them", "their", "theirs",
  "he", "she", "it", "his", "her", "its", "this", "that", "these",
  "those", "am", "not", "no", "nor", "so", "if", "then", "than",
  "too", "very", "just", "about", "also", "into", "over", "after",
  "before", "between", "under", "again", "further", "here", "there",
  "when", "where", "why", "how", "all", "each", "every", "both",
  "few", "more", "most", "other", "some", "such", "only", "own",
  "same", "which", "who", "whom", "what", "up", "down", "out",
  "off", "now", "during", "above", "below", "through", "across",
])

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 1 && !STOP_WORDS.has(t))
}

function computeTF(tokens: string[]): Record<string, number> {
  const tf: Record<string, number> = {}
  for (const t of tokens) {
    tf[t] = (tf[t] || 0) + 1
  }
  const total = tokens.length || 1
  for (const t in tf) {
    tf[t] /= total
  }
  return tf
}

function computeIDF(documents: Record<string, number>[]): Record<string, number> {
  const idf: Record<string, number> = {}
  const N = documents.length
  const df: Record<string, number> = {}
  for (const doc of documents) {
    const seen = new Set<string>()
    for (const term in doc) {
      if (!seen.has(term)) {
        df[term] = (df[term] || 0) + 1
        seen.add(term)
      }
    }
  }
  for (const term in df) {
    idf[term] = Math.log((N + 1) / (df[term] + 1)) + 1
  }
  return idf
}

function cosineSimilarity(a: Record<string, number>, b: Record<string, number>, idf: Record<string, number>): number {
  let dot = 0
  let normA = 0
  let normB = 0

  for (const term in a) {
    const wA = (a[term] || 0) * (idf[term] || 0)
    dot += wA * ((b[term] || 0) * (idf[term] || 0))
    normA += wA * wA
  }
  for (const term in b) {
    const wB = (b[term] || 0) * (idf[term] || 0)
    normB += wB * wB
  }

  const denom = Math.sqrt(normA) * Math.sqrt(normB)
  return denom === 0 ? 0 : dot / denom
}

function buildMeetingContent(meeting: Meeting): string {
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

function contentHash(meeting: Meeting): string {
  const source = meeting.title + (meeting.notes || "") + (meeting.transcript || "").slice(0, 1000)
  let hash = 0
  for (let i = 0; i < source.length; i++) {
    const chr = source.charCodeAt(i)
    hash = ((hash << 5) - hash) + chr
    hash |= 0
  }
  return String(hash)
}

export function indexMeeting(meeting: Meeting, digest: string): MemoryEntry {
  const tokens = tokenize(digest)
  const tf = computeTF(tokens)

  const entry: MemoryEntry = {
    meetingId: meeting.id,
    digest,
    tf,
    indexedAt: new Date().toISOString(),
  }

  upsertMemoryEntry(entry)
  return entry
}

export function unindexMeeting(meetingId: string): void {
  removeMemoryEntry(meetingId)
}

export function findRelatedMeetings(
  queryMeeting: Meeting,
  allMeetings: Meeting[],
  limit = 5
): RelatedMeeting[] {
  const entries = loadMemory()
  if (entries.length === 0) return []

  const queryContent = buildMeetingContent(queryMeeting)
  const queryTokens = tokenize(queryContent)
  const queryTF = computeTF(queryTokens)

  const documents = entries.map((e) => e.tf)
  const idf = computeIDF([queryTF, ...documents])

  const scores = entries.map((entry) => {
    if (entry.meetingId === queryMeeting.id) return { meetingId: entry.meetingId, score: -1 }
    const meeting = allMeetings.find((m) => m.id === entry.meetingId)
    if (!meeting) return { meetingId: entry.meetingId, score: 0 }
    const score = cosineSimilarity(queryTF, entry.tf, idf)
    return { meetingId: entry.meetingId, score }
  })

  return scores
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
}

export function buildMemoryContextBlock(
  related: RelatedMeeting[],
  allMeetings: Meeting[],
  maxChars = 3000
): string {
  if (related.length === 0) return ""

  const entries = loadMemory()
  let context = ""

  for (const rel of related) {
    const meeting = allMeetings.find((m) => m.id === rel.meetingId)
    if (!meeting) continue
    const entry = entries.find((e) => e.meetingId === rel.meetingId)

    let block = `\n### ${meeting.title} (${new Date(meeting.date).toLocaleDateString()})\n`
    if (entry?.digest) {
      block += `${entry.digest}\n`
    }
    if (meeting.structuredNotes) {
      for (const section of meeting.structuredNotes.slice(0, 3)) {
        const excerpt = section.content.slice(0, 200)
        if (excerpt.trim()) block += `  ${section.title}: ${excerpt}\n`
      }
    }

    if (context.length + block.length > maxChars) break
    context += block
    context += "\n---\n"
  }

  return context
}

export function needsReindex(meeting: Meeting): boolean {
  if (!meeting.memoryDigest || !meeting.memoryIndexedAt) return true
  const currentHash = contentHash(meeting)
  return currentHash !== meeting.memoryDigest
}

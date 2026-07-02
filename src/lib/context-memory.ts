import type { Meeting, MemoryEntry, RelatedMeeting } from "@/types"
import { loadMemory, upsertMemoryEntry, removeMemoryEntry } from "@/lib/storage"
import { buildMeetingContent, contentHash } from "@/lib/meeting-content"

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
  "meeting", "discuss", "discussed", "talked", "said", "like",
  "well", "actually", "basically", "thing", "stuff", "really",
  "want", "need", "going", "okay", "yeah", "yes", "right", "know",
  "think", "thought", "maybe", "probably", "definitely", "always",
  "never", "even", "still", "got", "get", "make", "made", "let",
  "one", "first", "second", "already", "way", "day", "time",
  "people", "work", "doing", "done", "something", "anything",
  "everything", "nothing", "someone", "anyone", "everyone",
])

const STEP2_SUFFIXES: [RegExp, string][] = [
  [/ational$/, "ate"], [/tional$/, "tion"], [/enci$/, "ence"],
  [/anci$/, "ance"], [/izer$/, "ize"], [/abli$/, "able"],
  [/alli$/, "al"], [/entli$/, "ent"], [/eli$/, "e"],
  [/ousli$/, "ous"], [/ization$/, "ize"], [/ation$/, "ate"],
  [/ator$/, "ate"], [/alism$/, "al"], [/iveness$/, "ive"],
  [/fulness$/, "ful"], [/ousness$/, "ous"], [/aliti$/, "al"],
  [/iviti$/, "ive"], [/biliti$/, "ble"],
]

const STEP3_SUFFIXES: [RegExp, string][] = [
  [/icate$/, "ic"], [/ative$/, ""], [/alize$/, "al"],
  [/iciti$/, "ic"], [/ical$/, "ic"], [/ful$/, ""], [/ness$/, ""],
]

const STEP4_SUFFIXES = [
  /al$/, /ance$/, /ence$/, /er$/, /ic$/, /able$/, /ible$/,
  /ant$/, /ement$/, /ment$/, /ent$/, /ou$/, /ism$/, /ate$/,
  /iti$/, /ous$/, /ive$/, /ize$/,
]

function stemPorter(word: string): string {
  if (word.length <= 2) return word

  if (word.endsWith("sses") || word.endsWith("ies")) {
    word = word.slice(0, -2)
  } else if (word.endsWith("ss")) {
    // Keep "ss" endings as-is (Porter step 1a).
  } else if (word.endsWith("s")) {
    word = word.slice(0, -1)
  }

  if (word.endsWith("eed")) {
    if (measure(word.slice(0, -3)) > 0) word = word.slice(0, -1)
  } else if ((word.endsWith("ed") || word.endsWith("ing")) && hasVowel(word.slice(0, -2))) {
    word = word.slice(0, -2)
    if (word.endsWith("at") || word.endsWith("bl") || word.endsWith("iz")) {
      word += "e"
    } else if (endsWithDouble(word) && !/[lsz]$/.test(word)) {
      word = word.slice(0, -1)
    } else if (measure(word) === 1 && cvc(word)) {
      word += "e"
    }
  }

  if (word.endsWith("y") && hasVowel(word.slice(0, -1))) {
    word = word.slice(0, -1) + "i"
  }

  for (const [suffix, replacement] of STEP2_SUFFIXES) {
    if (word.match(suffix) && measure(word.slice(0, -suffix.source.length + 1)) > 0) {
      word = word.replace(suffix, replacement)
      break
    }
  }

  for (const [suffix, replacement] of STEP3_SUFFIXES) {
    if (word.match(suffix) && measure(word.slice(0, -suffix.source.length + 1)) > 0) {
      word = word.replace(suffix, replacement)
      break
    }
  }

  for (const suffix of STEP4_SUFFIXES) {
    if (word.match(suffix) && measure(word.slice(0, -suffix.source.length + 1)) > 1) {
      word = word.replace(suffix, "")
      break
    }
  }

  if (measure(word) > 1) {
    if (word.endsWith("e")) word = word.slice(0, -1)
    else if (endsWithDouble(word) && word.endsWith("l")) word = word.slice(0, -1)
  }

  return word
}

function measure(word: string): number {
  let count = 0
  let inVowel = false
  for (let i = 0; i < word.length; i++) {
    if (/[aeiou]/.test(word[i])) {
      if (!inVowel) { count++; inVowel = true }
    } else {
      inVowel = false
    }
  }
  return count
}

function hasVowel(word: string): boolean {
  return /[aeiou]/.test(word)
}

function endsWithDouble(word: string): boolean {
  if (word.length < 2) return false
  const c = word[word.length - 1]
  return c === word[word.length - 2] && !/[aeiouwxy]/.test(c)
}

function cvc(word: string): boolean {
  if (word.length < 3) return false
  const m = measure(word)
  const last = word[word.length - 1]
  return m === 1 &&
    !/[aeiou]/.test(word[word.length - 3]) &&
    /[aeiou]/.test(word[word.length - 2]) &&
    !/[aeiouwxy]/.test(last)
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/'s\b/g, "")
    .replace(/n't\b/g, " not")
    .replace(/'re\b/g, " are")
    .replace(/'ve\b/g, " have")
    .replace(/'ll\b/g, " will")
    .replace(/'d\b/g, " would")
    .replace(/'m\b/g, " am")
    .split(/[^a-z0-9-]+/)
    .flatMap((t) => {
      const stemmed = stemPorter(t)
      return t !== stemmed ? [t, stemmed] : [t]
    })
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
  if (N === 0) return idf
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

function cosineSimilarity(
  a: Record<string, number>,
  b: Record<string, number>,
  idf: Record<string, number>,
): number {
  let dot = 0
  let normA = 0
  let normB = 0

  for (const term in a) {
    const idfVal = idf[term] || 0
    const wA = (a[term] || 0) * idfVal
    dot += wA * ((b[term] || 0) * idfVal)
    normA += wA * wA
  }
  for (const term in b) {
    const wB = (b[term] || 0) * (idf[term] || 0)
    normB += wB * wB
  }

  const denom = Math.sqrt(normA) * Math.sqrt(normB)
  return denom === 0 ? 0 : dot / denom
}

export function indexMeeting(meeting: Meeting, digest: string): MemoryEntry {
  const tokens = tokenize(digest)
  const tf = computeTF(tokens)
  const hash = contentHash(meeting)

  const entry: MemoryEntry = {
    meetingId: meeting.id,
    digest,
    contentHash: hash,
    tf,
    indexedAt: new Date().toISOString(),
  }

  upsertMemoryEntry(entry)
  invalidateMemoryCache()
  idfCache = null
  idfDocCount = -1
  return entry
}

export function unindexMeeting(meetingId: string): void {
  removeMemoryEntry(meetingId)
  invalidateMemoryCache()
  idfCache = null
  idfDocCount = -1
}

let memoryCache: MemoryEntry[] | null = null
let cacheTime = 0
const CACHE_TTL = 30000

function getMemoryCache(): MemoryEntry[] {
  const now = Date.now()
  if (!memoryCache || now - cacheTime > CACHE_TTL) {
    memoryCache = loadMemory()
    cacheTime = now
  }
  return memoryCache
}

function invalidateMemoryCache(): void {
  memoryCache = null
  cacheTime = 0
}

let idfCache: Record<string, number> | null = null
let idfDocCount = -1

function getIDFCache(docCount: number): Record<string, number> | null {
  if (idfCache && idfDocCount === docCount) return idfCache
  return null
}

function setIDFCache(idf: Record<string, number>, docCount: number): void {
  idfCache = idf
  idfDocCount = docCount
}

export function findRelatedMeetings(
  queryMeeting: Meeting,
  allMeetings: Meeting[],
  limit = 5,
): RelatedMeeting[] {
  const entries = getMemoryCache()
  if (entries.length === 0) return []

  const meetingMap = new Map<string, Meeting>()
  for (const m of allMeetings) {
    meetingMap.set(m.id, m)
  }

  const queryContent = buildMeetingContent(queryMeeting)
  const queryTokens = tokenize(queryContent)
  const queryTF = computeTF(queryTokens)

  const documents = entries.map((e) => e.tf)
  const cachedIDF = getIDFCache(documents.length)
  const idf = cachedIDF ?? computeIDF(documents)
  if (!cachedIDF) {
    setIDFCache(idf, documents.length)
  }

  const scores: RelatedMeeting[] = []

  for (const entry of entries) {
    if (entry.meetingId === queryMeeting.id) continue
    const meeting = meetingMap.get(entry.meetingId)
    if (!meeting) continue
    const score = cosineSimilarity(queryTF, entry.tf, idf)
    if (score > 0) {
      scores.push({ meetingId: entry.meetingId, score })
    }
  }

  return scores
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
}

export function buildMemoryContextBlock(
  related: RelatedMeeting[],
  allMeetings: Meeting[],
  maxChars = 3000,
): string {
  if (related.length === 0) return ""

  const meetingMap = new Map<string, Meeting>()
  for (const m of allMeetings) {
    meetingMap.set(m.id, m)
  }

  const entries = getMemoryCache()
  const entryMap = new Map<string, MemoryEntry>()
  for (const e of entries) {
    entryMap.set(e.meetingId, e)
  }

  let context = ""

  for (const rel of related) {
    const meeting = meetingMap.get(rel.meetingId)
    if (!meeting) continue
    const entry = entryMap.get(rel.meetingId)

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

    const sep = "\n---\n"
    const total = context.length + block.length + sep.length
    if (total > maxChars) {
      if (context.length === 0) {
        context += block.slice(0, maxChars)
      }
      break
    }
    context += block
    context += sep
  }

  return context
}

export function needsReindex(meeting: Meeting, existingEntry?: MemoryEntry | null): boolean {
  const entry = existingEntry ?? getMemoryCache().find((e) => e.meetingId === meeting.id)
  if (!entry) return true
  const currentHash = contentHash(meeting)
  return currentHash !== entry.contentHash
}

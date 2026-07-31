// Custom vocabulary ("teach it once and it never misspells them again"):
// post-processes transcripts so mis-heard aliases become the canonical term,
// and renders a prompt block so every AI call knows the correct spellings.
//
// Protected names (People, attendees, speakers) are never rewritten — so
// "Christy" can stay when she's a real person even if it's also an alias
// of "Christian".
import type { DictionaryEntry, Meeting, MeetingAttendee, Person, SpeakerLabel } from "@/types"
import { loadDictionary, loadPeople } from "@/lib/storage"

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

// Unicode-aware word boundaries: \b doesn't work for terms containing
// non-ASCII letters or trailing punctuation, so use letter/number lookarounds.
const NOT_WORD_BEFORE = "(?<![\\p{L}\\p{N}])"
const NOT_WORD_AFTER = "(?![\\p{L}\\p{N}])"

export type ApplyDictionaryOptions = {
  /**
   * Names that must not be rewritten (case-insensitive).
   * Typically People + meeting attendees + speakers.
   * Case-normalization of a term to itself is still allowed.
   */
  protectNames?: Iterable<string>
}

/** Collect display names that dictionary rewrite must leave alone. */
export function collectProtectedNames(input?: {
  people?: Person[]
  attendees?: MeetingAttendee[]
  speakers?: SpeakerLabel[]
  meeting?: Pick<Meeting, "attendees" | "speakerLabels">
}): string[] {
  const names: string[] = []
  const people = input?.people ?? loadPeople()
  for (const p of people) {
    if (p.name?.trim()) names.push(p.name)
    for (const a of p.aliases ?? []) {
      if (a?.trim()) names.push(a)
    }
  }
  const attendees = input?.attendees ?? input?.meeting?.attendees ?? []
  for (const a of attendees) {
    if (a.name?.trim()) names.push(a.name)
  }
  const speakers = input?.speakers ?? input?.meeting?.speakerLabels ?? []
  for (const s of speakers) {
    if (s.name?.trim()) names.push(s.name)
  }
  return names
}

function toProtectSet(names?: Iterable<string>): Set<string> {
  const set = new Set<string>()
  if (!names) return set
  for (const n of names) {
    const t = n?.trim().toLowerCase()
    if (t) set.add(t)
  }
  return set
}

/**
 * Replace whole-word, case-insensitive occurrences of every alias (and of
 * wrongly-cased forms of the term itself) with the canonical term.
 * Applied longest-first so multi-word aliases win over their single-word parts.
 *
 * Protected names: if the matched text is a known person/attendee/speaker and
 * is not merely a case variant of the canonical term, leave it unchanged.
 */
export function applyDictionary(
  text: string,
  entries: DictionaryEntry[],
  opts?: ApplyDictionaryOptions,
): string {
  if (!text || entries.length === 0) return text
  const protect = toProtectSet(opts?.protectNames)
  let out = text
  for (const entry of entries) {
    const term = entry.term.trim()
    if (!term) continue
    const termLower = term.toLowerCase()
    const variants = [term, ...entry.aliases.map((a) => a.trim()).filter(Boolean)]
    variants.sort((a, b) => b.length - a.length)
    const pattern = new RegExp(
      `${NOT_WORD_BEFORE}(${variants.map(escapeRegex).join("|")})${NOT_WORD_AFTER}`,
      "giu",
    )
    out = out.replace(pattern, (match) => {
      const matchLower = match.toLowerCase()
      // Always allow case / spelling normalize to the canonical term itself.
      if (matchLower === termLower) return term
      // Known person name that happens to be listed as an alias — do not clobber.
      if (protect.has(matchLower)) return match
      return term
    })
  }
  return out
}

/** Correct `text` against the saved dictionary, protecting known people. */
export function correctWithSavedDictionary(
  text: string,
  opts?: ApplyDictionaryOptions & {
    /** When true (default), merge global People into protectNames. */
    includePeople?: boolean
  },
): string {
  const entries = loadDictionary()
  if (entries.length === 0) return text

  const includePeople = opts?.includePeople !== false
  const protectNames = [
    ...(opts?.protectNames ? [...opts.protectNames] : []),
    ...(includePeople ? collectProtectedNames({ people: loadPeople() }) : []),
  ]

  return applyDictionary(text, entries, { protectNames })
}

/** Renders the vocabulary block injected into AI system prompts so names and
 *  jargon come out spelled right in notes, titles, and extracted knowledge.
 *  Protected person names are not listed as "never write" aliases.
 *  Returns "" when there is nothing worth sending. */
export function dictionaryPromptBlock(
  maxChars = 900,
  opts?: ApplyDictionaryOptions & { includePeople?: boolean },
): string {
  const entries = loadDictionary()
  if (entries.length === 0) return ""

  const includePeople = opts?.includePeople !== false
  const protect = toProtectSet([
    ...(opts?.protectNames ? [...opts.protectNames] : []),
    ...(includePeople ? collectProtectedNames({ people: loadPeople() }) : []),
  ])

  const lines: string[] = []
  for (const e of entries) {
    const term = e.term.trim()
    if (!term) continue
    const aliases = e.aliases
      .map((a) => a.trim())
      .filter((a) => a && a.toLowerCase() !== term.toLowerCase() && !protect.has(a.toLowerCase()))
    const aliasNote = aliases.length > 0 ? ` (mis-hearings may appear as: ${aliases.join(", ")})` : ""
    // If the term itself is a known person, still list it as preferred spelling.
    lines.push(`- ${term}${aliasNote}`)
  }
  if (lines.length === 0) return ""

  // Mention that listed people may legitimately appear under their own names.
  let block =
    `CUSTOM VOCABULARY — prefer these spellings when the speaker means that person/term.\n` +
    `Do not rename a different person who happens to have a similar name.\n` +
    lines.join("\n")
  if (block.length > maxChars) block = `${block.slice(0, maxChars)}\n- …`
  return block
}

/** Appends the vocabulary block to a system prompt (no-op when empty). */
export function withVocabulary(systemPrompt: string): string {
  const block = dictionaryPromptBlock()
  return block ? `${systemPrompt}\n\n${block}` : systemPrompt
}

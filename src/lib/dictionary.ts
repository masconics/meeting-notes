// Custom vocabulary ("teach it once and it never misspells them again"):
// post-processes transcripts so mis-heard aliases become the canonical term,
// and renders a prompt block so every AI call knows the correct spellings.
import type { DictionaryEntry } from "@/types"
import { loadDictionary } from "@/lib/storage"

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

// Unicode-aware word boundaries: \b doesn't work for terms containing
// non-ASCII letters or trailing punctuation, so use letter/number lookarounds.
const NOT_WORD_BEFORE = "(?<![\\p{L}\\p{N}])"
const NOT_WORD_AFTER = "(?![\\p{L}\\p{N}])"

/** Replace whole-word, case-insensitive occurrences of every alias (and of
 *  wrongly-cased forms of the term itself) with the canonical term. Applied
 *  longest-first so multi-word aliases win over their single-word parts. */
export function applyDictionary(text: string, entries: DictionaryEntry[]): string {
  if (!text || entries.length === 0) return text
  let out = text
  for (const entry of entries) {
    const term = entry.term.trim()
    if (!term) continue
    const variants = [term, ...entry.aliases.map((a) => a.trim()).filter(Boolean)]
    variants.sort((a, b) => b.length - a.length)
    const pattern = new RegExp(
      `${NOT_WORD_BEFORE}(${variants.map(escapeRegex).join("|")})${NOT_WORD_AFTER}`,
      "giu",
    )
    out = out.replace(pattern, term)
  }
  return out
}

/** Convenience wrapper: correct `text` against the persisted dictionary. */
export function correctWithSavedDictionary(text: string): string {
  const entries = loadDictionary()
  return entries.length > 0 ? applyDictionary(text, entries) : text
}

/** Renders the vocabulary block injected into AI system prompts so names and
 *  jargon come out spelled right in notes, titles, and extracted knowledge.
 *  Returns "" when there is nothing worth sending. */
export function dictionaryPromptBlock(maxChars = 900): string {
  const entries = loadDictionary()
  if (entries.length === 0) return ""
  const lines: string[] = []
  for (const e of entries) {
    const aliasNote = e.aliases.length > 0 ? ` (never write: ${e.aliases.join(", ")})` : ""
    lines.push(`- ${e.term}${aliasNote}`)
  }
  let block = `CUSTOM VOCABULARY — always use these exact spellings:\n${lines.join("\n")}`
  if (block.length > maxChars) block = `${block.slice(0, maxChars)}\n- …`
  return block
}

/** Appends the vocabulary block to a system prompt (no-op when empty). */
export function withVocabulary(systemPrompt: string): string {
  const block = dictionaryPromptBlock()
  return block ? `${systemPrompt}\n\n${block}` : systemPrompt
}

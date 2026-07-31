// Agentic chat: the global-chat model can propose changes as fenced ```action
// blocks containing one JSON object each. Nothing mutates until the user
// confirms in the UI — the model proposes, the human disposes.
import type { KnowledgeStatus } from "@/types"
import { loadDictionary, saveDictionary, updateKnowledgeItem } from "@/lib/storage"

export type ChatAction =
  | { type: "update_knowledge_status"; itemId: string; status: KnowledgeStatus }
  | { type: "add_dictionary_entry"; term: string; aliases: string[] }

const VALID_STATUSES: KnowledgeStatus[] = ["open", "resolved", "superseded", "unknown"]

const ACTION_BLOCK_RE = /```action\s*\n([\s\S]*?)```/g
// Trailing partial block while a stream is still in flight (no closing fence yet).
const PARTIAL_BLOCK_RE = /```action\s*\n[\s\S]*$/

function parseAction(json: unknown): ChatAction | null {
  if (!json || typeof json !== "object") return null
  const raw = json as Record<string, unknown>
  switch (raw.type) {
    case "update_knowledge_status": {
      if (typeof raw.itemId !== "string" || !raw.itemId.trim()) return null
      const status = VALID_STATUSES.includes(raw.status as KnowledgeStatus)
        ? (raw.status as KnowledgeStatus)
        : null
      if (!status) return null
      return { type: "update_knowledge_status", itemId: raw.itemId, status }
    }
    case "add_dictionary_entry": {
      if (typeof raw.term !== "string" || !raw.term.trim()) return null
      const aliases = Array.isArray(raw.aliases)
        ? raw.aliases.filter((a): a is string => typeof a === "string" && a.trim().length > 0)
        : []
      return { type: "add_dictionary_entry", term: raw.term.trim(), aliases }
    }
    default:
      return null
  }
}

/** Extract all valid action proposals from an assistant message. */
export function parseChatActions(markdown: string): ChatAction[] {
  const actions: ChatAction[] = []
  for (const match of markdown.matchAll(ACTION_BLOCK_RE)) {
    try {
      const action = parseAction(JSON.parse(match[1].trim()))
      if (action) actions.push(action)
    } catch { /* malformed JSON block — ignore */ }
  }
  return actions
}

/** Remove action blocks (complete, and any trailing partial one mid-stream)
 *  so the rendered reply shows only prose — actions render as cards instead. */
export function stripChatActions(markdown: string): string {
  return markdown
    .replace(ACTION_BLOCK_RE, "")
    .replace(PARTIAL_BLOCK_RE, "")
    .replace(/\n{3,}/g, "\n\n")
    .trimEnd()
}

/** Human-readable summary shown on the confirmation card. */
export function describeChatAction(action: ChatAction): string {
  switch (action.type) {
    case "update_knowledge_status":
      return `Mark item as ${action.status}`
    case "add_dictionary_entry":
      return action.aliases.length > 0
        ? `Add “${action.term}” to dictionary (fixes: ${action.aliases.join(", ")})`
        : `Add “${action.term}” to dictionary`
  }
}

/** Apply a confirmed action. Returns a user-facing result message. */
export function applyChatAction(action: ChatAction): { ok: boolean; message: string } {
  switch (action.type) {
    case "update_knowledge_status": {
      const graph = updateKnowledgeItem(action.itemId, { status: action.status })
      const applied = graph.items.some((i) => i.id === action.itemId && i.status === action.status)
      return applied
        ? { ok: true, message: "Item updated" }
        : { ok: false, message: "Couldn't find that item — it may have changed since this reply" }
    }
    case "add_dictionary_entry": {
      const entries = loadDictionary()
      const existing = entries.find((e) => e.term.toLowerCase() === action.term.toLowerCase())
      if (existing) {
        const merged = [...new Set([...existing.aliases, ...action.aliases])]
        saveDictionary(entries.map((e) => (e.id === existing.id ? { ...e, aliases: merged } : e)))
        return { ok: true, message: `“${action.term}” already in dictionary — aliases merged` }
      }
      saveDictionary([...entries, { id: crypto.randomUUID(), term: action.term, aliases: action.aliases }])
      return { ok: true, message: `“${action.term}” added to your dictionary` }
    }
  }
}

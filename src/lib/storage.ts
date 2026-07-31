import { dbGet, dbSet, dbRemove, initDatabase } from "@/lib/stronghold"

const MEETINGS_KEY = "meeting-notes"
const SETTINGS_KEY = "meeting-notes-settings"
const AI_SETTINGS_KEY = "meeting-notes-ai-settings"
const TEMPLATES_KEY = "meeting-notes-templates"
const SORT_PREF_KEY = "meeting-notes-sort-pref"
const SAVED_SEARCHES_KEY = "meeting-notes-saved-searches"

const MEMORY_KEY = "meeting-notes-memory"
const KNOWLEDGE_KEY = "meeting-notes-knowledge"
const DICTIONARY_KEY = "meeting-notes-dictionary"
const SNIPPETS_KEY = "meeting-notes-snippets"

const ALL_KEYS = [MEETINGS_KEY, SETTINGS_KEY, AI_SETTINGS_KEY, TEMPLATES_KEY, MEMORY_KEY, KNOWLEDGE_KEY, DICTIONARY_KEY, SNIPPETS_KEY]

export async function hydrateFromVault(): Promise<void> {
  await initDatabase()
  for (const key of ALL_KEYS) {
    try {
      const value = await dbGet(key)
      if (value !== null) {
        localStorage.setItem(key, value)
      }
    } catch {
      // key not in vault yet, use localStorage fallback
    }
  }
}

async function persist(key: string, value: string): Promise<void> {
  try {
    await initDatabase()
    await dbSet(key, value)
  } catch (e) {
    console.error(`[storage] persist failed for ${key}:`, e)
  }
}

async function persistRemove(key: string): Promise<void> {
  try {
    await initDatabase()
    await dbRemove(key)
  } catch (e) {
    console.error(`[storage] persistRemove failed for ${key}:`, e)
  }
}

import type { Meeting, AppSettings, AISettings, MeetingTemplate, ChatMessage, MemoryEntry, KnowledgeGraph, KnowledgeItem, KnowledgeEdge, DictionaryEntry, Snippet } from "@/types"
import { DEFAULT_SETTINGS, DEFAULT_AI_SETTINGS } from "@/types"

export function loadMeetings(): Meeting[] {
  try {
    const raw = localStorage.getItem(MEETINGS_KEY)
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

export function saveMeetings(meetings: Meeting[]): void {
  const raw = JSON.stringify(meetings)
  localStorage.setItem(MEETINGS_KEY, raw)
  persist(MEETINGS_KEY, raw)
}

export function updateMeeting(id: string, patch: Partial<Meeting>): Meeting[] {
  const meetings = loadMeetings()
  const idx = meetings.findIndex((m) => m.id === id)
  if (idx < 0) return meetings
  meetings[idx] = { ...meetings[idx], ...patch }
  saveMeetings(meetings)
  return meetings
}

export function deleteMeeting(id: string): Meeting[] {
  const meetings = loadMeetings().filter((m) => m.id !== id)
  saveMeetings(meetings)
  return meetings
}

export function clearAllMeetings(): void {
  localStorage.removeItem(MEETINGS_KEY)
  persistRemove(MEETINGS_KEY)
}

export function loadSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY)
    if (!raw) return { ...DEFAULT_SETTINGS }
    return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) }
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

export function saveSettings(settings: AppSettings): void {
  const raw = JSON.stringify(settings)
  localStorage.setItem(SETTINGS_KEY, raw)
  persist(SETTINGS_KEY, raw)
}

export function loadAISettings(): AISettings {
  try {
    const raw = localStorage.getItem(AI_SETTINGS_KEY)
    if (!raw) return { ...DEFAULT_AI_SETTINGS }
    return { ...DEFAULT_AI_SETTINGS, ...JSON.parse(raw) }
  } catch {
    return { ...DEFAULT_AI_SETTINGS }
  }
}

export function saveAISettings(settings: AISettings): void {
  const raw = JSON.stringify(settings)
  localStorage.setItem(AI_SETTINGS_KEY, raw)
  persist(AI_SETTINGS_KEY, raw)
}

const SECURE_API_KEY_KEY = "deepseek-api-key"

async function getSecureStore() {
  const { load } = await import("@tauri-apps/plugin-store")
  return await load("meeting-notes-secure.json", { defaults: {}, autoSave: true })
}

export async function saveApiKey(apiKey: string): Promise<void> {
  const store = await getSecureStore()
  await store.set(SECURE_API_KEY_KEY, apiKey)
}

export async function loadApiKey(): Promise<string> {
  try {
    const store = await getSecureStore()
    const value = await store.get<string>(SECURE_API_KEY_KEY)
    return value ?? ""
  } catch {
    return ""
  }
}

export function loadTemplates(): MeetingTemplate[] {
  try {
    const raw = localStorage.getItem(TEMPLATES_KEY)
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

export function saveTemplates(templates: MeetingTemplate[]): void {
  const raw = JSON.stringify(templates)
  localStorage.setItem(TEMPLATES_KEY, raw)
  persist(TEMPLATES_KEY, raw)
}

export function saveChatHistory(meetingId: string, messages: ChatMessage[]): void {
  updateMeeting(meetingId, { chatHistory: messages })
}

type SortKey = "date-desc" | "date-asc" | "duration-desc" | "duration-asc" | "title-asc" | "title-desc"

export function loadSortPreference(): SortKey {
  try {
    const raw = localStorage.getItem(SORT_PREF_KEY)
    if (raw && ["date-desc", "date-asc", "duration-desc", "duration-asc", "title-asc", "title-desc"].includes(raw)) {
      return raw as SortKey
    }
    return "date-desc"
  } catch {
    return "date-desc"
  }
}

export function saveSortPreference(key: SortKey): void {
  localStorage.setItem(SORT_PREF_KEY, key)
}

export function loadSavedSearches(): string[] {
  try {
    const raw = localStorage.getItem(SAVED_SEARCHES_KEY)
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

export function saveSavedSearches(searches: string[]): void {
  localStorage.setItem(SAVED_SEARCHES_KEY, JSON.stringify(searches))
}

export function loadMemory(): MemoryEntry[] {
  try {
    const raw = localStorage.getItem(MEMORY_KEY)
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

function saveMemory(entries: MemoryEntry[]): void {
  const raw = JSON.stringify(entries)
  localStorage.setItem(MEMORY_KEY, raw)
  persist(MEMORY_KEY, raw)
}

export function upsertMemoryEntry(entry: MemoryEntry): MemoryEntry[] {
  const entries = loadMemory()
  const idx = entries.findIndex((e) => e.meetingId === entry.meetingId)
  if (idx >= 0) {
    entries[idx] = entry
  } else {
    entries.push(entry)
  }
  saveMemory(entries)
  return entries
}

export function removeMemoryEntry(meetingId: string): MemoryEntry[] {
  const entries = loadMemory().filter((e) => e.meetingId !== meetingId)
  saveMemory(entries)
  return entries
}

const EMPTY_GRAPH: KnowledgeGraph = { items: [], edges: [], version: "1", lastUpdated: "" }

export function loadKnowledgeGraph(): KnowledgeGraph {
  try {
    const raw = localStorage.getItem(KNOWLEDGE_KEY)
    if (!raw) return { ...EMPTY_GRAPH }
    const graph = JSON.parse(raw)
    if (!graph.edges) graph.edges = []
    return graph
  } catch {
    return { ...EMPTY_GRAPH }
  }
}

function saveKnowledgeGraph(graph: KnowledgeGraph): void {
  const raw = JSON.stringify(graph)
  localStorage.setItem(KNOWLEDGE_KEY, raw)
  persist(KNOWLEDGE_KEY, raw)
}

export function replaceKnowledgeForMeeting(meetingId: string, items: KnowledgeItem[]): KnowledgeGraph {
  const graph = loadKnowledgeGraph()
  const oldIds = new Set(graph.items.filter((i) => i.meetingId === meetingId).map((i) => i.id))
  graph.items = graph.items.filter((i) => i.meetingId !== meetingId)
  graph.items.push(...items)
  graph.edges = graph.edges.filter((e) => !oldIds.has(e.fromId) && !oldIds.has(e.toId))
  graph.lastUpdated = new Date().toISOString()
  saveKnowledgeGraph(graph)
  return graph
}

export function removeKnowledgeForMeeting(meetingId: string): KnowledgeGraph {
  const graph = loadKnowledgeGraph()
  const oldIds = new Set(graph.items.filter((i) => i.meetingId === meetingId).map((i) => i.id))
  graph.items = graph.items.filter((i) => i.meetingId !== meetingId)
  graph.edges = graph.edges.filter((e) => !oldIds.has(e.fromId) && !oldIds.has(e.toId))
  graph.lastUpdated = new Date().toISOString()
  saveKnowledgeGraph(graph)
  return graph
}

export function addKnowledgeEdges(edges: KnowledgeEdge[]): KnowledgeGraph {
  const graph = loadKnowledgeGraph()
  graph.edges.push(...edges)
  graph.lastUpdated = new Date().toISOString()
  saveKnowledgeGraph(graph)
  return graph
}

export function updateKnowledgeItem(id: string, patch: Partial<KnowledgeItem>): KnowledgeGraph {
  const graph = loadKnowledgeGraph()
  const idx = graph.items.findIndex((i) => i.id === id)
  if (idx >= 0) {
    graph.items[idx] = { ...graph.items[idx], ...patch }
    graph.lastUpdated = new Date().toISOString()
    saveKnowledgeGraph(graph)
  }
  return graph
}

export function loadDictionary(): DictionaryEntry[] {
  try {
    const raw = localStorage.getItem(DICTIONARY_KEY)
    const parsed = raw ? JSON.parse(raw) : []
    if (!Array.isArray(parsed)) return []
    return parsed.filter((e) => e && typeof e.term === "string" && e.term.trim())
  } catch {
    return []
  }
}

export function saveDictionary(entries: DictionaryEntry[]): void {
  const raw = JSON.stringify(entries)
  localStorage.setItem(DICTIONARY_KEY, raw)
  persist(DICTIONARY_KEY, raw)
}

export function loadSnippets(): Snippet[] {
  try {
    const raw = localStorage.getItem(SNIPPETS_KEY)
    const parsed = raw ? JSON.parse(raw) : []
    if (!Array.isArray(parsed)) return []
    return parsed.filter((s) => s && typeof s.trigger === "string" && s.trigger.trim() && typeof s.expansion === "string")
  } catch {
    return []
  }
}

export function saveSnippets(snippets: Snippet[]): void {
  const raw = JSON.stringify(snippets)
  localStorage.setItem(SNIPPETS_KEY, raw)
  persist(SNIPPETS_KEY, raw)
}

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
const FOLDERS_KEY = "meeting-notes-folders"
const RECIPES_KEY = "meeting-notes-recipes"
const PEOPLE_KEY = "meeting-notes-people"

const ALL_KEYS = [
  MEETINGS_KEY,
  SETTINGS_KEY,
  AI_SETTINGS_KEY,
  TEMPLATES_KEY,
  MEMORY_KEY,
  KNOWLEDGE_KEY,
  DICTIONARY_KEY,
  SNIPPETS_KEY,
  FOLDERS_KEY,
  RECIPES_KEY,
  PEOPLE_KEY,
]

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

import type {
  Meeting,
  AppSettings,
  AISettings,
  MeetingTemplate,
  ChatMessage,
  MemoryEntry,
  KnowledgeGraph,
  KnowledgeItem,
  KnowledgeEdge,
  DictionaryEntry,
  Snippet,
  Folder,
  Recipe,
  Person,
} from "@/types"
import { DEFAULT_SETTINGS, DEFAULT_AI_SETTINGS, TRANSCRIPTION_MODELS, BUILTIN_RECIPES } from "@/types"

export function loadMeetings(): Meeting[] {
  try {
    const raw = localStorage.getItem(MEETINGS_KEY)
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

/**
 * Rebuild each tag's meetingIds from Meeting.folderIds (source of truth).
 * Prevents desync where rail counts show membership but filter finds nothing.
 */
function rebuildFolderMeetingIds(meetings: Meeting[]): void {
  try {
    const raw = localStorage.getItem(FOLDERS_KEY)
    if (!raw) return
    const folders = JSON.parse(raw) as Folder[]
    if (!Array.isArray(folders) || folders.length === 0) return
    let changed = false
    for (const f of folders) {
      const next = meetings.filter((m) => m.folderIds?.includes(f.id)).map((m) => m.id)
      const prev = f.meetingIds ?? []
      if (
        next.length !== prev.length ||
        next.some((id, i) => id !== prev[i])
      ) {
        f.meetingIds = next
        changed = true
      }
    }
    if (changed) {
      const out = JSON.stringify(folders)
      localStorage.setItem(FOLDERS_KEY, out)
      persist(FOLDERS_KEY, out)
    }
  } catch {
    /* ignore folder rebuild errors */
  }
}

export function saveMeetings(meetings: Meeting[]): void {
  const raw = JSON.stringify(meetings)
  localStorage.setItem(MEETINGS_KEY, raw)
  persist(MEETINGS_KEY, raw)
  rebuildFolderMeetingIds(meetings)
  void writeMcpSnapshot()
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
    const parsed = { ...DEFAULT_SETTINGS, ...JSON.parse(raw) } as AppSettings
    if (!(parsed.transcriptionModel in TRANSCRIPTION_MODELS)) {
      parsed.transcriptionModel = DEFAULT_SETTINGS.transcriptionModel
    }
    return parsed
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
const SECURE_SLACK_WEBHOOK_KEY = "slack-webhook-url"

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

export async function saveSlackWebhookUrl(url: string): Promise<void> {
  const store = await getSecureStore()
  await store.set(SECURE_SLACK_WEBHOOK_KEY, url)
}

export async function loadSlackWebhookUrl(): Promise<string> {
  try {
    const store = await getSecureStore()
    const value = await store.get<string>(SECURE_SLACK_WEBHOOK_KEY)
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

// ─── Folders ─────────────────────────────────────────────────────────────────

export function loadFolders(): Folder[] {
  try {
    const raw = localStorage.getItem(FOLDERS_KEY)
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function saveFolders(folders: Folder[]): void {
  const raw = JSON.stringify(folders)
  localStorage.setItem(FOLDERS_KEY, raw)
  persist(FOLDERS_KEY, raw)
  void writeMcpSnapshot()
}

export function createFolder(name: string, color?: string): Folder {
  const folder: Folder = {
    id: crypto.randomUUID(),
    name: name.trim() || "Untitled",
    color,
    meetingIds: [],
    createdAt: new Date().toISOString(),
  }
  const folders = loadFolders()
  folders.push(folder)
  saveFolders(folders)
  return folder
}

export function updateFolder(id: string, patch: Partial<Folder>): Folder[] {
  const folders = loadFolders()
  const idx = folders.findIndex((f) => f.id === id)
  if (idx < 0) return folders
  folders[idx] = { ...folders[idx], ...patch }
  saveFolders(folders)
  return folders
}

export function deleteFolder(id: string): Folder[] {
  const folders = loadFolders().filter((f) => f.id !== id)
  saveFolders(folders)
  const meetings = loadMeetings().map((m) => ({
    ...m,
    folderIds: m.folderIds?.filter((fid) => fid !== id),
  }))
  saveMeetings(meetings)
  return folders
}

export function assignMeetingToFolder(meetingId: string, folderId: string): void {
  const folders = loadFolders()
  const folder = folders.find((f) => f.id === folderId)
  if (folder && !folder.meetingIds.includes(meetingId)) {
    folder.meetingIds.push(meetingId)
    saveFolders(folders)
  }
  const meetings = loadMeetings()
  const meeting = meetings.find((m) => m.id === meetingId)
  if (meeting) {
    const ids = new Set(meeting.folderIds ?? [])
    ids.add(folderId)
    updateMeeting(meetingId, { folderIds: [...ids] })
  }
}

export function removeMeetingFromFolder(meetingId: string, folderId: string): void {
  const folders = loadFolders()
  const folder = folders.find((f) => f.id === folderId)
  if (folder) {
    folder.meetingIds = folder.meetingIds.filter((id) => id !== meetingId)
    saveFolders(folders)
  }
  const meeting = loadMeetings().find((m) => m.id === meetingId)
  if (meeting?.folderIds) {
    updateMeeting(meetingId, {
      folderIds: meeting.folderIds.filter((id) => id !== folderId),
    })
  }
}

// ─── Recipes ─────────────────────────────────────────────────────────────────

export function loadRecipes(): Recipe[] {
  try {
    const raw = localStorage.getItem(RECIPES_KEY)
    if (!raw) {
      saveRecipes(BUILTIN_RECIPES)
      return [...BUILTIN_RECIPES]
    }
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed) || parsed.length === 0) {
      saveRecipes(BUILTIN_RECIPES)
      return [...BUILTIN_RECIPES]
    }
    // Ensure built-ins exist; re-sync runOnStop so product defaults (e.g. standup
    // after enhance) apply without wiping custom prompts.
    const byId = new Map<string, Recipe>(parsed.map((r: Recipe) => [r.id, r]))
    for (const builtin of BUILTIN_RECIPES) {
      const existing = byId.get(builtin.id)
      if (!existing) {
        byId.set(builtin.id, builtin)
      } else if (existing.builtin !== false) {
        byId.set(builtin.id, {
          ...existing,
          name: builtin.name,
          icon: builtin.icon ?? existing.icon,
          builtin: true,
          runOnStop: builtin.runOnStop,
        })
      }
    }
    return [...byId.values()]
  } catch {
    return [...BUILTIN_RECIPES]
  }
}

export function saveRecipes(recipes: Recipe[]): void {
  const raw = JSON.stringify(recipes)
  localStorage.setItem(RECIPES_KEY, raw)
  persist(RECIPES_KEY, raw)
}

export function upsertRecipe(recipe: Recipe): Recipe[] {
  const recipes = loadRecipes()
  const idx = recipes.findIndex((r) => r.id === recipe.id)
  if (idx >= 0) recipes[idx] = recipe
  else recipes.push(recipe)
  saveRecipes(recipes)
  return recipes
}

export function deleteRecipe(id: string): Recipe[] {
  const recipes = loadRecipes().filter((r) => r.id !== id || r.builtin)
  saveRecipes(recipes)
  return recipes
}

// ─── People ──────────────────────────────────────────────────────────────────

export function loadPeople(): Person[] {
  try {
    const raw = localStorage.getItem(PEOPLE_KEY)
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function savePeople(people: Person[]): void {
  const raw = JSON.stringify(people)
  localStorage.setItem(PEOPLE_KEY, raw)
  persist(PEOPLE_KEY, raw)
  void writeMcpSnapshot()
}

export function upsertPerson(person: Person): Person[] {
  const people = loadPeople()
  const idx = people.findIndex((p) => p.id === person.id)
  if (idx >= 0) people[idx] = person
  else people.push(person)
  savePeople(people)
  return people
}

export function updatePerson(id: string, patch: Partial<Person>): Person[] {
  const people = loadPeople()
  const idx = people.findIndex((p) => p.id === id)
  if (idx < 0) return people
  people[idx] = { ...people[idx], ...patch }
  savePeople(people)
  return people
}

export function deletePerson(id: string): Person[] {
  const people = loadPeople().filter((p) => p.id !== id)
  savePeople(people)
  return people
}

/** Find or create a person by name/email; link meeting if provided. */
export function ensurePerson(opts: {
  name: string
  email?: string
  meetingId?: string
}): Person {
  const name = opts.name.trim()
  const email = opts.email?.trim().toLowerCase()
  const people = loadPeople()
  const lower = name.toLowerCase()
  let person = people.find(
    (p) =>
      (email && p.email?.toLowerCase() === email) ||
      p.name.toLowerCase() === lower ||
      p.aliases.some((a) => a.toLowerCase() === lower),
  )
  if (!person) {
    person = {
      id: crypto.randomUUID(),
      name,
      aliases: [],
      email: opts.email,
      notes: "",
      meetingIds: opts.meetingId ? [opts.meetingId] : [],
    }
    people.push(person)
  } else if (opts.meetingId && !person.meetingIds.includes(opts.meetingId)) {
    person.meetingIds.push(opts.meetingId)
    if (opts.email && !person.email) person.email = opts.email
  }
  savePeople(people)
  return person
}

export function linkPeopleFromMeeting(meeting: Meeting): Person[] {
  const attendees = meeting.attendees ?? []
  for (const a of attendees) {
    if (!a.name?.trim()) continue
    ensurePerson({ name: a.name, email: a.email, meetingId: meeting.id })
  }
  for (const s of meeting.speakerLabels ?? []) {
    if (!s.name?.trim()) continue
    ensurePerson({ name: s.name, meetingId: meeting.id })
  }
  const graph = loadKnowledgeGraph()
  for (const item of graph.items) {
    if (item.meetingId !== meeting.id) continue
    if (item.kind === "action_item") {
      const assignee = item.assignee?.trim()
      if (assignee) ensurePerson({ name: assignee, meetingId: meeting.id })
    }
    const speaker = item.speaker?.trim()
    if (speaker) ensurePerson({ name: speaker, meetingId: meeting.id })
  }
  return loadPeople()
}

// ─── MCP snapshot ────────────────────────────────────────────────────────────

export async function writeMcpSnapshot(): Promise<void> {
  try {
    const settings = loadSettings()
    if (!settings.mcpEnabled) return
    const { invoke } = await import("@tauri-apps/api/core")
    const payload = {
      version: 1,
      updatedAt: new Date().toISOString(),
      meetings: loadMeetings().map((m) => ({
        id: m.id,
        title: m.title,
        date: m.date,
        duration: m.duration,
        notes: m.notes,
        enhancedNotes: m.enhancedNotes,
        brief: m.brief,
        folderIds: m.folderIds ?? [],
        attendees: m.attendees ?? [],
        personIds: m.personIds ?? [],
        transcriptPreview: (m.transcript || "").slice(0, 2000),
      })),
      folders: loadFolders(),
      people: loadPeople(),
      openActions: loadKnowledgeGraph().items.filter(
        (i) => i.kind === "action_item" && (i.status === "open" || i.status === "unknown"),
      ),
    }
    await invoke("write_mcp_snapshot", { snapshot: payload })
  } catch (e) {
    console.warn("[storage] MCP snapshot write skipped:", e)
  }
}

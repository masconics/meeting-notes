import type { Meeting, AppSettings, AISettings, MeetingTemplate, ChatMessage } from "@/types"
import { DEFAULT_SETTINGS, DEFAULT_AI_SETTINGS } from "@/types"

const MEETINGS_KEY = "meeting-notes"
const SETTINGS_KEY = "meeting-notes-settings"
const AI_SETTINGS_KEY = "meeting-notes-ai-settings"
const TEMPLATES_KEY = "meeting-notes-templates"

export function loadMeetings(): Meeting[] {
  try {
    const raw = localStorage.getItem(MEETINGS_KEY)
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

export function saveMeetings(meetings: Meeting[]): void {
  localStorage.setItem(MEETINGS_KEY, JSON.stringify(meetings))
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
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings))
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
  localStorage.setItem(AI_SETTINGS_KEY, JSON.stringify(settings))
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
  localStorage.setItem(TEMPLATES_KEY, JSON.stringify(templates))
}

export function saveChatHistory(meetingId: string, messages: ChatMessage[]): void {
  updateMeeting(meetingId, { chatHistory: messages })
}


export interface MeetingSection {
  title: string
  content: string
}

export interface ChatMessage {
  role: "user" | "assistant"
  content: string
  timestamp: string
}

export interface QuickAction {
  label: string
  icon: string
  prompt: string
}

export interface MeetingTemplate {
  id: string
  name: string
  icon: string
  sections: string[]
  quickActions: QuickAction[]
}

export interface SpeakerLabel {
  name: string
  color: string
}

export interface TranscriptSegment {
  speakerIndex: number
  text: string
}

export interface Meeting {
  id: string
  title: string
  date: string
  duration: number
  transcript: string
  notes: string
  templateId?: string
  structuredNotes?: MeetingSection[]
  enhancedNotes?: string
  chatHistory?: ChatMessage[]
  speakerLabels?: SpeakerLabel[]
  transcriptSegments?: TranscriptSegment[]
  brief?: string
  memoryDigest?: string
  memoryIndexedAt?: string
}

export interface MemoryEntry {
  meetingId: string
  digest: string
  tf: Record<string, number>
  indexedAt: string
}

export interface RelatedMeeting {
  meetingId: string
  score: number
}

export interface AISettings {
  apiKey: string
  model: string
  enabled: boolean
}

// Transcription is fixed to one on-device engine/model (Parakeet v3), so there
// is no engine/model setting. Stale keys in stored settings are ignored.
export interface AppSettings {
  audioSource: "mic" | "system" | "both"
  preferredDeviceId: string
  speechLang: string
  titlePrefix: string
  theme: "light" | "dark" | "system"
}

export const DEFAULT_AI_SETTINGS: AISettings = {
  apiKey: "",
  model: "deepseek-v4-pro",
  enabled: true,
}

export const DEFAULT_SETTINGS: AppSettings = {
  audioSource: "mic",
  preferredDeviceId: "default",
  speechLang: "auto",
  titlePrefix: "",
  theme: "system",
}

export const AI_MODELS: Record<string, string> = {
  "deepseek-v4-flash": "DeepSeek V4 Flash — fast, great for chat",
  "deepseek-v4-pro": "DeepSeek V4 Pro — powerful, best for enhancement",
}

export const SPEECH_LANGS: Record<string, string> = {
  "auto": "Auto-detect",
  "en": "English",
  "zh": "Chinese (Mandarin)",
  "yue": "Cantonese",
  "ja": "Japanese",
  "ko": "Korean",
  "es": "Spanish",
  "fr": "French",
  "de": "German",
  "it": "Italian",
  "pt": "Portuguese",
  "ro": "Romanian",
  "nl": "Dutch",
  "da": "Danish",
  "sv": "Swedish",
  "fi": "Finnish",
  "hu": "Hungarian",
  "et": "Estonian",
  "lv": "Latvian",
  "lt": "Lithuanian",
  "mt": "Maltese",
  "pl": "Polish",
  "cs": "Czech",
  "sk": "Slovak",
  "sl": "Slovenian",
  "hr": "Croatian",
  "bs": "Bosnian",
  "ru": "Russian",
  "uk": "Ukrainian",
  "be": "Belarusian",
  "bg": "Bulgarian",
  "sr": "Serbian",
  "el": "Greek",
}

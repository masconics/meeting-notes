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
}

export interface AISettings {
  apiKey: string
  model: string
  enabled: boolean
}

export type AsrEngine = "whisper" | "moonshine"

export interface AppSettings {
  audioSource: "mic" | "system"
  preferredDeviceId: string
  speechLang: string
  titlePrefix: string
  theme: "light" | "dark" | "system"
  // On-device transcription engine. whisper = whisper.cpp small.en (accurate);
  // moonshine = Moonshine tiny (lower latency, better for live segments).
  asrEngine: AsrEngine
}

export const ASR_ENGINES: Record<AsrEngine, string> = {
  whisper: "Whisper small.en — most accurate",
  moonshine: "Moonshine tiny — fastest, low latency",
}

export const DEFAULT_AI_SETTINGS: AISettings = {
  apiKey: "",
  model: "deepseek-v4-pro",
  enabled: true,
}

export const DEFAULT_SETTINGS: AppSettings = {
  audioSource: "mic",
  preferredDeviceId: "default",
  speechLang: "en-US",
  titlePrefix: "",
  theme: "system",
  asrEngine: "moonshine",
}

export const AI_MODELS: Record<string, string> = {
  "deepseek-v4-flash": "DeepSeek V4 Flash — fast, great for chat",
  "deepseek-v4-pro": "DeepSeek V4 Pro — powerful, best for enhancement",
}

export const SPEECH_LANGS: Record<string, string> = {
  "en-US": "English (US)",
  "en-GB": "English (UK)",
  "es-ES": "Spanish",
  "fr-FR": "French",
  "de-DE": "German",
  "ja-JP": "Japanese",
  "ko-KR": "Korean",
  "zh-CN": "Chinese (Mandarin)",
  "pt-BR": "Portuguese (Brazil)",
  "it-IT": "Italian",
  "nl-NL": "Dutch",
  "ar-SA": "Arabic",
  "hi-IN": "Hindi",
}

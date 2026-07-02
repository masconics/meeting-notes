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
  transcriptSegments?: { speakerIndex: number; text: string }[]
  brief?: string
  memoryDigest?: string
  memoryIndexedAt?: string
}

export interface MemoryEntry {
  meetingId: string
  digest: string
  contentHash: string
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

export type TranscriptionModel = "parakeet-v3" | "qwen3-asr"

export interface AppSettings {
  audioSource: "mic" | "system" | "both"
  preferredDeviceId: string
  speechLang: string
  transcriptionModel: TranscriptionModel
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
  transcriptionModel: "parakeet-v3",
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

export const TRANSCRIPTION_MODELS: Record<TranscriptionModel, {
  name: string
  label: string
  description: string
  size: string
  source: string
  runtime: string
  bestFor: string
  capabilities: string[]
  limitations: string[]
}> = {
  "parakeet-v3": {
    name: "Parakeet TDT 0.6B v3",
    label: "Fast live meetings",
    description: "CoreML Parakeet model optimized for low-latency local meeting transcription.",
    size: "~325 MB",
    source: "FluidInference/parakeet-tdt-0.6b-v3-coreml",
    runtime: "Apple Neural Engine",
    bestFor: "Live meeting capture, lower latency, reliable continuous recording",
    capabilities: [
      "Live streaming",
      "Mic, system, and both-source capture",
      "Multilingual ASR",
      "Best default for meetings",
    ],
    limitations: [
      "Less broad language identification than Qwen3",
    ],
  },
  "qwen3-asr": {
    name: "Qwen3 ASR 0.6B int8",
    label: "Multilingual language ID",
    description: "Native CoreML Qwen3 ASR model for broad multilingual recognition.",
    size: "~900 MB",
    source: "FluidInference/qwen3-asr-0.6b-coreml/int8",
    runtime: "CoreML, macOS 15+",
    bestFor: "Multilingual audio, language identification, Chinese dialect coverage",
    capabilities: [
      "30 languages",
      "22 Chinese dialects",
      "Automatic language detection",
      "Batch and accumulated live transcription",
    ],
    limitations: [
      "Requires macOS 15 or newer",
      "Higher disk and memory use",
      "Live updates are accumulated, not token-streamed",
    ],
  },
}

export interface Meeting {
  id: string
  title: string
  date: string
  duration: number
  transcript: string
  notes: string
}

export interface AppSettings {
  audioSource: "mic" | "system"
  preferredDeviceId: string
  speechLang: string
  titlePrefix: string
  theme: "light" | "dark" | "system"
}

export const DEFAULT_SETTINGS: AppSettings = {
  audioSource: "mic",
  preferredDeviceId: "default",
  speechLang: "en-US",
  titlePrefix: "",
  theme: "system",
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

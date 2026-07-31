// Audio-file import: the user picks an existing recording (mp3/m4a/wav/…),
// the Rust backend hands its path to the ASR sidecar's batch protocol, and
// the transcript comes back as plain text. No audio crosses the JS/Rust
// boundary — the sidecar loads and resamples the file itself.

import { invoke } from "@tauri-apps/api/core"
import { loadSettings } from "@/lib/storage"

export const AUDIO_FILE_EXTENSIONS = ["mp3", "m4a", "wav", "aac", "aiff", "caf", "flac", "ogg", "mp4", "mov"]

export interface ImportedTranscript {
  text: string
  fileName: string
}

/** Open a file picker and transcribe the selected audio file.
 * Returns null when the user cancels; throws on transcription failure. */
export async function pickAndTranscribeAudio(): Promise<ImportedTranscript | null> {
  const { open } = await import("@tauri-apps/plugin-dialog")
  const selected = await open({
    multiple: false,
    filters: [{ name: "Audio", extensions: AUDIO_FILE_EXTENSIONS }],
  })
  if (!selected || typeof selected !== "string") return null

  const settings = loadSettings()
  const fileName = selected.split("/").pop() ?? "audio"
  const text = await invoke<string>("transcribe_audio_file_fluid", {
    path: selected,
    language: settings.speechLang === "auto" ? null : settings.speechLang || null,
    model: settings.transcriptionModel,
  })
  return { text: text.trim(), fileName }
}

// Audio-file import: the user picks an existing recording (mp3/m4a/wav/…),
// the Rust backend hands its path to the ASR sidecar's batch protocol, and
// the transcript comes back as plain text. No audio crosses the JS/Rust
// boundary — the sidecar loads and resamples the file itself.
// Optional diarization rewrites the transcript with Speaker N: labels.

import { invoke } from "@tauri-apps/api/core"
import { loadSettings } from "@/lib/storage"
import {
  diarizeAudioFile,
  speakersFromDiarize,
  transcriptSegmentsFromDiarize,
  type DiarizeResult,
} from "@/lib/diarize"
import type { SpeakerLabel } from "@/types"

export const AUDIO_FILE_EXTENSIONS = ["mp3", "m4a", "wav", "aac", "aiff", "caf", "flac", "ogg", "mp4", "mov"]

export interface ImportedTranscript {
  text: string
  fileName: string
  /** Set when FluidAudio offline diarization succeeded. */
  diarize?: DiarizeResult
  speakerLabels?: SpeakerLabel[]
  transcriptSegments?: { speakerIndex: number; text: string }[]
  /** Absolute path to the source file (for a later diarize-only pass). */
  path?: string
}

/** Open a file picker and transcribe the selected audio file.
 * Returns null when the user cancels; throws on transcription failure. */
export async function pickAndTranscribeAudio(opts?: {
  diarize?: boolean
}): Promise<ImportedTranscript | null> {
  const { open } = await import("@tauri-apps/plugin-dialog")
  const selected = await open({
    multiple: false,
    filters: [{ name: "Audio", extensions: AUDIO_FILE_EXTENSIONS }],
  })
  if (!selected || typeof selected !== "string") return null

  const settings = loadSettings()
  const fileName = selected.split("/").pop() ?? "audio"
  const language = settings.speechLang === "auto" ? null : settings.speechLang || null
  const doDiarize = opts?.diarize ?? settings.diarizeOnStop !== false

  // When diarizing with ASR-per-segment, prefer the labeled transcript from
  // FluidAudio over a single full-file pass (better speaker alignment).
  if (doDiarize) {
    try {
      const diarize = await diarizeAudioFile(selected, { language, withAsr: true })
      const labeled = (diarize.transcript ?? "").trim()
      if (labeled) {
        return {
          text: labeled,
          fileName,
          diarize,
          speakerLabels: speakersFromDiarize(diarize),
          transcriptSegments: transcriptSegmentsFromDiarize(diarize),
          path: selected,
        }
      }
      // Diarization ran but no segment text — fall through to full ASR.
    } catch {
      // Fall back to plain transcription if diarizer models fail.
    }
  }

  const text = await invoke<string>("transcribe_audio_file_fluid", {
    path: selected,
    language,
    model: settings.transcriptionModel,
  })
  return { text: text.trim(), fileName, path: selected }
}

// FluidAudio offline diarization (pyannote Community-1 / VBx) via the fluidasr sidecar.

import { invoke } from "@tauri-apps/api/core"
import type { SpeakerLabel } from "@/types"
import { SPEAKER_TAILWIND_COLORS } from "@/lib/constants"

export interface DiarizeSegment {
  speakerId: string
  start: number
  end: number
  quality: number
  text?: string | null
}

export interface DiarizeResult {
  segments: DiarizeSegment[]
  speakers: string[]
  transcript?: string | null
  durationSeconds: number
}

export async function diarizeAudioFile(
  path: string,
  opts?: { language?: string | null; withAsr?: boolean },
): Promise<DiarizeResult> {
  return invoke<DiarizeResult>("diarize_audio_file_fluid", {
    path,
    language: opts?.language ?? null,
    withAsr: opts?.withAsr ?? true,
  })
}

/** Map diarization speaker labels into app SpeakerLabel colors. */
export function speakersFromDiarize(result: DiarizeResult): SpeakerLabel[] {
  const names =
    result.speakers.length > 0
      ? result.speakers
      : [...new Set(result.segments.map((s) => s.speakerId))].filter(Boolean)
  return names.map((name, i) => ({
    name,
    color: SPEAKER_TAILWIND_COLORS[i % SPEAKER_TAILWIND_COLORS.length],
  }))
}

/** Build transcriptSegments from diarized segments that include text. */
export function transcriptSegmentsFromDiarize(
  result: DiarizeResult,
): { speakerIndex: number; text: string }[] {
  const order = speakersFromDiarize(result).map((s) => s.name)
  const indexOf = (id: string) => {
    const i = order.findIndex((n) => n.toLowerCase() === id.toLowerCase())
    return i >= 0 ? i : 0
  }
  return result.segments
    .filter((s) => (s.text ?? "").trim())
    .map((s) => ({
      speakerIndex: indexOf(s.speakerId),
      text: (s.text ?? "").trim(),
    }))
}

/**
 * Format a timeline summary for the note (when ASR-per-segment is off or empty).
 * e.g. "Speaker 1 0:12–0:45 · Speaker 2 0:46–1:10"
 */
export function formatDiarizeTimeline(result: DiarizeResult): string {
  if (result.segments.length === 0) return ""
  const fmt = (sec: number) => {
    const m = Math.floor(sec / 60)
    const s = Math.floor(sec % 60)
    return `${m}:${String(s).padStart(2, "0")}`
  }
  return result.segments
    .map((seg) => `${seg.speakerId} ${fmt(seg.start)}–${fmt(seg.end)}`)
    .join("\n")
}

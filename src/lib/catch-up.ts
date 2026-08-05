// Mid-call catch-up: slice recent transcript by wall-clock recording duration.

/**
 * Approximate "last N minutes" of a live transcript.
 * We don't store per-word timestamps, so we use character-proportion of duration
 * as a coarse window — good enough for "what did I miss?" during a call.
 */
export function sliceRecentTranscript(
  transcript: string,
  opts: {
    /** Total recording duration so far (seconds). */
    durationSecs: number
    /** How many seconds of conversation to include. */
    windowSecs?: number
  },
): { text: string; windowSecs: number; approxFromSec: number } {
  const windowSecs = Math.max(30, opts.windowSecs ?? 180)
  const text = transcript.trim()
  if (!text) return { text: "", windowSecs, approxFromSec: 0 }

  const duration = Math.max(1, opts.durationSecs || 1)
  if (duration <= windowSecs) {
    return { text, windowSecs: duration, approxFromSec: 0 }
  }

  const ratio = windowSecs / duration
  // Prefer line boundaries so we don't start mid-sentence.
  const charStart = Math.max(0, Math.floor(text.length * (1 - ratio)))
  const fromNewline = text.lastIndexOf("\n", charStart)
  const start = fromNewline >= 0 && fromNewline > charStart - 200 ? fromNewline + 1 : charStart
  const slice = text.slice(start).trim()
  const approxFromSec = Math.max(0, Math.floor(duration - windowSecs))
  return { text: slice || text, windowSecs, approxFromSec }
}

export function formatCatchUpHeading(windowSecs: number, fromSec: number): string {
  const mins = Math.max(1, Math.round(windowSecs / 60))
  if (fromSec <= 0) return `Catch-up (full call so far, ~${mins}m)`
  const fromM = Math.floor(fromSec / 60)
  const fromS = fromSec % 60
  return `Catch-up (last ~${mins}m · from ${fromM}:${String(fromS).padStart(2, "0")})`
}

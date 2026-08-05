// Merges the two source-tagged streaming-ASR feeds (mic + system) into a single
// interleaved transcript. Each source emits a *cumulative* confirmed string and a
// volatile (in-progress) tail; this tracks per-source baselines so we append only
// new text, and — in dual ("both") mode — prefixes a speaker label whenever the
// active speaker changes.

type StreamSource = "mic" | "system"

export type ChannelLabels = { mic: string; system: string }

const DEFAULT_LABELS: ChannelLabels = { mic: "Me", system: "Them" }

interface StreamMerge {
  confirmed: Record<StreamSource, string>
  volatile: Record<StreamSource, string>
  lastSource: StreamSource | null
  labels: ChannelLabels
}

export function newStreamMerge(labels?: Partial<ChannelLabels>): StreamMerge {
  return {
    confirmed: { mic: "", system: "" },
    volatile: { mic: "", system: "" },
    lastSource: null,
    labels: {
      mic: labels?.mic?.trim() || DEFAULT_LABELS.mic,
      system: labels?.system?.trim() || DEFAULT_LABELS.system,
    },
  }
}

/** Update live channel names mid-session (e.g. after user renames Them → Priya). */
export function setChannelLabels(state: StreamMerge, labels: Partial<ChannelLabels>): void {
  if (labels.mic?.trim()) state.labels.mic = labels.mic.trim()
  if (labels.system?.trim()) state.labels.system = labels.system.trim()
}

function labelFor(state: StreamMerge, source: StreamSource): string {
  return source === "mic" ? state.labels.mic : state.labels.system
}

export function normalizeSource(s: string): StreamSource {
  return s === "system" ? "system" : "mic"
}

// Mutates `state`. Returns the text to append to the transcript for this update
// (may be ""). In labeled mode a speaker change starts a new "\nLabel: " line.
export function consumeConfirmed(
  state: StreamMerge,
  source: StreamSource,
  confirmed: string,
  labeled: boolean,
): string {
  const prev = state.confirmed[source]
  // Stale/out-of-order update (shorter than what we already consumed): ignore,
  // otherwise the whole cumulative string would be re-appended as "new" text.
  if (prev.startsWith(confirmed)) return ""
  const delta = confirmed.startsWith(prev) ? confirmed.slice(prev.length) : confirmed
  state.confirmed[source] = confirmed
  if (!delta.trim()) return ""
  if (!labeled) return delta
  const newSpeaker = state.lastSource !== source
  state.lastSource = source
  return newSpeaker ? `\n${labelFor(state, source)}: ${delta.replace(/^\s+/, "")}` : delta
}

// Mutates `state`. Returns the muted live-preview string (both tails in dual mode).
export function consumeVolatile(
  state: StreamMerge,
  source: StreamSource,
  vol: string,
  labeled: boolean,
): string {
  state.volatile[source] = vol.trim()
  if (!labeled) return state.volatile[source]
  const parts: string[] = []
  if (state.volatile.mic) parts.push(`${labelFor(state, "mic")}: ${state.volatile.mic}`)
  if (state.volatile.system) parts.push(`${labelFor(state, "system")}: ${state.volatile.system}`)
  return parts.join("   ")
}

// Append helper: drops a leading newline when the transcript is still empty.
export function appendStream(prev: string, add: string): string {
  if (!add) return prev
  return prev ? prev + add : add.replace(/^\n+/, "")
}

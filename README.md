# Meeting Notes

On-device meeting transcription and note-taking for macOS. Speech is transcribed
live — from the microphone, from system audio (the other side of a call), or
both — and written directly into the note as you talk. Nothing leaves your
computer: ASR runs locally on the Apple Neural Engine.

## Features

- **Live transcription** — captions stream into the note with ~3s latency while
  you speak, lossless (every decoded window is kept).
- **System audio capture** — transcribe meeting participants via a Core Audio
  process tap (macOS 14.4+, no screen-recording permission needed). In dual
  mode, mic and system audio are interleaved with `Me:` / `Them:` labels.
- **Editable while recording** — type in the note mid-recording; manual edits
  are preserved and the stream continues after them.
- **On-device ASR** — Parakeet v3 (25 languages) via
  [FluidAudio](https://github.com/FluidInference/FluidAudio) Core ML models.
  One model for live captions, system audio, and file transcription.
- **Opt-in AI polish** — note enhancement, titles, and speaker detection via a
  configurable API key. Never automatic: the raw transcript is the note until
  you press Enhance.

## Architecture

```
┌─────────────────────┐   transcript-stream / audio-level   ┌──────────────┐
│ React UI (Vite)     │ ◄──────────── events ─────────────── │ Tauri (Rust) │
│ useRecording hook   │ ──────────── invokes ──────────────► │ capture.rs   │
└─────────────────────┘                                      └──────┬───────┘
                                                          stdin/stdout (frames + JSON lines)
                                                                    │
                                                         ┌──────────▼──────────┐
                                                         │ fluidasr (Swift)    │
                                                         │ Parakeet v3 + tap   │
                                                         └─────────────────────┘
```

- `src/` — React frontend. `src/lib/use-recording.ts` owns the recording
  pipeline; `note-editor.tsx` / `meeting-recorder.tsx` own their state machines.
- `src-tauri/` — Rust shell. `capture.rs` spawns the streaming sidecar and
  relays its JSON updates as Tauri events (no audio crosses the boundary);
  `fluid.rs` spawns/manages the sidecar.
- `fluid-sidecar/` — Swift package producing the `fluidasr` binary. Captures all
  audio in-process — mic via AVAudioEngine (Apple voice-processing AEC) and
  system output via a Core Audio process tap — and runs streaming ASR (sliding
  window, 3s chunks) plus batch WAV transcription. v3 uses the int4 encoder.

## Development

Requirements: macOS 14.4+, Xcode command line tools, Rust, Node 22+, yarn.

```bash
yarn install
yarn tauri:dev
```

### Rebuilding the sidecar

`yarn sidecar` builds the Swift sidecar and deploys it to both paths the app runs
from (`src-tauri/binaries/fluidasr-<triple>` for the bundled app, and
`src-tauri/target/debug/fluidasr` for `tauri dev`):

```bash
yarn sidecar
```

This runs automatically before `tauri dev` and `tauri build` (wired into
`beforeDevCommand` / `beforeBuildCommand`), so a change in `fluid-sidecar/` can't
leave a stale binary behind. `swift build` is incremental (~1s when unchanged).
The sidecar is spawned fresh on every recording start, so during `tauri dev` a
stop/start picks up a rebuild without an app restart.

ASR models download from HuggingFace on first run and are cached locally.

## Build

```bash
yarn tauri:build
```

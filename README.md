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
- `src-tauri/` — Rust shell. `capture.rs` runs cpal mic capture and relays the
  sidecar's JSON updates as Tauri events; `fluid.rs` spawns/manages the sidecar.
- `fluid-sidecar/` — Swift package producing the `fluidasr` binary: streaming
  ASR (sliding window, 3s chunks), system-audio process tap, batch WAV
  transcription.

## Development

Requirements: macOS 14.4+, Xcode command line tools, Rust, Node 22+, yarn.

```bash
yarn install
yarn tauri:dev
```

### Rebuilding the sidecar

After changing `fluid-sidecar/` sources:

```bash
cd fluid-sidecar
swift build -c release
cp .build/arm64-apple-macosx/release/fluidasr ../src-tauri/binaries/fluidasr-aarch64-apple-darwin
```

Tauri bundles the target-triple-named binary (`externalBin`) and copies it next
to the app executable at build time. During an active `tauri dev` session you
can also copy it straight to `src-tauri/target/debug/fluidasr` — the sidecar is
spawned fresh on every recording start, so a stop/start picks it up without an
app restart.

ASR models download from HuggingFace on first run and are cached locally.

## Build

```bash
yarn tauri:build
```

// Continuous on-device transcription.
//
// All audio capture now lives in the Swift sidecar: the mic via AVAudioEngine
// (with Apple voice-processing AEC) and system output via a Core Audio process
// tap. This Rust layer just spawns the streaming sidecar, relays its
// confirmed/volatile transcript and audio-level JSON as Tauri events, and
// signals "stop" by closing the sidecar's stdin (EOF).
//
// Previously the mic was captured here with cpal and shipped to the sidecar as
// raw f32 frames over stdin; moving it into the sidecar removed that IPC, the
// dual-process level metering, and the cpal dependency, and let a single
// AVAudioEngine graph apply echo cancellation across mic + system.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Duration;

use log;
use serde::Serialize;
use tauri::{AppHandle, Emitter};

use crate::fluid;

// Payload for `capture-error` events.
#[derive(Clone, Serialize)]
struct CaptureError {
    text: String,
}

#[derive(Clone, Serialize)]
struct AudioLevel {
    rms: f32,
    source: String,
}

// Streaming live-caption state pushed to the frontend: `confirmed` is committed
// text (append to the note), `volatile` is the in-progress tail (shown muted,
// replaced on each update).
#[derive(Clone, Serialize)]
struct TranscriptStream {
    source: String,
    confirmed: String,
    volatile: String,
}

#[derive(serde::Deserialize)]
struct StreamUpdate {
    source: String,
    confirmed: String,
    volatile: String,
}

#[derive(serde::Deserialize)]
struct SourceLevel {
    #[serde(default)]
    source: String,
    rms: f32,
}

struct Capture {
    stop: Arc<AtomicBool>,
}

impl Drop for Capture {
    fn drop(&mut self) {
        // The stream processor task observes this flag, closes the sidecar's
        // stdin, and flushes the final transcript.
        self.stop.store(true, Ordering::Release);
    }
}

fn slot() -> &'static Mutex<Option<Capture>> {
    static S: OnceLock<Mutex<Option<Capture>>> = OnceLock::new();
    S.get_or_init(|| Mutex::new(None))
}

#[tauri::command]
pub async fn start_continuous(
    app: AppHandle,
    language: Option<String>,
    source: Option<String>,
    model: Option<String>,
) -> Result<(), String> {
    log::debug!("start_continuous called");
    let mut guard = slot().lock().map_err(|_| "lock poisoned".to_string())?;
    if guard.is_some() {
        log::debug!("start_continuous: already running, skipping");
        return Ok(());
    }

    // mic | system | both. Both mic (AVAudioEngine) and system output (Core Audio
    // process tap) are captured inside the streaming sidecar.
    let source = source.unwrap_or_else(|| "mic".to_string());
    let stop = Arc::new(AtomicBool::new(false));

    {
        let stop = stop.clone();
        let app = app.clone();
        let lang = language.unwrap_or_default();
        let model = model.unwrap_or_else(|| "parakeet-v3".to_string());
        log::debug!(
            "spawning stream processor (parakeet v3, source={}, lang={})",
            source,
            if lang.is_empty() { "auto" } else { &lang }
        );
        tauri::async_runtime::spawn(async move {
            run_stream_processor(app, stop, lang, source, model).await;
        });
    }

    *guard = Some(Capture { stop });
    log::debug!("start_continuous complete");
    Ok(())
}

#[tauri::command]
pub async fn stop_continuous() -> Result<(), String> {
    let mut guard = slot().lock().map_err(|_| "lock poisoned".to_string())?;
    *guard = None; // Drop sets the stop flag; the stream processor flushes and exits
    Ok(())
}

pub fn stop_continuous_sync() {
    if let Ok(mut guard) = slot().lock() {
        *guard = None;
    }
}

// Streaming live-caption path (Parakeet). Spawns the long-lived streaming sidecar
// (which captures all audio itself), relays its confirmed/volatile updates and
// per-source levels, and closes stdin to stop. No audio crosses the process
// boundary anymore — the sidecar's sliding window and Silero VAD handle
// segmentation.
async fn run_stream_processor(
    app: AppHandle,
    stop: Arc<AtomicBool>,
    language: String,
    source: String,
    model: String,
) {
    // The sidecar captures audio at its own rate now; the config frame's rate field
    // is vestigial, so pass a placeholder.
    let (sidecar, mut stdout) =
        match fluid::spawn_stream_sidecar(&app, 16000, &language, &source, Some(&model)).await {
            Ok(s) => s,
            Err(e) => {
                log::error!("stream sidecar failed: {e}");
                let _ = app.emit("capture-error", CaptureError { text: e });
                return;
            }
        };

    // Relay JSON updates from the sidecar as `transcript-stream` / `audio-level`.
    let reader_app = app.clone();
    let reader = tokio::task::spawn(async move {
        use tokio::io::AsyncBufReadExt;
        let mut line = String::new();
        loop {
            line.clear();
            match stdout.read_line(&mut line).await {
                Ok(0) => break, // EOF
                Ok(_) => {
                    let t = line.trim();
                    if t.is_empty() {
                        continue;
                    }
                    if t == "DONE" {
                        break;
                    }
                    if let Some(msg) = t
                        .strip_prefix("FATAL\t")
                        .or_else(|| t.strip_prefix("ERR\t"))
                    {
                        log::error!("stream sidecar error: {msg}");
                        let _ = reader_app.emit(
                            "capture-error",
                            CaptureError {
                                text: msg.to_string(),
                            },
                        );
                        continue;
                    }
                    if t.starts_with('{') {
                        match serde_json::from_str::<SourceLevel>(t) {
                            Ok(l) => {
                                let _ = reader_app.emit(
                                    "audio-level",
                                    AudioLevel {
                                        rms: l.rms,
                                        source: l.source,
                                    },
                                );
                            }
                            Err(_) => match serde_json::from_str::<StreamUpdate>(t) {
                                Ok(u) => {
                                    let _ = reader_app.emit(
                                        "transcript-stream",
                                        TranscriptStream {
                                            source: u.source,
                                            confirmed: u.confirmed,
                                            volatile: u.volatile,
                                        },
                                    );
                                }
                                Err(e) => log::debug!("stream update parse error: {e} (line={t})"),
                            },
                        }
                    }
                }
                Err(e) => {
                    log::error!("stream read error: {e}");
                    break;
                }
            }
        }
    });

    // Park until asked to stop. The sidecar is capturing and transcribing on its
    // own; we only need to notice the stop flag and tear it down.
    while !stop.load(Ordering::Acquire) {
        tokio::time::sleep(Duration::from_millis(100)).await;
    }

    // Closing stdin (inside finish) is the EOF the sidecar waits on to flush finals.
    sidecar.finish().await;
    let reader_abort = reader.abort_handle();
    match tokio::time::timeout(Duration::from_secs(6), reader).await {
        Ok(_) => {}
        Err(_) => {
            log::warn!("[capture] reader task timeout, aborting");
            reader_abort.abort();
        }
    }
}

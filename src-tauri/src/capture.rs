// Continuous on-device transcription.
//
// All audio capture now lives in the Swift sidecar: the mic via AVAudioEngine
// (with Apple voice-processing AEC) and system output via a Core Audio process
// tap. This Rust layer just acquires the streaming sidecar (reusing a
// pre-warmed one when available so recording starts without the model load),
// relays its confirmed/volatile transcript and audio-level JSON as Tauri
// events, and signals "stop" by closing the sidecar's stdin (EOF).
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

// Streaming live-caption path. Reuses the pre-warmed streaming sidecar when one
// is parked (model already loaded — recording starts instantly), otherwise
// spawns fresh. Relays confirmed/volatile updates and per-source levels, and
// closes stdin to stop. No audio crosses the process boundary — the sidecar
// captures, VAD-gates, and transcribes on its own.
async fn run_stream_processor(
    app: AppHandle,
    stop: Arc<AtomicBool>,
    language: String,
    source: String,
    model: String,
) {
    let mut sidecar = match fluid::acquire_stream_sidecar(&app, Some(&model), &source).await {
        Ok(s) => s,
        Err(e) => {
            log::error!("stream sidecar failed: {e}");
            let _ = app.emit("capture-error", CaptureError { text: e });
            return;
        }
    };

    // The sidecar captures audio at its own rate; the config frame's rate field
    // is vestigial, so pass a placeholder. `begin` is what unparks a pre-warmed
    // sidecar — models are typically already loaded at this point.
    if let Err(e) = sidecar.begin(16000, &language).await {
        log::error!("stream sidecar config failed: {e}");
        let _ = app.emit("capture-error", CaptureError { text: e });
        return;
    }
    if let Err(e) = sidecar.wait_ready(&app).await {
        log::error!("stream sidecar failed: {e}");
        let _ = app.emit("capture-error", CaptureError { text: e });
        return;
    }

    // Single relay loop: forward transcript/level JSON to the frontend while
    // watching the stop flag (checked between lines every 100ms, matching the
    // old poll cadence). On stop, close stdin — the EOF the sidecar waits on to
    // flush its final transcripts — then keep reading until DONE/EOF with an
    // overall 6s deadline so a stuck sidecar can't hang teardown.
    let mut eof_at: Option<tokio::time::Instant> = None;
    loop {
        if eof_at.is_none() && stop.load(Ordering::Acquire) {
            sidecar.close_stdin();
            eof_at = Some(tokio::time::Instant::now());
        }
        if let Some(t) = eof_at {
            if t.elapsed() > Duration::from_secs(6) {
                log::warn!("[capture] stream sidecar final flush timed out");
                break;
            }
        }
        let line = match tokio::time::timeout(Duration::from_millis(100), sidecar.next_line()).await
        {
            Ok(Some(line)) => line,
            Ok(None) => break, // EOF
            Err(_) => continue, // tick: re-check stop flag / teardown deadline
        };
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
            let _ = app.emit(
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
                    let _ = app.emit(
                        "audio-level",
                        AudioLevel {
                            rms: l.rms,
                            source: l.source,
                        },
                    );
                }
                Err(_) => match serde_json::from_str::<StreamUpdate>(t) {
                    Ok(u) => {
                        let _ = app.emit(
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
}

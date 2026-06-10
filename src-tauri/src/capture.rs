// Continuous on-device transcription, fully in Rust.
//
// cpal captures the default input device on a dedicated thread (the CoreAudio
// `Stream` is !Send, so it must live on the thread that built it). The audio
// callback downmixes to mono f32 and pushes into a shared buffer, which the
// stream processor forwards to the long-lived Parakeet streaming sidecar.
// Confirmed/volatile caption updates come back as `transcript-stream` events,
// and `audio-level` drives the level meter.
//
// Note: on macOS cpal can only capture *input* devices (the mic). System
// output audio is captured inside the sidecar via a Core Audio process tap.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::thread::JoinHandle;
use std::time::Duration;

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use serde::Serialize;
use tauri::{AppHandle, Emitter};
use log;

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
    thread: Option<JoinHandle<()>>,
}

impl Drop for Capture {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Relaxed);
        if let Some(t) = self.thread.take() {
            let _ = t.join();
        }
    }
}

fn slot() -> &'static Mutex<Option<Capture>> {
    static S: OnceLock<Mutex<Option<Capture>>> = OnceLock::new();
    S.get_or_init(|| Mutex::new(None))
}

#[tauri::command]
pub async fn start_continuous(app: AppHandle, language: Option<String>, source: Option<String>) -> Result<(), String> {
    log::debug!("start_continuous called");
    let mut guard = slot().lock().map_err(|_| "lock poisoned".to_string())?;
    if guard.is_some() {
        log::debug!("start_continuous: already running, skipping");
        return Ok(());
    }

    // mic | system | both. System output audio is captured inside the streaming
    // sidecar (ScreenCaptureKit); the mic is captured here via cpal.
    let source = source.unwrap_or_else(|| "mic".to_string());
    let mic_active = source != "system";

    let stop = Arc::new(AtomicBool::new(false));
    let shared = Arc::new(Mutex::new(Vec::<f32>::new()));
    let src_rate = Arc::new(Mutex::new(0u32));

    // Only open the mic (and prompt for mic permission) when it's actually needed.
    let thread = if mic_active {
        let app2 = app.clone();
        let stop = stop.clone();
        let shared = shared.clone();
        let src_rate = src_rate.clone();
        Some(std::thread::spawn(move || {
            if let Err(e) = run_capture(app2, stop, shared, src_rate) {
                log::error!("[capture] error: {e}");
            }
        }))
    } else {
        None
    };

    {
        let stop = stop.clone();
        let shared = shared.clone();
        let src_rate = src_rate.clone();
        let app = app.clone();
        let lang = language.unwrap_or_default();
        log::debug!("spawning stream processor (parakeet v3, source={}, lang={})", source, if lang.is_empty() { "auto" } else { &lang });
        tauri::async_runtime::spawn(async move {
            run_stream_processor(app, stop, shared, src_rate, lang, source, mic_active).await;
        });
    }

    *guard = Some(Capture { stop, thread });
    log::debug!("start_continuous complete");
    Ok(())
}

#[tauri::command]
pub async fn stop_continuous() -> Result<(), String> {
    let mut guard = slot().lock().map_err(|_| "lock poisoned".to_string())?;
    *guard = None; // Drop sets the stop flag and joins the capture thread
    Ok(())
}

// Owns the cpal stream for its whole lifetime and parks until asked to stop.
// Reports stream setup success/failure back to the caller via `ready_tx`.
fn run_capture(
    app: AppHandle,
    stop: Arc<AtomicBool>,
    shared: Arc<Mutex<Vec<f32>>>,
    src_rate: Arc<Mutex<u32>>,
) -> Result<(), String> {
    let build = || -> Result<cpal::Stream, String> {
        let host = cpal::default_host();
        let device = host
            .default_input_device()
            .ok_or("no default input device")?;
        let name = device.name().unwrap_or_else(|_| "<unknown>".into());
        let config = device
            .default_input_config()
            .map_err(|e| format!("default input config: {e}"))?;

        let sample_rate = config.sample_rate().0;
        let channels = config.channels() as usize;
        let sample_format = config.sample_format();
        *src_rate.lock().map_err(|_| "rate lock")? = sample_rate;
        log::info!(
            "[capture] device='{name}' rate={sample_rate} ch={channels} fmt={sample_format:?}"
        );

        let err_fn = |e| log::error!("[capture] input stream error: {e}");
        let stream_config: cpal::StreamConfig = config.into();

        let stream = match sample_format {
            cpal::SampleFormat::F32 => {
                let shared = shared.clone();
                device.build_input_stream(
                    &stream_config,
                    move |data: &[f32], _: &_| push_mono(data, channels, &shared, |s| s),
                    err_fn,
                    None,
                )
            }
            cpal::SampleFormat::I16 => {
                let shared = shared.clone();
                device.build_input_stream(
                    &stream_config,
                    move |data: &[i16], _: &_| {
                        push_mono(data, channels, &shared, |s| s as f32 / 32768.0)
                    },
                    err_fn,
                    None,
                )
            }
            cpal::SampleFormat::U16 => {
                let shared = shared.clone();
                device.build_input_stream(
                    &stream_config,
                    move |data: &[u16], _: &_| {
                        push_mono(data, channels, &shared, |s| (s as f32 - 32768.0) / 32768.0)
                    },
                    err_fn,
                    None,
                )
            }
            other => return Err(format!("unsupported sample format: {other:?}")),
        }
        .map_err(|e| format!("build input stream: {e}"))?;

        stream.play().map_err(|e| format!("stream play: {e}"))?;
        Ok(stream)
    };

    match build() {
        Err(e) => {
            let _ = app.emit("capture-error", CaptureError { text: e.clone() });
            Err(e)
        }
        Ok(stream) => {
            log::debug!("capture thread: streaming started");
            while !stop.load(Ordering::Relaxed) {
                std::thread::sleep(Duration::from_millis(100));
            }
            drop(stream);
            log::debug!("capture thread: streaming stopped");
            log::info!("[capture] streaming stopped");
            Ok(())
        }
    }
}

// Downmix interleaved frames to mono and append to the shared buffer.
fn push_mono<T: Copy>(
    data: &[T],
    channels: usize,
    shared: &Mutex<Vec<f32>>,
    to_f32: impl Fn(T) -> f32,
) {
    if channels == 0 {
        return;
    }
    let mut buf = match shared.lock() {
        Ok(b) => b,
        Err(_) => return,
    };
    for frame in data.chunks(channels) {
        let mut sum = 0.0f32;
        for &s in frame {
            sum += to_f32(s);
        }
        buf.push(sum / channels as f32);
    }
}


// Streaming live-caption path (Parakeet). The cpal capture thread keeps filling
// `shared` with native-rate mono f32; here we forward it continuously to a
// long-lived streaming sidecar and relay its confirmed/volatile updates, instead
// of cutting WAV segments. No RMS segmentation — the sidecar's sliding window and
// Silero handle that.
async fn run_stream_processor(
    app: AppHandle,
    stop: Arc<AtomicBool>,
    shared: Arc<Mutex<Vec<f32>>>,
    src_rate: Arc<Mutex<u32>>,
    language: String,
    source: String,
    mic_active: bool,
) {
    // The config frame carries the mic sample rate; only relevant when capturing mic.
    // For system-only there's no cpal thread, so use a placeholder rate.
    let rate = if mic_active {
        loop {
            if stop.load(Ordering::Relaxed) {
                return;
            }
            let r = src_rate.lock().map(|r| *r).unwrap_or(0);
            if r != 0 {
                break r;
            }
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
    } else {
        16000
    };

    let (mut sidecar, mut stdout) = match fluid::spawn_stream_sidecar(&app, rate, &language, &source).await {
        Ok(s) => s,
        Err(e) => {
            log::error!("stream sidecar failed: {e}");
            let _ = app.emit("capture-error", CaptureError { text: e });
            return;
        }
    };

    // Relay JSON updates from the sidecar as `transcript-stream` events.
    let reader_app = app.clone();
    let reader = tauri::async_runtime::spawn(async move {
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
                    if let Some(msg) = t.strip_prefix("FATAL\t").or_else(|| t.strip_prefix("ERR\t")) {
                        log::error!("stream sidecar error: {msg}");
                        let _ = reader_app.emit("capture-error", CaptureError { text: msg.to_string() });
                        continue;
                    }
                    if t.starts_with('{') {
                        match serde_json::from_str::<SourceLevel>(t) {
                            Ok(l) => {
                                let _ = reader_app.emit("audio-level", AudioLevel { rms: l.rms, source: l.source });
                            }
                            Err(_) => match serde_json::from_str::<StreamUpdate>(t) {
                                Ok(u) => {
                                    let _ = reader_app.emit(
                                        "transcript-stream",
                                        TranscriptStream { source: u.source, confirmed: u.confirmed, volatile: u.volatile },
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

    // Pump captured audio to the sidecar ~10x/sec.
    loop {
        let stopping = stop.load(Ordering::Relaxed);
        let chunk: Vec<f32> = match shared.lock() {
            Ok(mut b) => std::mem::take(&mut *b),
            Err(_) => Vec::new(),
        };
        if !chunk.is_empty() {
            let _ = app.emit("audio-level", AudioLevel { rms: rms(&chunk), source: "mic".into() });
            if let Err(e) = sidecar.feed(&chunk).await {
                log::error!("stream feed failed: {e}");
                break;
            }
        }
        if stopping {
            break;
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }

    // Close stdin so the sidecar flushes its final transcript, then drain the reader.
    sidecar.finish().await;
    let _ = tokio::time::timeout(Duration::from_secs(6), reader).await;
}

fn rms(samples: &[f32]) -> f32 {
    if samples.is_empty() {
        return 0.0;
    }
    let sum: f32 = samples.iter().map(|s| s * s).sum();
    (sum / samples.len() as f32).sqrt()
}

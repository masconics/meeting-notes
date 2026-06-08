// Continuous on-device transcription, fully in Rust.
//
// cpal captures the default input device on a dedicated thread (the CoreAudio
// `Stream` is !Send, so it must live on the thread that built it). The audio
// callback downmixes to mono f32 and pushes into a shared buffer. A separate
// async processor drains that buffer, runs a coarse RMS voice-activity check,
// and flushes each speech segment (on a pause, or after a max length) to the
// Parakeet sidecar via `fluid::transcribe_audio_fluid`. Each finished segment
// is emitted to the frontend as a `transcript-segment` event; the processor
// also emits `audio-level` for the level meter.
//
// Note: on macOS cpal can only capture *input* devices (the mic). Capturing
// system output audio needs ScreenCaptureKit and is out of scope here.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::thread::JoinHandle;
use std::time::Duration;

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use serde::Serialize;
use tauri::{AppHandle, Emitter};
use log;

const TARGET_SR: u32 = 16000;
// VAD / segmentation tuning.
const RMS_SPEECH_THRESHOLD: f32 = 0.012; // above this, a chunk counts as speech
const SILENCE_FLUSH_SECS: f32 = 0.6; // trailing silence that ends a segment
const MAX_SEGMENT_SECS: f32 = 8.0; // force a flush so output stays live during long speech
const MIN_SEGMENT_SECS: f32 = 0.4; // ignore blips shorter than this
const LEADING_SILENCE_CAP_SECS: f32 = 2.0; // drop buffered silence before speech

#[derive(Clone, Serialize)]
struct TranscriptSegment {
    text: String,
}

#[derive(Clone, Serialize)]
struct AudioLevel {
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
pub async fn start_continuous(app: AppHandle, language: Option<String>, model: Option<String>) -> Result<(), String> {
    log::debug!("start_continuous called");
    let mut guard = slot().lock().map_err(|_| "lock poisoned".to_string())?;
    if guard.is_some() {
        log::debug!("start_continuous: already running, skipping");
        return Ok(());
    }

    let stop = Arc::new(AtomicBool::new(false));
    let shared = Arc::new(Mutex::new(Vec::<f32>::new()));
    let src_rate = Arc::new(Mutex::new(0u32));

    let app2 = app.clone();
    let thread = {
        let stop = stop.clone();
        let shared = shared.clone();
        let src_rate = src_rate.clone();
        std::thread::spawn(move || {
            if let Err(e) = run_capture(app2, stop, shared, src_rate) {
                log::error!("[capture] error: {e}");
            }
        })
    };

    {
        let stop = stop.clone();
        let shared = shared.clone();
        let src_rate = src_rate.clone();
        let app = app.clone();
        let lang = language.unwrap_or_default();
        let mdl = model.unwrap_or_default();
        log::debug!("spawning run_processor task (lang={}, model={})", if lang.is_empty() { "auto" } else { &lang }, if mdl.is_empty() { "default" } else { &mdl });
        let sensevoice = mdl == "sensevoice";
        let app2 = app.clone();
        tauri::async_runtime::spawn(async move {
            fluid::prewarm_fluid(&app2, sensevoice).await;
        });
        tauri::async_runtime::spawn(async move {
            run_processor(app, stop, shared, src_rate, lang, mdl).await;
        });
    }

    *guard = Some(Capture {
        stop,
        thread: Some(thread),
    });
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
            let _ = app.emit("capture-error", TranscriptSegment { text: e.clone() });
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

async fn run_processor(
    app: AppHandle,
    stop: Arc<AtomicBool>,
    shared: Arc<Mutex<Vec<f32>>>,
    src_rate: Arc<Mutex<u32>>,
    language: String,
    model: String,
) {
    log::debug!("run_processor started");
    let (tx, mut rx) = tokio::sync::mpsc::channel::<(Vec<u8>, String, String)>(4);

    let consumer_app = app.clone();
    let consumer = tauri::async_runtime::spawn(async move {
        let mut seg_idx: usize = 0;
        while let Some((wav, lang, mdl)) = rx.recv().await {
            seg_idx += 1;
            log::debug!("consumer got segment #{}, {} bytes, lang={}, model={}", seg_idx, wav.len(), if lang.is_empty() { "auto" } else { &lang }, if mdl.is_empty() { "default" } else { &mdl });
            let mdl_opt = if mdl.is_empty() { None } else { Some(mdl.clone()) };
            match fluid::transcribe_audio_fluid(consumer_app.clone(), wav, Some(lang), mdl_opt).await {
                Ok(t) => {
                    let t = t.trim().to_string();
                    log::debug!("transcript #{}: {:?} ({} chars)", seg_idx, t, t.len());
                    if !t.is_empty() {
                        match consumer_app.emit("transcript-segment", TranscriptSegment { text: t.clone() }) {
                            Ok(()) => log::debug!("emitted transcript-segment #{}", seg_idx),
                            Err(e) => log::error!("FAILED to emit transcript-segment #{}: {e}", seg_idx),
                        }
                    } else {
                        log::debug!("segment #{} transcript was empty, skipping emit", seg_idx);
                    }
                }
                Err(e) => {
                    log::error!("transcribe error #{seg_idx}: {e}");
                    let _ = consumer_app.emit("capture-error", TranscriptSegment { text: e });
                }
            }
        }
        log::debug!("consumer exiting (channel closed), processed {seg_idx} segments");
    });

    let mut seg: Vec<f32> = Vec::new();
    let mut silence_samples: usize = 0;
    let mut had_speech = false;
    let mut flush_count: usize = 0;
    let mut loop_iter: usize = 0;

    loop {
        loop_iter += 1;
        let stopping = stop.load(Ordering::Relaxed);
        let rate = src_rate.lock().map(|r| *r).unwrap_or(0);

        let chunk: Vec<f32> = {
            match shared.lock() {
                Ok(mut b) => std::mem::take(&mut *b),
                Err(_) => Vec::new(),
            }
        };

        if rate == 0 {
            if loop_iter % 20 == 1 {
                log::debug!("loop #{loop_iter}: rate=0, waiting for capture");
            }
            if stopping {
                break;
            }
            tokio::time::sleep(Duration::from_millis(50)).await;
            continue;
        }

        if loop_iter % 50 == 1 {
            let silence_secs = silence_samples as f32 / rate as f32;
            let seg_secs = seg.len() as f32 / rate as f32;
            log::debug!(
                "loop #{loop_iter}: chunk={} samples, seg={:.1}s, silence={:.1}s, had_speech={}, rate={}",
                chunk.len(), seg_secs, silence_secs, had_speech, rate
            );
        }

        if !chunk.is_empty() {
            let window_samples = ((rate as f32) * 0.1) as usize;
            let win = window_samples.max(1);

            for window in chunk.chunks(win) {
                let r = rms(window);
                let _ = app.emit("audio-level", AudioLevel { rms: r });

                if r > RMS_SPEECH_THRESHOLD {
                    had_speech = true;
                    silence_samples = 0;
                } else {
                    silence_samples += window.len();
                }
                seg.extend_from_slice(window);
            }
        }

        let silence_secs = silence_samples as f32 / rate as f32;
        let seg_secs = seg.len() as f32 / rate as f32;

        let should_flush = had_speech
            && seg_secs >= MIN_SEGMENT_SECS
            && (silence_secs >= SILENCE_FLUSH_SECS || seg_secs >= MAX_SEGMENT_SECS);

        if had_speech && loop_iter % 10 == 0 {
            log::debug!(
                "vad check #{loop_iter}: seg={:.1}s, silence={:.1}s, should_flush={}",
                seg_secs, silence_secs, should_flush
            );
        }

        if should_flush || (stopping && had_speech && seg_secs >= MIN_SEGMENT_SECS) {
            let wav = to_wav_16k(&seg, rate);
            log::debug!(
                "flush segment #{}: {:.1}s ({} bytes wav){}",
                flush_count + 1,
                seg_secs,
                wav.len(),
                if stopping { " [final]" } else { "" }
            );
            seg.clear();
            silence_samples = 0;
            had_speech = false;
            flush_count += 1;

            match tx.send((wav, language.clone(), model.clone())).await {
                Ok(()) => log::debug!("sent segment #{flush_count} to consumer channel"),
                Err(e) => log::error!("FAILED to send segment #{flush_count} to channel: {e}"),
            }
        } else if !had_speech && seg_secs > LEADING_SILENCE_CAP_SECS {
            seg.clear();
            silence_samples = 0;
        }

        if stopping {
            break;
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }

    drop(tx);
    tokio::time::timeout(Duration::from_secs(2), consumer).await.ok();
}

use crate::fluid;

fn rms(samples: &[f32]) -> f32 {
    if samples.is_empty() {
        return 0.0;
    }
    let sum: f32 = samples.iter().map(|s| s * s).sum();
    (sum / samples.len() as f32).sqrt()
}

// Linear-resample mono f32 to 16k and serialize as 16-bit PCM mono WAV bytes.
fn to_wav_16k(input: &[f32], src_rate: u32) -> Vec<u8> {
    let resampled = resample(input, src_rate, TARGET_SR);
    let data_size = resampled.len() * 2;
    let byte_rate = TARGET_SR * 2; // mono, 16-bit
    let mut out = Vec::with_capacity(44 + data_size);

    out.extend_from_slice(b"RIFF");
    out.extend_from_slice(&((36 + data_size) as u32).to_le_bytes());
    out.extend_from_slice(b"WAVE");
    out.extend_from_slice(b"fmt ");
    out.extend_from_slice(&16u32.to_le_bytes());
    out.extend_from_slice(&1u16.to_le_bytes()); // PCM
    out.extend_from_slice(&1u16.to_le_bytes()); // mono
    out.extend_from_slice(&TARGET_SR.to_le_bytes());
    out.extend_from_slice(&byte_rate.to_le_bytes());
    out.extend_from_slice(&2u16.to_le_bytes()); // block align
    out.extend_from_slice(&16u16.to_le_bytes()); // bits per sample
    out.extend_from_slice(b"data");
    out.extend_from_slice(&(data_size as u32).to_le_bytes());

    for s in resampled {
        let clamped = s.clamp(-1.0, 1.0);
        let v = if clamped < 0.0 {
            (clamped * 32768.0) as i16
        } else {
            (clamped * 32767.0) as i16
        };
        out.extend_from_slice(&v.to_le_bytes());
    }
    out
}

fn resample(input: &[f32], src: u32, dst: u32) -> Vec<f32> {
    if src == dst || input.is_empty() {
        return input.to_vec();
    }
    let ratio = dst as f64 / src as f64;
    let out_len = ((input.len() as f64) * ratio).round() as usize;
    let mut out = Vec::with_capacity(out_len);
    let last = input.len() - 1;
    for i in 0..out_len {
        let pos = i as f64 / ratio;
        let idx = pos.floor() as usize;
        let frac = (pos - idx as f64) as f32;
        let a = input[idx.min(last)];
        let b = input[(idx + 1).min(last)];
        out.push(a + (b - a) * frac);
    }
    out
}

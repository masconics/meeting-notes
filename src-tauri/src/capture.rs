use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::thread::JoinHandle;
use std::time::Duration;

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use serde::Serialize;
use tauri::{AppHandle, Emitter};
use log;

const TARGET_SR: u32 = 16000;
const RMS_SPEECH_THRESHOLD: f32 = 0.012;
const SILENCE_FLUSH_SECS: f32 = 0.6;
const MAX_SEGMENT_SECS: f32 = 8.0;
const MIN_SEGMENT_SECS: f32 = 0.4;
const LEADING_SILENCE_CAP_SECS: f32 = 2.0;
const PARAGRAPH_SILENCE_SECS: f32 = 2.5;

#[derive(Clone, Serialize)]
struct TranscriptSegment {
    text: String,
    #[serde(rename = "hasBreak")]
    has_break: bool,
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
pub async fn start_continuous(app: AppHandle, language: Option<String>, model: Option<String>, device_id: Option<String>) -> Result<(), String> {
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
    let device_id_val = device_id.unwrap_or_default();
    let thread = {
        let stop = stop.clone();
        let shared = shared.clone();
        let src_rate = src_rate.clone();
        std::thread::spawn(move || {
            if let Err(e) = run_capture(app2, stop, shared, src_rate, &device_id_val) {
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
    *guard = None;
    Ok(())
}

fn test_slot() -> &'static Mutex<Option<Capture>> {
    static S: OnceLock<Mutex<Option<Capture>>> = OnceLock::new();
    S.get_or_init(|| Mutex::new(None))
}

#[tauri::command]
pub async fn start_mic_test(app: AppHandle, device_id: Option<String>) -> Result<(), String> {
    let mut guard = test_slot().lock().map_err(|_| "lock poisoned")?;
    if guard.is_some() {
        return Ok(());
    }

    let stop = Arc::new(AtomicBool::new(false));
    let device_id_val = device_id.unwrap_or_default();

    let app2 = app.clone();
    let thread = {
        let stop = stop.clone();
        std::thread::spawn(move || {
            if let Err(e) = run_mic_test(app2, stop, &device_id_val) {
                log::error!("[mic-test] error: {e}");
            }
        })
    };

    *guard = Some(Capture { stop, thread: Some(thread) });
    Ok(())
}

#[tauri::command]
pub async fn stop_mic_test() -> Result<(), String> {
    let mut guard = test_slot().lock().map_err(|_| "lock poisoned")?;
    *guard = None;
    Ok(())
}

fn run_mic_test(app: AppHandle, stop: Arc<AtomicBool>, device_id: &str) -> Result<(), String> {
    let host = cpal::default_host();
    let device = if !device_id.is_empty() {
        host.devices()
            .map_err(|e| format!("enumerate: {e}"))?
            .find(|d| d.name().map(|n| n == device_id).unwrap_or(false))
            .ok_or_else(|| format!("device not found: {device_id}"))?
    } else {
        host.default_input_device().ok_or("no default input device")?
    };

    let config = device.default_input_config().map_err(|e| format!("config: {e}"))?;
    let name = device.name().unwrap_or_else(|_| "<unknown>".into());
    let channels = config.channels() as usize;
    let sample_format = config.sample_format();
    log::info!("[mic-test] device='{name}' ch={channels}");

    let err_fn = |e| log::error!("[mic-test] stream error: {e}");
    let stream_config: cpal::StreamConfig = config.into();

    let stream = match sample_format {
        cpal::SampleFormat::F32 => device.build_input_stream(
            &stream_config,
            move |data: &[f32], _: &_| {
                let r = rms_mono(data, channels);
                let _ = app.emit("audio-level", AudioLevel { rms: r });
            },
            err_fn,
            None,
        ),
        cpal::SampleFormat::I16 => device.build_input_stream(
            &stream_config,
            move |data: &[i16], _: &_| {
                let r = rms_mono_i16(data, channels);
                let _ = app.emit("audio-level", AudioLevel { rms: r });
            },
            err_fn,
            None,
        ),
        cpal::SampleFormat::U16 => device.build_input_stream(
            &stream_config,
            move |data: &[u16], _: &_| {
                let r = rms_mono_u16(data, channels);
                let _ = app.emit("audio-level", AudioLevel { rms: r });
            },
            err_fn,
            None,
        ),
        other => return Err(format!("unsupported format: {other:?}")),
    }
    .map_err(|e| format!("build stream: {e}"))?;

    stream.play().map_err(|e| format!("play: {e}"))?;
    log::debug!("[mic-test] streaming started");

    while !stop.load(Ordering::Relaxed) {
        std::thread::sleep(Duration::from_millis(100));
    }
    drop(stream);
    log::debug!("[mic-test] streaming stopped");
    Ok(())
}

fn run_capture(
    app: AppHandle,
    stop: Arc<AtomicBool>,
    shared: Arc<Mutex<Vec<f32>>>,
    src_rate: Arc<Mutex<u32>>,
    device_id: &str,
) -> Result<(), String> {
    let build = || -> Result<cpal::Stream, String> {
        let host = cpal::default_host();
        let device = if !device_id.is_empty() {
            host.devices()
                .map_err(|e| format!("enumerate devices: {e}"))?
                .find(|d| d.name().map(|n| n == device_id).unwrap_or(false))
                .ok_or_else(|| format!("device not found: {device_id}"))?
        } else {
            host.default_input_device()
                .ok_or("no default input device")?
        };
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
            let _ = app.emit("capture-error", TranscriptSegment { text: e.clone(), has_break: false });
            Err(e)
        }
        Ok(stream) => {
            log::debug!("capture thread: streaming started");
            while !stop.load(Ordering::Relaxed) {
                std::thread::sleep(Duration::from_millis(100));
            }
            drop(stream);
            log::debug!("capture thread: streaming stopped");
            Ok(())
        }
    }
}

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
    let (tx, mut rx) = tokio::sync::mpsc::channel::<(Vec<f32>, String, String, bool)>(4);

    let consumer_app = app.clone();
    let consumer = tauri::async_runtime::spawn(async move {
        let mut seg_idx: usize = 0;
        while let Some((samples_16k, lang, mdl, has_break)) = rx.recv().await {
            seg_idx += 1;
            log::debug!(
                "consumer got segment #{}, {} samples, lang={}, model={}, has_break={}",
                seg_idx,
                samples_16k.len(),
                if lang.is_empty() { "auto" } else { &lang },
                if mdl.is_empty() { "default" } else { &mdl },
                has_break
            );
            match fluid::transcribe_samples(&samples_16k, &lang, &mdl).await {
                Ok(t) => {
                    let t = t.trim().to_string();
                    log::debug!("transcript #{}: {:?} ({} chars)", seg_idx, t, t.len());
                    if !t.is_empty() {
                        match consumer_app.emit("transcript-segment", TranscriptSegment { text: t.clone(), has_break }) {
                            Ok(()) => log::debug!("emitted transcript-segment #{}", seg_idx),
                            Err(e) => log::error!("FAILED to emit transcript-segment #{}: {e}", seg_idx),
                        }
                    } else {
                        log::debug!("segment #{} transcript was empty, skipping emit", seg_idx);
                    }
                }
                Err(e) => {
                    log::error!("transcribe error #{seg_idx}: {e}");
                    let _ = consumer_app.emit("capture-error", TranscriptSegment { text: e, has_break: false });
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
    let mut post_flush_silence_samples: usize = 0;
    let mut pending_break = false;

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
                    if !had_speech {
                        let gap_secs = post_flush_silence_samples as f32 / rate as f32;
                        if gap_secs >= PARAGRAPH_SILENCE_SECS {
                            pending_break = true;
                        }
                    }
                    had_speech = true;
                    silence_samples = 0;
                    post_flush_silence_samples = 0;
                } else {
                    silence_samples += window.len();
                    post_flush_silence_samples += window.len();
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
            let samples_16k = if rate != TARGET_SR {
                resample(&seg, rate, TARGET_SR)
            } else {
                seg.clone()
            };
            let has_break = pending_break;
            pending_break = false;
            log::debug!(
                "flush segment #{}: {:.1}s ({} samples @16k){}",
                flush_count + 1,
                seg_secs,
                samples_16k.len(),
                if stopping { " [final]" } else { "" }
            );
            seg.clear();
            silence_samples = 0;
            had_speech = false;
            flush_count += 1;

            match tx.send((samples_16k, language.clone(), model.clone(), has_break)).await {
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

fn rms_mono(data: &[f32], channels: usize) -> f32 {
    if data.is_empty() || channels == 0 { return 0.0; }
    let samples: Vec<f32> = data
        .chunks(channels)
        .map(|f| f.iter().sum::<f32>() / channels as f32)
        .collect();
    rms(&samples)
}

fn rms_mono_i16(data: &[i16], channels: usize) -> f32 {
    if data.is_empty() || channels == 0 { return 0.0; }
    let samples: Vec<f32> = data
        .chunks(channels)
        .map(|f| f.iter().map(|&s| s as f32 / 32768.0).sum::<f32>() / channels as f32)
        .collect();
    rms(&samples)
}

fn rms_mono_u16(data: &[u16], channels: usize) -> f32 {
    if data.is_empty() || channels == 0 { return 0.0; }
    let samples: Vec<f32> = data
        .chunks(channels)
        .map(|f| f.iter().map(|&s| (s as f32 - 32768.0) / 32768.0).sum::<f32>() / channels as f32)
        .collect();
    rms(&samples)
}

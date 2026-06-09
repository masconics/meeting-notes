use std::sync::OnceLock;

use fluidaudio_rs::{FluidAudio, VadFrame};
use tauri::AppHandle;
use tokio::sync::Mutex;
use log;

fn slot() -> &'static Mutex<Option<FluidAudio>> {
    static S: OnceLock<Mutex<Option<FluidAudio>>> = OnceLock::new();
    S.get_or_init(|| Mutex::new(None))
}

async fn get_or_init() -> Result<(), String> {
    let mut guard = slot().lock().await;
    if guard.is_some() {
        return Ok(());
    }
    let audio = FluidAudio::new().map_err(|e| format!("fluidaudio: {}", e))?;
    log::info!(
        "fluidaudio-rs initialized on {} ({})",
        audio.system_info().chip_name,
        audio.system_info().platform
    );
    audio.init_asr().map_err(|e| format!("init ASR: {}", e))?;
    log::info!("fluidaudio ASR ready");
    audio.init_vad(0.85).map_err(|e| format!("init VAD: {}", e))?;
    log::info!("fluidaudio VAD ready");
    *guard = Some(audio);
    Ok(())
}

fn parse_wav_to_samples(wav: &[u8]) -> Result<(Vec<f32>, u32), String> {
    if wav.len() < 44 || &wav[0..4] != b"RIFF" || &wav[8..12] != b"WAVE" {
        return Err("invalid WAV header".into());
    }
    let sample_rate = u32::from_le_bytes([wav[24], wav[25], wav[26], wav[27]]);
    let bits_per_sample = u16::from_le_bytes([wav[34], wav[35]]);
    let data_size = u32::from_le_bytes([wav[40], wav[41], wav[42], wav[43]]) as usize;
    let data_start = 44usize;

    if data_start + data_size > wav.len() {
        return Err("WAV data size mismatch".into());
    }

    let sample_count = data_size / (bits_per_sample as usize / 8);
    let mut samples = Vec::with_capacity(sample_count);

    match bits_per_sample {
        16 => {
            for i in (0..data_size).step_by(2) {
                let byte_idx = data_start + i;
                let v = i16::from_le_bytes([wav[byte_idx], wav[byte_idx + 1]]);
                samples.push(v as f32 / 32768.0);
            }
        }
        32 => {
            for i in (0..data_size).step_by(4) {
                let byte_idx = data_start + i;
                let v = f32::from_le_bytes([wav[byte_idx], wav[byte_idx + 1], wav[byte_idx + 2], wav[byte_idx + 3]]);
                samples.push(v);
            }
        }
        _ => return Err(format!("unsupported bits per sample: {}", bits_per_sample)),
    }

    Ok((samples, sample_rate))
}

fn resample_to_16k(input: &[f32], src: u32) -> Vec<f32> {
    let dst: u32 = 16000;
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

#[tauri::command]
pub async fn transcribe_audio_fluid(
    _app: AppHandle,
    audio_data: Vec<u8>,
    _language: Option<String>,
    _model: Option<String>,
) -> Result<String, String> {
    let guard = slot().lock().await;
    let audio = guard.as_ref().ok_or("ASR not initialized. Run setup_fluid first.")?;

    let (samples, src_rate) = parse_wav_to_samples(&audio_data)?;
    let samples_16k = resample_to_16k(&samples, src_rate);

    let result = audio
        .transcribe_samples(&samples_16k)
        .map_err(|e| format!("transcription: {}", e))?;

    Ok(result.text)
}

#[tauri::command]
pub async fn check_fluid_ready(_app: AppHandle) -> Result<bool, String> {
    let guard = slot().lock().await;
    if let Some(audio) = guard.as_ref() {
        return Ok(audio.is_apple_silicon());
    }
    match FluidAudio::new() {
        Ok(audio) => Ok(audio.is_apple_silicon()),
        Err(_) => Ok(false),
    }
}

#[tauri::command]
pub async fn setup_fluid(_app: AppHandle) -> Result<bool, String> {
    get_or_init().await.map(|_| true)
}

#[tauri::command]
pub async fn unload_fluid() -> Result<(), String> {
    let mut guard = slot().lock().await;
    if let Some(audio) = guard.take() {
        audio.cleanup();
    }
    Ok(())
}

#[tauri::command]
pub async fn fluid_loaded() -> Result<bool, String> {
    let guard = slot().lock().await;
    Ok(guard.is_some())
}

pub async fn transcribe_samples(samples: &[f32], _language: &str, _model: &str) -> Result<String, String> {
    let guard = slot().lock().await;
    let audio = guard.as_ref().ok_or("ASR not initialized")?;
    let result = audio
        .transcribe_samples(samples)
        .map_err(|e| format!("transcription: {}", e))?;
    Ok(result.text)
}

pub async fn vad_process_samples(samples: &[f32]) -> Result<Vec<VadFrame>, String> {
    let guard = slot().lock().await;
    let audio = guard.as_ref().ok_or("VAD not initialized")?;
    audio.vad_process_samples(samples).map_err(|e| format!("VAD: {}", e))
}

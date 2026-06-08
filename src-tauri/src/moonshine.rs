// Moonshine-tiny streaming ASR engine (ONNX, via `ort`).
//
// Runs entirely on-device. The frontend already segments speech with a VAD and
// sends each segment as a 16 kHz mono 16-bit WAV (same payload as the whisper
// path), so this engine just turns one WAV into text. It is offered alongside
// whisper.cpp and selected via the asrEngine setting.
//
// Model: onnx-community/moonshine-tiny-ONNX. We use the split decoder export
// (decoder_model + decoder_with_past_model) rather than the merged one — the
// merged model's use_cache_branch `If` node leaves the decoder-KV outputs
// unmaterialized on the no-cache branch, which ort surfaces as a null data ptr.
//
//   encoder_model.onnx              input_values[1,N] -> last_hidden_state[1,enc,288]
//   decoder_model.onnx             (step 1) input_ids + encoder_hidden_states
//                                   -> logits + present.{decoder,encoder}.*
//   decoder_with_past_model.onnx   (steps 2+) input_ids[1] + past decoder+encoder KV
//                                   -> logits + present.decoder.* (encoder KV constant)
//
// Arch: 6 layers, 8 heads, head_dim 36, vocab 32768, bos=1, eos=2, start=1.

use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};

use ort::session::{Session, SessionInputValue};
use ort::session::builder::GraphOptimizationLevel;
use ort::value::Tensor;
use tauri::{AppHandle, Emitter, Manager};
use tokenizers::Tokenizer;

const N_LAYERS: usize = 6;
const HIDDEN: usize = 288;
const BOS: i64 = 1;
const EOS: i64 = 2;

const FILES: &[(&str, &str)] = &[
    (
        "encoder_model.onnx",
        "https://huggingface.co/onnx-community/moonshine-tiny-ONNX/resolve/main/onnx/encoder_model.onnx",
    ),
    (
        "decoder_model.onnx",
        "https://huggingface.co/onnx-community/moonshine-tiny-ONNX/resolve/main/onnx/decoder_model.onnx",
    ),
    (
        "decoder_with_past_model.onnx",
        "https://huggingface.co/onnx-community/moonshine-tiny-ONNX/resolve/main/onnx/decoder_with_past_model.onnx",
    ),
    (
        "tokenizer.json",
        "https://huggingface.co/onnx-community/moonshine-tiny-ONNX/resolve/main/tokenizer.json",
    ),
];

#[derive(serde::Serialize, Clone)]
pub struct DownloadProgress {
    pub downloaded: u64,
    pub total: u64,
}

// One cached KV tensor: the decoder-with-past input name plus its data + shape.
struct Kv {
    name: String,
    data: Vec<f32>,
    shape: [usize; 4],
}

fn model_dir(app: &AppHandle) -> PathBuf {
    let base = app
        .path()
        .app_data_dir()
        .unwrap_or_else(|_| std::env::temp_dir().join("meeting-notes"));
    base.join("moonshine")
}

fn files_present(dir: &Path) -> bool {
    FILES.iter().all(|(name, _)| {
        std::fs::metadata(dir.join(name))
            .map(|m| m.len() > 1000)
            .unwrap_or(false)
    })
}

struct Engine {
    enc: Session,
    dec: Session,
    dec_past: Session,
    tok: Tokenizer,
}

// Loaded once and reused across segments — building Sessions from the ~75 MB
// decoders is slow, and streaming calls this for every speech segment.
fn engine_slot() -> &'static Mutex<Option<Engine>> {
    static SLOT: OnceLock<Mutex<Option<Engine>>> = OnceLock::new();
    SLOT.get_or_init(|| Mutex::new(None))
}

fn build_session(path: &Path) -> Result<Session, String> {
    Session::builder()
        .map_err(|e| format!("session builder: {}", e))?
        .with_optimization_level(GraphOptimizationLevel::Level3)
        .map_err(|e| format!("opt level: {}", e))?
        .with_intra_threads(4)
        .map_err(|e| format!("threads: {}", e))?
        .commit_from_file(path)
        .map_err(|e| format!("load {}: {}", path.display(), e))
}

fn load_engine(dir: &Path) -> Result<Engine, String> {
    Ok(Engine {
        enc: build_session(&dir.join("encoder_model.onnx"))?,
        dec: build_session(&dir.join("decoder_model.onnx"))?,
        dec_past: build_session(&dir.join("decoder_with_past_model.onnx"))?,
        tok: Tokenizer::from_file(dir.join("tokenizer.json"))
            .map_err(|e| format!("tokenizer: {}", e))?,
    })
}

const TARGET_RATE: u32 = 16000;

#[inline]
fn sinc(x: f32) -> f32 {
    if x.abs() < 1e-6 {
        1.0
    } else {
        let px = std::f32::consts::PI * x;
        px.sin() / px
    }
}

// Anti-aliased resample to 16 kHz with a windowed-sinc kernel. Moonshine expects
// 16 kHz mono; the frontend asks for a 16 kHz AudioContext but some webviews
// (notably macOS WKWebView) ignore that and capture at 44.1/48 kHz. A crude
// linear resample aliases high frequencies down into the speech band and hurts
// recognition, so when downsampling we low-pass at the target Nyquist as part of
// the kernel (cutoff = output_rate / input_rate).
fn resample_to_16k(samples: &[f32], from_rate: u32) -> Vec<f32> {
    if from_rate == TARGET_RATE || samples.is_empty() {
        return samples.to_vec();
    }
    let ratio = TARGET_RATE as f32 / from_rate as f32;
    let cutoff = ratio.min(1.0); // fraction of input Nyquist to keep
    const TAPS: f32 = 16.0; // kernel half-width in output samples
    let half = (TAPS / cutoff).ceil() as isize; // half-width in input samples
    let len = samples.len() as isize;
    let out_len = ((samples.len() as f32) * ratio).round() as usize;
    let mut out = Vec::with_capacity(out_len);
    for i in 0..out_len {
        let center = i as f32 / ratio; // position in input samples
        let i0 = center.floor() as isize;
        let mut sum = 0.0f32;
        let mut norm = 0.0f32;
        for j in (i0 - half)..=(i0 + half) {
            if j < 0 || j >= len {
                continue;
            }
            let n = j as f32 - center;
            // Ideal low-pass (cutoff·sinc(cutoff·n)) times a Hann window.
            let w = cutoff * sinc(cutoff * n)
                * (0.5 + 0.5 * (std::f32::consts::PI * n / half as f32).cos());
            sum += samples[j as usize] * w;
            norm += w;
        }
        out.push(if norm != 0.0 { sum / norm } else { 0.0 });
    }
    out
}

// Trim leading/trailing silence. Moonshine-tiny emits EOS immediately when fed a
// long run of silence, so a VAD segment with several quiet seconds before/after
// the speech transcribes as empty. Crop to the voiced region with a small pad.
fn trim_silence(samples: &[f32]) -> Vec<f32> {
    const THRESHOLD: f32 = 0.01; // RMS gate (~-40 dBFS)
    let win = TARGET_RATE as usize / 50; // 20 ms windows
    if samples.len() <= win {
        return samples.to_vec();
    }
    let loud = |i: usize| -> bool {
        let end = (i + win).min(samples.len());
        let s = &samples[i..end];
        (s.iter().map(|v| v * v).sum::<f32>() / s.len() as f32).sqrt() > THRESHOLD
    };
    let mut first = 0;
    while first + win <= samples.len() && !loud(first) {
        first += win;
    }
    if first + win > samples.len() {
        return Vec::new(); // all silence
    }
    let mut last = samples.len();
    while last > first + win && !loud(last - win) {
        last -= win;
    }
    let pad = TARGET_RATE as usize / 10; // keep 100 ms on each side
    samples[first.saturating_sub(pad)..(last + pad).min(samples.len())].to_vec()
}

fn wav_to_f32(bytes: &[u8]) -> Result<Vec<f32>, String> {
    let mut reader = hound::WavReader::new(std::io::Cursor::new(bytes))
        .map_err(|e| format!("WAV parse: {}", e))?;
    let spec = reader.spec();
    let mut samples: Vec<f32> = match spec.sample_format {
        hound::SampleFormat::Int => {
            let max = (1i64 << (spec.bits_per_sample - 1)) as f32;
            reader
                .samples::<i32>()
                .map(|s| s.map(|v| v as f32 / max).unwrap_or(0.0))
                .collect()
        }
        hound::SampleFormat::Float => {
            reader.samples::<f32>().map(|s| s.unwrap_or(0.0)).collect()
        }
    };
    if spec.channels > 1 {
        let ch = spec.channels as usize;
        samples = samples
            .chunks(ch)
            .map(|c| c.iter().sum::<f32>() / ch as f32)
            .collect();
    }
    Ok(trim_silence(&resample_to_16k(&samples, spec.sample_rate)))
}

fn argmax(row: &[f32]) -> usize {
    let mut best = 0usize;
    let mut best_v = f32::NEG_INFINITY;
    for (i, &v) in row.iter().enumerate() {
        if v > best_v {
            best_v = v;
            best = i;
        }
    }
    best
}

// Extract a 4-D KV tensor output into owned data + shape.
fn take_kv(
    outs: &ort::session::SessionOutputs,
    out_name: &str,
    past_name: String,
) -> Result<Kv, String> {
    let (s, d) = outs[out_name]
        .try_extract_tensor::<f32>()
        .map_err(|e| format!("{}: {}", out_name, e))?;
    Ok(Kv {
        name: past_name,
        data: d.to_vec(),
        shape: [s[0] as usize, s[1] as usize, s[2] as usize, s[3] as usize],
    })
}

fn transcribe_samples(eng: &mut Engine, samples: Vec<f32>) -> Result<String, String> {
    let n = samples.len();
    if n == 0 {
        return Ok(String::new());
    }

    // Encoder pass.
    let enc_in =
        Tensor::from_array(([1usize, n], samples)).map_err(|e| format!("enc input: {}", e))?;
    let enc_out = eng
        .enc
        .run(ort::inputs!["input_values" => enc_in])
        .map_err(|e| format!("encoder run: {}", e))?;
    let (enc_shape, enc_data) = enc_out["last_hidden_state"]
        .try_extract_tensor::<f32>()
        .map_err(|e| format!("enc extract: {}", e))?;
    let enc_seq = enc_shape[1] as usize;
    let enc_hidden: Vec<f32> = enc_data.to_vec();
    drop(enc_out);

    let max_new = enc_seq.clamp(8, 256);
    let mut out_tokens: Vec<u32> = Vec::new();

    // ---- Step 1: decoder_model (no past) ----
    let enc_states = Tensor::from_array(([1usize, enc_seq, HIDDEN], enc_hidden))
        .map_err(|e| format!("enc states: {}", e))?;
    let outs = eng
        .dec
        .run(ort::inputs![
            "input_ids" => Tensor::from_array(([1usize, 1usize], vec![BOS])).map_err(|e| format!("ids: {}", e))?,
            "encoder_hidden_states" => enc_states,
        ])
        .map_err(|e| format!("decoder run: {}", e))?;

    let (lshape, ldata) = outs["logits"]
        .try_extract_tensor::<f32>()
        .map_err(|e| format!("logits: {}", e))?;
    let vocab = lshape[2] as usize;
    let dec_len = lshape[1] as usize;
    let mut next = argmax(&ldata[(dec_len - 1) * vocab..dec_len * vocab]) as i64;

    // Encoder KV is computed once and stays constant; decoder KV grows.
    let mut enc_kv: Vec<Kv> = Vec::with_capacity(N_LAYERS * 2);
    let mut dec_kv: Vec<Kv> = Vec::with_capacity(N_LAYERS * 2);
    for l in 0..N_LAYERS {
        for kv in ["key", "value"] {
            enc_kv.push(take_kv(
                &outs,
                &format!("present.{l}.encoder.{kv}"),
                format!("past_key_values.{l}.encoder.{kv}"),
            )?);
            dec_kv.push(take_kv(
                &outs,
                &format!("present.{l}.decoder.{kv}"),
                format!("past_key_values.{l}.decoder.{kv}"),
            )?);
        }
    }
    drop(outs);

    // ---- Steps 2+: decoder_with_past_model ----
    for _ in 1..max_new {
        if next == EOS {
            break;
        }
        out_tokens.push(next as u32);

        let mut ins: Vec<(String, SessionInputValue)> = Vec::with_capacity(N_LAYERS * 4 + 1);
        ins.push((
            "input_ids".into(),
            Tensor::from_array(([1usize, 1usize], vec![next]))
                .map_err(|e| format!("ids: {}", e))?
                .into(),
        ));
        for kv in enc_kv.iter().chain(dec_kv.iter()) {
            ins.push((
                kv.name.clone(),
                Tensor::from_array((kv.shape, kv.data.clone()))
                    .map_err(|e| format!("past {}: {}", kv.name, e))?
                    .into(),
            ));
        }

        let outs = eng
            .dec_past
            .run(ins)
            .map_err(|e| format!("decoder_past run: {}", e))?;

        let (ls, ld) = outs["logits"]
            .try_extract_tensor::<f32>()
            .map_err(|e| format!("logits: {}", e))?;
        let v = ls[2] as usize;
        let dl = ls[1] as usize;
        next = argmax(&ld[(dl - 1) * v..dl * v]) as i64;

        // Only decoder KV is re-output; refresh it for the next step.
        let mut new_dec: Vec<Kv> = Vec::with_capacity(N_LAYERS * 2);
        for l in 0..N_LAYERS {
            for kv in ["key", "value"] {
                new_dec.push(take_kv(
                    &outs,
                    &format!("present.{l}.decoder.{kv}"),
                    format!("past_key_values.{l}.decoder.{kv}"),
                )?);
            }
        }
        drop(outs);
        dec_kv = new_dec;
    }

    let text = eng
        .tok
        .decode(&out_tokens, true)
        .map_err(|e| format!("detokenize: {}", e))?;
    Ok(text.trim().to_string())
}

// Stream a download to disk, reporting progress on "moonshine-download-progress".
async fn download_file(app: &AppHandle, url: &str, dest: &Path) -> Result<(), String> {
    let client = reqwest::Client::builder()
        .user_agent("meeting-notes/0.1.0")
        .build()
        .map_err(|e| format!("HTTP client: {}", e))?;
    let mut resp = client
        .get(url)
        .send()
        .await
        .map_err(|e| format!("request failed: {}", e))?;
    if !resp.status().is_success() {
        return Err(format!("server returned {}", resp.status()));
    }
    let total = resp.content_length().unwrap_or(0);
    let mut downloaded: u64 = 0;
    let mut last_emit: u64 = 0;
    let mut buf: Vec<u8> = Vec::with_capacity(total as usize);
    while let Some(chunk) = resp
        .chunk()
        .await
        .map_err(|e| format!("download stream: {}", e))?
    {
        buf.extend_from_slice(&chunk);
        downloaded += chunk.len() as u64;
        if downloaded - last_emit >= 1_048_576 {
            last_emit = downloaded;
            let _ = app.emit("moonshine-download-progress", DownloadProgress { downloaded, total });
        }
    }
    tokio::fs::write(dest, &buf)
        .await
        .map_err(|e| format!("write {}: {}", dest.display(), e))?;
    Ok(())
}

#[tauri::command]
pub async fn check_moonshine_ready(app: AppHandle) -> Result<bool, String> {
    Ok(files_present(&model_dir(&app)))
}

// Drop the cached Moonshine sessions to free their RAM (~186 MB). The frontend
// calls this when the user switches the transcription engine away from
// Moonshine; the engine lazily reloads on the next Moonshine transcription.
#[tauri::command]
pub async fn unload_moonshine() -> Result<(), String> {
    if let Ok(mut guard) = engine_slot().lock() {
        *guard = None;
    }
    Ok(())
}

#[tauri::command]
pub async fn setup_moonshine(app: AppHandle) -> Result<bool, String> {
    let dir = model_dir(&app);
    tokio::fs::create_dir_all(&dir)
        .await
        .map_err(|e| format!("create dir: {}", e))?;
    for (name, url) in FILES {
        let dest = dir.join(name);
        let ok = tokio::fs::metadata(&dest)
            .await
            .map(|m| m.len() > 1000)
            .unwrap_or(false);
        if !ok {
            download_file(&app, url, &dest).await?;
        }
    }
    Ok(files_present(&dir))
}

#[tauri::command]
pub async fn transcribe_audio_moonshine(
    app: AppHandle,
    audio_data: Vec<u8>,
) -> Result<String, String> {
    let dir = model_dir(&app);
    if !files_present(&dir) {
        return Err("Moonshine model not installed. Download it in Settings.".into());
    }
    let samples = wav_to_f32(&audio_data)?;

    // ONNX inference is blocking and Session::run needs &mut, so do it on a
    // blocking thread holding the engine lock (serializes concurrent segments).
    tokio::task::spawn_blocking(move || {
        let mut guard = engine_slot()
            .lock()
            .map_err(|_| "engine lock poisoned".to_string())?;
        if guard.is_none() {
            *guard = Some(load_engine(&dir)?);
        }
        let eng = guard.as_mut().unwrap();
        transcribe_samples(eng, samples)
    })
    .await
    .map_err(|e| format!("inference task failed: {}", e))?
}

#[cfg(test)]
mod tests {
    use super::*;

    // Round-trips a real speech WAV through the engine. Driven by env vars so it
    // is skipped in normal runs but reproducible locally:
    //   MOONSHINE_DIR=/tmp/moonshine-test MOONSHINE_WAV=/tmp/speech16k.wav \
    //     cargo test moonshine_roundtrip -- --nocapture --ignored
    #[test]
    #[ignore]
    fn moonshine_roundtrip() {
        let dir = std::env::var("MOONSHINE_DIR").expect("set MOONSHINE_DIR");
        let wav = std::env::var("MOONSHINE_WAV").expect("set MOONSHINE_WAV");
        let bytes = std::fs::read(&wav).expect("read wav");
        let samples = wav_to_f32(&bytes).expect("decode wav");
        let mut eng = load_engine(Path::new(&dir)).expect("load engine");
        let text = transcribe_samples(&mut eng, samples).expect("transcribe");
        println!("MOONSHINE OUTPUT: >>>{}<<<", text);
        assert!(!text.is_empty(), "expected non-empty transcription");
    }
}

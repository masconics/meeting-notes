use std::path::PathBuf;
use std::process::Command;
use std::sync::OnceLock;
use tauri::AppHandle;
use tauri::Emitter;
use tauri::Manager;
use tokio::sync::Mutex;

// Serializes model downloads so concurrent callers (e.g. StrictMode double
// status checks) don't kick off two parallel downloads emitting interleaved
// progress on the same event — which made the progress bar jump.
fn model_lock() -> &'static Mutex<()> {
    static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
    LOCK.get_or_init(|| Mutex::new(()))
}

#[derive(serde::Serialize, Clone)]
pub struct DownloadProgress {
    pub downloaded: u64,
    pub total: u64,
}

const WHISPER_BIN_PATHS: &[&str] = &[
    "/opt/homebrew/bin/whisper-cli",
    "/usr/local/bin/whisper-cli",
    "/opt/homebrew/bin/whisper-cpp",
    "/usr/local/bin/whisper-cpp",
];

const MODEL_URLS: &[&str] = &[
    "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.en.bin",
];
const MODEL_FILENAME: &str = "ggml-small.en.bin";

fn data_dir(app: &AppHandle) -> PathBuf {
    app.path()
        .app_data_dir()
        .unwrap_or_else(|_| std::env::temp_dir().join("meeting-notes"))
}

fn is_macho(data: &[u8]) -> bool {
    data.len() > 100_000 && [0xcf, 0xce, 0xfe, 0xca].contains(&data[0])
}

fn find_system_whisper() -> Option<PathBuf> {
    for path in WHISPER_BIN_PATHS {
        let p = PathBuf::from(path);
        if p.exists() {
            if let Ok(data) = std::fs::read(&p) {
                if is_macho(&data) {
                    return Some(p);
                }
            }
        }
    }
    if let Ok(output) = Command::new("which").arg("whisper-cli").output() {
        if output.status.success() {
            let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
            let p = PathBuf::from(&path);
            if p.exists() {
                return Some(p);
            }
        }
    }
    if let Ok(output) = Command::new("which").arg("whisper-cpp").output() {
        if output.status.success() {
            let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
            let p = PathBuf::from(&path);
            if p.exists() {
                return Some(p);
            }
        }
    }
    None
}

// Stream the download so we can report progress to the UI via the
// "model-download-progress" event. Emits are throttled to ~every 1MB to avoid
// flooding the event channel.
async fn download(app: &AppHandle, url: &str) -> Result<Vec<u8>, String> {
    let client = reqwest::Client::builder()
        .user_agent("meeting-notes/0.1.0")
        .build()
        .map_err(|e| format!("HTTP client error: {}", e))?;

    let mut resp = client
        .get(url)
        .header("Accept", "application/octet-stream")
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

    let _ = app.emit("model-download-progress", DownloadProgress { downloaded: 0, total });

    while let Some(chunk) = resp
        .chunk()
        .await
        .map_err(|e| format!("download stream error: {}", e))?
    {
        buf.extend_from_slice(&chunk);
        downloaded += chunk.len() as u64;
        if downloaded - last_emit >= 1_048_576 {
            last_emit = downloaded;
            let _ = app.emit("model-download-progress", DownloadProgress { downloaded, total });
        }
    }

    // Final 100% tick.
    let _ = app.emit(
        "model-download-progress",
        DownloadProgress { downloaded, total: if total == 0 { downloaded } else { total } },
    );

    Ok(buf)
}

async fn ensure_binary(app: &AppHandle) -> Result<PathBuf, String> {
    if let Some(sys_bin) = find_system_whisper() {
        return Ok(sys_bin);
    }

    let dir = data_dir(app);
    tokio::fs::create_dir_all(&dir)
        .await
        .map_err(|e| format!("Cannot create data dir: {}", e))?;
    let bin_path = dir.join("whisper-cli");

    let valid = bin_path.exists()
        && tokio::fs::read(&bin_path).await.map_or(false, |d| is_macho(&d));

    if valid {
        return Ok(bin_path);
    }

    let _ = tokio::fs::remove_file(&bin_path).await;

    Err(format!(
        "whisper-cpp not found. Install it with:\n  brew install whisper-cpp\n\n\
         Then restart the app."
    ))
}

fn model_ready_path(app: &AppHandle) -> Option<PathBuf> {
    let p = data_dir(app).join(MODEL_FILENAME);
    match std::fs::metadata(&p) {
        Ok(m) if m.len() > 100_000 => Some(p),
        _ => None,
    }
}

async fn ensure_model(app: &AppHandle) -> Result<PathBuf, String> {
    // Fast path: already downloaded.
    if let Some(p) = model_ready_path(app) {
        return Ok(p);
    }

    // Hold the lock so only one download runs; concurrent callers queue here.
    let _guard = model_lock().lock().await;

    // A queued caller may find the download already finished by the holder.
    if let Some(p) = model_ready_path(app) {
        return Ok(p);
    }

    let dir = data_dir(app);
    tokio::fs::create_dir_all(&dir)
        .await
        .map_err(|e| format!("Cannot create data dir: {}", e))?;
    let model_path = dir.join(MODEL_FILENAME);
    let _ = tokio::fs::remove_file(&model_path).await; // drop any partial/stale file

    let mut last_error = String::new();
    for url in MODEL_URLS {
        match download(app, url).await {
            Ok(bytes) => {
                tokio::fs::write(&model_path, &bytes)
                    .await
                    .map_err(|e| format!("Cannot write model: {}", e))?;
                return Ok(model_path);
            }
            Err(e) => {
                last_error = e;
            }
        }
    }
    Err(format!("Model download failed: {}", last_error))
}

#[tauri::command]
pub async fn transcribe_audio(app: AppHandle, audio_data: Vec<u8>) -> Result<String, String> {
    let bin = ensure_binary(&app)
        .await
        .map_err(|e| format!("Whisper engine setup failed: {}", e))?;

    let model = ensure_model(&app)
        .await
        .map_err(|e| format!("Model download failed: {}", e))?;

    // Unique file per call: segment flushes and the Notes modal can invoke
    // transcribe_audio concurrently, so a fixed path would race.
    let dir = data_dir(&app);
    tokio::fs::create_dir_all(&dir)
        .await
        .map_err(|e| format!("Cannot create data dir: {}", e))?;
    let named = tempfile::Builder::new()
        .prefix("input-")
        .suffix(".wav")
        .tempfile_in(&dir)
        .map_err(|e| format!("Cannot create temp audio file: {}", e))?;
    let input_path = named.into_temp_path().keep().map_err(|e| format!("Cannot persist temp audio file: {}", e))?;
    tokio::fs::write(&input_path, &audio_data)
        .await
        .map_err(|e| format!("Cannot write audio: {}", e))?;

    let bin2 = bin.clone();
    let model2 = model.clone();
    let input2 = input_path.clone();

    let output = tokio::task::spawn_blocking(move || {
        Command::new(&bin2)
            .arg("-m")
            .arg(model2.to_str().unwrap_or(""))
            .arg("-f")
            .arg(input2.to_str().unwrap_or(""))
            .arg("-nt")
            .arg("-l")
            .arg("en")
            .output()
    })
    .await
    .map_err(|e| format!("Failed to run whisper: {}", e))?
    .map_err(|e| format!("Whisper execution error: {}", e))?;

    let _ = tokio::fs::remove_file(&input_path).await;

    let stderr = String::from_utf8_lossy(&output.stderr);
    let stdout = String::from_utf8_lossy(&output.stdout);

    if !output.status.success() {
        return Err(format!(
            "Whisper exited with {}: {}",
            output.status,
            if !stderr.is_empty() { stderr.trim() } else { stdout.trim() }
        ));
    }

    let text = stdout.trim().to_string();
    if text.is_empty() {
        return Err("No speech detected in the recording".into());
    }

    Ok(text)
}

#[tauri::command]
pub async fn check_whisper_ready(app: AppHandle) -> Result<bool, String> {
    // Read-only: never starts a download (that's setup_whisper's job).
    let bin_ok = ensure_binary(&app).await.is_ok();
    let model_ok = model_ready_path(&app).is_some();
    Ok(bin_ok && model_ok)
}

#[derive(serde::Serialize)]
pub struct WhisperStatus {
    pub binary: bool,
    pub model: bool,
    pub ready: bool,
}

#[tauri::command]
pub async fn get_whisper_status(app: AppHandle) -> Result<WhisperStatus, String> {
    // Read-only status — does not trigger a download.
    let binary = ensure_binary(&app).await.is_ok();
    let model = model_ready_path(&app).is_some();
    Ok(WhisperStatus {
        binary,
        model,
        ready: binary && model,
    })
}

#[tauri::command]
pub async fn setup_whisper(app: AppHandle) -> Result<WhisperStatus, String> {
    let binary = ensure_binary(&app).await.is_ok();
    let model = ensure_model(&app).await.is_ok();
    Ok(WhisperStatus {
        binary,
        model,
        ready: binary && model,
    })
}

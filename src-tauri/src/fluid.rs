// Parakeet-v3 (Core ML / ANE) engine via a persistent Swift sidecar.
//
// The heavy lifting runs in `fluidasr`, a Swift binary built against FluidAudio
// that loads Parakeet TDT v3 as Core ML and runs it on the Apple Neural Engine
// (the same model family superwhisper uses). ONNX/`ort` can't drive the ANE for
// these dynamic-shape models, so we shell out — like the whisper-cli path, but
// long-lived so the model stays resident.
//
// Protocol over the child's stdin/stdout (UTF-8 lines):
//   <- "READY"               once models are loaded
//   -> "<wav path>"          one request per line
//   <- "OK\t<text>" | "ERR\t<msg>"
//
// FluidAudio auto-downloads the Core ML models on first run (cached under
// ~/Library/Application Support/FluidAudio/Models).

use std::io::{BufRead, BufReader, Write};
use std::path::PathBuf;
use std::process::{Child, ChildStdin, ChildStdout, Command, Stdio};
use std::sync::{Mutex, OnceLock};

use tauri::{AppHandle, Manager};

struct Sidecar {
    child: Child,
    stdin: ChildStdin,
    stdout: BufReader<ChildStdout>,
}

impl Drop for Sidecar {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

fn slot() -> &'static Mutex<Option<Sidecar>> {
    static S: OnceLock<Mutex<Option<Sidecar>>> = OnceLock::new();
    S.get_or_init(|| Mutex::new(None))
}

fn binary_path(app: &AppHandle) -> PathBuf {
    if let Ok(p) = std::env::var("FLUID_SIDECAR_BIN") {
        return PathBuf::from(p);
    }
    let base = app
        .path()
        .app_data_dir()
        .unwrap_or_else(|_| std::env::temp_dir().join("meeting-notes"));
    base.join("fluidasr")
}

fn binary_present(app: &AppHandle) -> bool {
    std::fs::metadata(binary_path(app))
        .map(|m| m.len() > 1000)
        .unwrap_or(false)
}

// Spawn the sidecar and block until it reports READY (first run downloads models,
// so this can take a while).
fn spawn(app: &AppHandle) -> Result<Sidecar, String> {
    let bin = binary_path(app);
    let mut child = Command::new(&bin)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| format!("spawn {}: {}", bin.display(), e))?;
    let stdin = child.stdin.take().ok_or("no stdin")?;
    let mut stdout = BufReader::new(child.stdout.take().ok_or("no stdout")?);

    loop {
        let mut line = String::new();
        let n = stdout
            .read_line(&mut line)
            .map_err(|e| format!("read READY: {}", e))?;
        if n == 0 {
            return Err("sidecar exited before READY".into());
        }
        let line = line.trim();
        if line == "READY" {
            break;
        }
        if let Some(msg) = line.strip_prefix("FATAL\t") {
            return Err(format!("sidecar fatal: {}", msg));
        }
    }
    Ok(Sidecar { child, stdin, stdout })
}

// Send one request and read its response. Returns the transcript or an error.
fn request(sc: &mut Sidecar, wav_path: &str) -> Result<String, String> {
    writeln!(sc.stdin, "{}", wav_path).map_err(|e| format!("write req: {}", e))?;
    sc.stdin.flush().map_err(|e| format!("flush: {}", e))?;
    let mut line = String::new();
    let n = sc
        .stdout
        .read_line(&mut line)
        .map_err(|e| format!("read resp: {}", e))?;
    if n == 0 {
        return Err("sidecar closed".into());
    }
    let line = line.trim_end_matches(['\r', '\n']);
    if let Some(text) = line.strip_prefix("OK\t") {
        Ok(text.to_string())
    } else if let Some(msg) = line.strip_prefix("ERR\t") {
        Err(format!("transcription error: {}", msg))
    } else {
        Err(format!("unexpected response: {}", line))
    }
}

#[tauri::command]
pub async fn check_fluid_ready(app: AppHandle) -> Result<bool, String> {
    Ok(binary_present(&app))
}

// Warm up: spawn the sidecar (downloads models on first run) and keep it resident.
#[tauri::command]
pub async fn setup_fluid(app: AppHandle) -> Result<bool, String> {
    if !binary_present(&app) {
        return Err("Parakeet (Core ML) sidecar binary not installed.".into());
    }
    tokio::task::spawn_blocking(move || {
        let mut guard = slot().lock().map_err(|_| "lock poisoned".to_string())?;
        if guard.is_none() {
            *guard = Some(spawn(&app)?);
        }
        Ok::<bool, String>(true)
    })
    .await
    .map_err(|e| format!("setup task failed: {}", e))?
}

#[tauri::command]
pub async fn unload_fluid() -> Result<(), String> {
    if let Ok(mut guard) = slot().lock() {
        *guard = None; // Drop kills the child
    }
    Ok(())
}

#[tauri::command]
pub async fn fluid_loaded() -> Result<bool, String> {
    Ok(slot().lock().map(|g| g.is_some()).unwrap_or(false))
}

#[tauri::command]
pub async fn transcribe_audio_fluid(app: AppHandle, audio_data: Vec<u8>) -> Result<String, String> {
    if !binary_present(&app) {
        return Err("Parakeet (Core ML) sidecar not installed.".into());
    }
    // Persist the segment WAV to a temp file the sidecar can open.
    let dir = app
        .path()
        .app_data_dir()
        .unwrap_or_else(|_| std::env::temp_dir().join("meeting-notes"));
    tokio::fs::create_dir_all(&dir)
        .await
        .map_err(|e| format!("create dir: {}", e))?;
    let tmp = tempfile::Builder::new()
        .prefix("fluid-")
        .suffix(".wav")
        .tempfile_in(&dir)
        .map_err(|e| format!("temp file: {}", e))?;
    let path = tmp.into_temp_path().keep().map_err(|e| format!("persist temp: {}", e))?;
    tokio::fs::write(&path, &audio_data)
        .await
        .map_err(|e| format!("write wav: {}", e))?;

    let path_str = path.to_string_lossy().to_string();
    let result = tokio::task::spawn_blocking(move || {
        let mut guard = slot().lock().map_err(|_| "lock poisoned".to_string())?;
        if guard.is_none() {
            *guard = Some(spawn(&app)?);
        }
        // Retry once if the pipe broke (sidecar died).
        match request(guard.as_mut().unwrap(), &path_str) {
            Ok(t) => Ok(t),
            Err(_) => {
                *guard = Some(spawn(&app)?);
                request(guard.as_mut().unwrap(), &path_str)
            }
        }
    })
    .await
    .map_err(|e| format!("inference task failed: {}", e))?;

    let _ = tokio::fs::remove_file(&path).await;
    result
}

use std::path::PathBuf;
use std::sync::OnceLock;
use std::time::Duration;

use tauri::{AppHandle, Manager};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use std::process::Stdio;
use tokio::process::{Child, Command};
use tokio::sync::Mutex;
use log;

const REQUEST_TIMEOUT_SECS: u64 = 30;

struct Sidecar {
    child: Child,
    stdin: tokio::process::ChildStdin,
    stdout: BufReader<tokio::process::ChildStdout>,
}

impl Drop for Sidecar {
    fn drop(&mut self) {
        log::debug!("sidecar dropped, killing child");
        let _ = self.child.start_kill();
    }
}

fn slot() -> &'static Mutex<Option<Sidecar>> {
    static S: OnceLock<Mutex<Option<Sidecar>>> = OnceLock::new();
    S.get_or_init(|| Mutex::new(None))
}

fn binary_path(app: &AppHandle) -> PathBuf {
    if let Ok(p) = std::env::var("FLUID_SIDECAR_BIN") {
        let pb = PathBuf::from(&p);
        if std::fs::metadata(&pb).map(|m| m.len() > 1000).unwrap_or(false) {
            return pb;
        }
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            let bundled = dir.join("fluidasr");
            if std::fs::metadata(&bundled).map(|m| m.len() > 1000).unwrap_or(false) {
                return bundled;
            }
        }
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

async fn spawn_sidecar(app: &AppHandle, sensevoice: bool) -> Result<Sidecar, String> {
    let bin = binary_path(app);
    log::debug!("spawning sidecar: {} {}", bin.display(), if sensevoice { "--sensevoice" } else { "" });
    let mut cmd = Command::new(&bin);
    cmd.stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    if sensevoice {
        cmd.arg("--sensevoice");
    }
    let mut child = cmd
        .spawn()
        .map_err(|e| format!("spawn {}: {}", bin.display(), e))?;
    let stdin = child.stdin.take().ok_or("no stdin")?;
    let mut stdout = BufReader::new(child.stdout.take().ok_or("no stdout")?);

    let ready = tokio::time::timeout(Duration::from_secs(300), async {
        loop {
            let mut line = String::new();
            let n = stdout
                .read_line(&mut line)
                .await
                .map_err(|e| format!("read READY: {}", e))?;
            if n == 0 {
                return Err("sidecar exited before READY".into());
            }
            let line = line.trim();
            if line == "READY" {
                return Ok(());
            }
            if let Some(msg) = line.strip_prefix("FATAL\t") {
                return Err(format!("sidecar fatal: {}", msg));
            }
        }
    })
    .await;

    match ready {
        Ok(Ok(())) => {
            log::debug!("sidecar ready");
            Ok(Sidecar {
                child,
                stdin,
                stdout,
            })
        }
        Ok(Err(e)) => {
            log::error!("sidecar failed to start: {e}");
            Err(e)
        }
        Err(_) => {
            let _ = child.start_kill();
            Err("sidecar did not become ready within 300s".into())
        }
    }
}

async fn request(sc: &mut Sidecar, wav_path: &str, language: &str) -> Result<String, String> {
    let msg = if language.is_empty() {
        format!("{}\n", wav_path)
    } else {
        format!("{}\t{}\n", language, wav_path)
    };
    log::debug!("request: sending {}", msg.trim());
    sc.stdin
        .write_all(msg.as_bytes())
        .await
        .map_err(|e| format!("write req: {}", e))?;
    sc.stdin
        .flush()
        .await
        .map_err(|e| format!("flush: {}", e))?;

    log::debug!("request: waiting for response...");
    let mut line = String::new();
    let read_result = tokio::time::timeout(
        Duration::from_secs(REQUEST_TIMEOUT_SECS),
        sc.stdout.read_line(&mut line),
    )
    .await;

    match read_result {
        Ok(Ok(n)) => {
            if n == 0 {
                log::debug!("request: sidecar closed (n=0)");
                return Err("sidecar closed".into());
            }
            let line = line.trim_end_matches(['\r', '\n']);
            log::debug!("request: got response: {:?}", line);
            if let Some(text) = line.strip_prefix("OK\t") {
                Ok(text.to_string())
            } else if let Some(msg) = line.strip_prefix("ERR\t") {
                Err(format!("transcription error: {}", msg))
            } else {
                Err(format!("unexpected response: {}", line))
            }
        }
        Ok(Err(e)) => {
            log::error!("request: read error: {e}");
            Err(format!("read resp: {}", e))
        }
        Err(_) => {
            log::debug!("request: timed out");
            Err("sidecar request timed out".into())
        }
    }
}

pub async fn prewarm_fluid(app: &AppHandle, sensevoice: bool) {
    if !binary_present(app) { return; }
    let mut guard = slot().lock().await;
    if guard.is_some() { return; }
    log::debug!("prewarming sidecar (sensevoice={})", sensevoice);
    match spawn_sidecar(app, sensevoice).await {
        Ok(s) => { *guard = Some(s); }
        Err(e) => { log::error!("prewarm failed: {e}"); }
    }
}

#[tauri::command]
pub async fn check_fluid_ready(app: AppHandle) -> Result<bool, String> {
    Ok(binary_present(&app))
}

#[tauri::command]
pub async fn setup_fluid(app: AppHandle) -> Result<bool, String> {
    if !binary_present(&app) {
        return Err("Parakeet (Core ML) sidecar binary not installed.".into());
    }
    let mut guard = slot().lock().await;
    if guard.is_none() {
        *guard = Some(spawn_sidecar(&app, false).await?);
    }
    Ok(true)
}

#[tauri::command]
pub async fn unload_fluid() -> Result<(), String> {
    let mut guard = slot().lock().await;
    *guard = None;
    Ok(())
}

#[tauri::command]
pub async fn fluid_loaded() -> Result<bool, String> {
    let guard = slot().lock().await;
    Ok(guard.is_some())
}

#[tauri::command]
pub async fn transcribe_audio_fluid(
    app: AppHandle,
    audio_data: Vec<u8>,
    language: Option<String>,
    model: Option<String>,
) -> Result<String, String> {
    if !binary_present(&app) {
        return Err("ASR sidecar not installed.".into());
    }
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
    let path = tmp
        .into_temp_path()
        .keep()
        .map_err(|e| format!("persist temp: {}", e))?;
    tokio::fs::write(&path, &audio_data)
        .await
        .map_err(|e| format!("write wav: {}", e))?;

    let sensevoice = model.as_deref() == Some("sensevoice");
    let lang = language.as_deref().unwrap_or("");
    let path_str = path.to_string_lossy().to_string();
    log::debug!("transcribe_audio_fluid: wav={}, size={} bytes, lang={}, model={}", path_str, audio_data.len(), if lang.is_empty() { "auto" } else { lang }, if sensevoice { "sensevoice" } else { "parakeet" });
    let result = {
        let mut guard = slot().lock().await;
        if guard.is_none() {
            log::debug!("no sidecar in slot, spawning...");
            *guard = Some(spawn_sidecar(&app, sensevoice).await?);
        }
        match request(guard.as_mut().unwrap(), &path_str, lang).await {
            Ok(t) => {
                log::debug!("sidecar responded OK ({} chars)", t.len());
                Ok(t)
            }
            Err(e) => {
                log::error!("sidecar request failed: {e}, respawning...");
                *guard = Some(spawn_sidecar(&app, sensevoice).await?);
                log::debug!("sidecar respawned, retrying request...");
                let r = request(guard.as_mut().unwrap(), &path_str, lang).await;
                log::debug!("retry result: {:?}", r.as_ref().map(|s| s.len()));
                r
            }
        }
    };

    let _ = tokio::fs::remove_file(&path).await;
    result
}

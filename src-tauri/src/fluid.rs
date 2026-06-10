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

// Single-model setup: every path uses Parakeet v3, so the sidecar is spawned
// with no model-selection flags.
async fn spawn_sidecar(app: &AppHandle) -> Result<Sidecar, String> {
    let bin = binary_path(app);
    log::debug!("spawning sidecar: {}", bin.display());
    let mut cmd = Command::new(&bin);
    cmd.stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
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
            // See spawn_stream_sidecar: CoreML diagnostics can glue to READY.
            if line == "READY" || line.ends_with("READY") {
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
    // CoreML/E5RT can print diagnostics to the sidecar's stdout between protocol
    // lines — keep reading until an OK/ERR response (or timeout) instead of
    // failing on the first unexpected line.
    let read_result = tokio::time::timeout(Duration::from_secs(REQUEST_TIMEOUT_SECS), async {
        loop {
            let mut line = String::new();
            let n = sc
                .stdout
                .read_line(&mut line)
                .await
                .map_err(|e| format!("read resp: {}", e))?;
            if n == 0 {
                log::debug!("request: sidecar closed (n=0)");
                return Err("sidecar closed".to_string());
            }
            let line = line.trim_end_matches(['\r', '\n']);
            log::debug!("request: got response: {:?}", line);
            if let Some(text) = line.strip_prefix("OK\t") {
                return Ok(text.to_string());
            }
            if let Some(msg) = line.strip_prefix("ERR\t") {
                return Err(format!("transcription error: {}", msg));
            }
            log::debug!("request: skipping non-protocol line");
        }
    })
    .await;

    match read_result {
        Ok(r) => r,
        Err(_) => {
            log::debug!("request: timed out");
            Err("sidecar request timed out".into())
        }
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
        *guard = Some(spawn_sidecar(&app).await?);
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

// ---- Screen Recording permission (for system audio capture) -----------------
//
// ScreenCaptureKit runs inside the sidecar, so the TCC permission is attributed to
// the sidecar binary — the probe must run there too (not in the main app process).

// The probe must run in *this* process (the main app), not the sidecar: macOS
// attributes a child process's screen-capture to its responsible parent, so the
// grant the user sees and gives is "Notes" — and that's the grant the sidecar's
// ScreenCaptureKit capture runs under.
#[cfg(target_os = "macos")]
mod screen_access {
    #[link(name = "CoreGraphics", kind = "framework")]
    extern "C" {
        fn CGPreflightScreenCaptureAccess() -> bool;
        fn CGRequestScreenCaptureAccess() -> bool;
    }
    /// Current grant state, no prompt.
    pub fn preflight() -> bool {
        unsafe { CGPreflightScreenCaptureAccess() }
    }
    /// Prompts when undetermined; returns the resulting grant.
    pub fn request() -> bool {
        unsafe { CGRequestScreenCaptureAccess() }
    }
}

/// Current Screen Recording grant state (does not prompt).
#[tauri::command]
pub async fn check_screen_permission() -> Result<bool, String> {
    #[cfg(target_os = "macos")]
    {
        Ok(screen_access::preflight())
    }
    #[cfg(not(target_os = "macos"))]
    {
        Ok(true)
    }
}

/// Request Screen Recording access (prompts when undetermined). Returns the result.
#[tauri::command]
pub async fn request_screen_permission() -> Result<bool, String> {
    #[cfg(target_os = "macos")]
    {
        Ok(screen_access::request())
    }
    #[cfg(not(target_os = "macos"))]
    {
        Ok(true)
    }
}

// ---- Streaming live-caption mode -------------------------------------------
//
// Separate from the batch request/response path above. The sidecar is launched
// with `--stream`, audio is pushed continuously as length-prefixed binary frames,
// and the sidecar streams back JSON `{confirmed, volatile}` lines. Parakeet only
// (SenseVoice has no streaming manager).

/// Owns the streaming sidecar. `feed` pushes audio; `finish` closes stdin so the
/// sidecar flushes its final transcript and exits cleanly. Dropping without
/// finishing kills the child.
pub struct StreamSidecar {
    child: Child,
    stdin: Option<tokio::process::ChildStdin>,
}

impl Drop for StreamSidecar {
    fn drop(&mut self) {
        let _ = self.child.start_kill();
    }
}

impl StreamSidecar {
    /// Push mono f32 samples (at the configured rate) as one frame.
    pub async fn feed(&mut self, samples: &[f32]) -> Result<(), String> {
        let stdin = self.stdin.as_mut().ok_or("stream stdin closed")?;
        write_frame(stdin, &samples_to_le_bytes(samples)).await
    }

    /// Close stdin (signals end-of-stream) and wait for the sidecar to exit so it
    /// can flush its final transcript. Bounded so a hung child can't block stop.
    pub async fn finish(mut self) {
        self.stdin = None; // drop stdin → sidecar sees EOF
        let _ = tokio::time::timeout(Duration::from_secs(5), self.child.wait()).await;
    }
}

/// Write one length-prefixed frame (4-byte LE length + payload) to the sidecar.
pub async fn write_frame(
    stdin: &mut tokio::process::ChildStdin,
    payload: &[u8],
) -> Result<(), String> {
    let len = (payload.len() as u32).to_le_bytes();
    stdin.write_all(&len).await.map_err(|e| format!("frame len: {e}"))?;
    if !payload.is_empty() {
        stdin.write_all(payload).await.map_err(|e| format!("frame body: {e}"))?;
    }
    stdin.flush().await.map_err(|e| format!("frame flush: {e}"))
}

/// Serialize mono f32 samples as a little-endian byte payload.
pub fn samples_to_le_bytes(samples: &[f32]) -> Vec<u8> {
    let mut out = Vec::with_capacity(samples.len() * 4);
    for s in samples {
        out.extend_from_slice(&s.to_le_bytes());
    }
    out
}

/// Spawn the streaming sidecar, send the config frame (`"<rate>\t<lang>"`), and wait
/// for READY. Returns the handle (holds stdin) and a reader over its stdout lines.
pub async fn spawn_stream_sidecar(
    app: &AppHandle,
    rate: u32,
    language: &str,
    source: &str,
) -> Result<(StreamSidecar, BufReader<tokio::process::ChildStdout>), String> {
    let bin = binary_path(app);
    log::debug!("spawning stream sidecar: {} --stream --source {}", bin.display(), source);
    let mut cmd = Command::new(&bin);
    cmd.arg("--stream")
        .arg("--source")
        .arg(source)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let mut child = cmd.spawn().map_err(|e| format!("spawn {}: {}", bin.display(), e))?;
    let mut stdin = child.stdin.take().ok_or("no stdin")?;
    let mut stdout = BufReader::new(child.stdout.take().ok_or("no stdout")?);

    // Surface sidecar diagnostics (system-audio capture state, errors) in the app log.
    if let Some(stderr) = child.stderr.take() {
        tauri::async_runtime::spawn(async move {
            let mut lines = BufReader::new(stderr).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                // eprintln! is unconditional to the terminal running `tauri dev`;
                // log::info! also routes it through the app log targets/file.
                eprintln!("[sidecar] {line}");
                log::info!("[sidecar] {line}");
            }
        });
    }

    // The sidecar reads the config frame before emitting READY, so send it first.
    let cfg = format!("{}\t{}", rate, language);
    write_frame(&mut stdin, cfg.as_bytes()).await?;

    let ready = tokio::time::timeout(Duration::from_secs(300), async {
        loop {
            let mut line = String::new();
            let n = stdout.read_line(&mut line).await.map_err(|e| format!("read READY: {e}"))?;
            if n == 0 {
                return Err("stream sidecar exited before READY".to_string());
            }
            let line = line.trim();
            // CoreML/E5RT sometimes prints diagnostics to stdout without a trailing
            // newline, gluing itself to our READY marker — accept a suffix match.
            if line == "READY" || line.ends_with("READY") {
                return Ok(());
            }
            if let Some(msg) = line.strip_prefix("FATAL\t") {
                return Err(format!("stream sidecar fatal: {msg}"));
            }
        }
    })
    .await;

    match ready {
        Ok(Ok(())) => Ok((StreamSidecar { child, stdin: Some(stdin) }, stdout)),
        Ok(Err(e)) => Err(e),
        Err(_) => {
            let _ = child.start_kill();
            Err("stream sidecar did not become ready within 300s".into())
        }
    }
}

#[tauri::command]
pub async fn transcribe_audio_fluid(
    app: AppHandle,
    audio_data: Vec<u8>,
    language: Option<String>,
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

    let lang = language.as_deref().unwrap_or("");
    let path_str = path.to_string_lossy().to_string();
    log::debug!("transcribe_audio_fluid: wav={}, size={} bytes, lang={}", path_str, audio_data.len(), if lang.is_empty() { "auto" } else { lang });
    let result = {
        let mut guard = slot().lock().await;
        if guard.is_none() {
            log::debug!("no sidecar in slot, spawning...");
            *guard = Some(spawn_sidecar(&app).await?);
        }
        match request(guard.as_mut().unwrap(), &path_str, lang).await {
            Ok(t) => {
                log::debug!("sidecar responded OK ({} chars)", t.len());
                Ok(t)
            }
            Err(e) => {
                log::error!("sidecar request failed: {e}, respawning...");
                *guard = Some(spawn_sidecar(&app).await?);
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

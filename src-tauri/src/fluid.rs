use std::path::{Path, PathBuf};
use std::sync::{Mutex as StdMutex, OnceLock};
use std::time::Duration;

use log;
use std::process::Stdio;
use tauri::async_runtime::JoinHandle;
use tauri::{AppHandle, Emitter, Manager};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, Command};
use tokio::sync::Mutex;

const REQUEST_TIMEOUT_SECS: u64 = 30;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum AsrModel {
    Parakeet,
    Qwen3,
}

impl AsrModel {
    fn parse(value: Option<&str>) -> Self {
        match value {
            Some("qwen3-asr") | Some("qwen3") => Self::Qwen3,
            _ => Self::Parakeet,
        }
    }

    fn arg(self) -> Option<&'static str> {
        match self {
            Self::Parakeet => None,
            Self::Qwen3 => Some("--model=qwen3"),
        }
    }

    fn id(self) -> &'static str {
        match self {
            Self::Parakeet => "parakeet-v3",
            Self::Qwen3 => "qwen3-asr",
        }
    }
}

#[derive(Clone, serde::Serialize)]
pub struct ModelProgress {
    fraction: f64,
    percent: u8,
    phase: String,
    model: String,
}

#[derive(Clone, serde::Serialize)]
pub struct ModelSetupError {
    model: String,
    error: String,
}

#[derive(Clone, serde::Serialize)]
pub struct ModelSetupStatus {
    running: bool,
    model: Option<String>,
    progress: Option<ModelProgress>,
    error: Option<String>,
}

#[derive(Default)]
struct SetupState {
    running_model: Option<AsrModel>,
    task: Option<JoinHandle<()>>,
    progress: Option<ModelProgress>,
    error: Option<String>,
}

fn parse_sidecar_progress(line: &str) -> Option<ModelProgress> {
    let mut parts = line.splitn(3, '\t');
    if parts.next()? != "PROGRESS" {
        return None;
    }
    let fraction = parts.next()?.parse::<f64>().ok()?.clamp(0.0, 1.0);
    let phase = parts.next().unwrap_or("downloading").to_string();
    let percent = ((fraction * 100.0).round().clamp(0.0, 100.0) as u8).min(99);

    Some(ModelProgress {
        fraction,
        percent,
        phase,
        model: String::new(),
    })
}

fn emit_progress(app: &AppHandle, model: AsrModel, mut progress: ModelProgress) {
    progress.model = model.id().into();
    if let Ok(mut state) = setup_state().lock() {
        state.progress = Some(progress.clone());
        state.error = None;
    }
    let _ = app.emit("fluid-model-progress", progress);
}

fn emit_setup_error(app: &AppHandle, model: AsrModel, error: String) {
    if let Ok(mut state) = setup_state().lock() {
        state.running_model = None;
        state.task = None;
        state.error = Some(error.clone());
    }
    let _ = app.emit(
        "fluid-model-error",
        ModelSetupError {
            model: model.id().into(),
            error,
        },
    );
}

pub(crate) struct Sidecar {
    model: AsrModel,
    child: Child,
    stdin: tokio::process::ChildStdin,
    stdout: BufReader<tokio::process::ChildStdout>,
}

impl Drop for Sidecar {
    fn drop(&mut self) {
        log::debug!("sidecar dropped, killing child");
        let _ = self.child.start_kill();
        let _ = self.child.try_wait();
    }
}

pub(crate) fn slot() -> &'static Mutex<Option<Sidecar>> {
    static S: OnceLock<Mutex<Option<Sidecar>>> = OnceLock::new();
    S.get_or_init(|| Mutex::new(None))
}

fn setup_state() -> &'static StdMutex<SetupState> {
    static S: OnceLock<StdMutex<SetupState>> = OnceLock::new();
    S.get_or_init(|| StdMutex::new(SetupState::default()))
}

fn binary_path(app: &AppHandle) -> PathBuf {
    #[cfg(debug_assertions)]
    if let Ok(p) = std::env::var("FLUID_SIDECAR_BIN") {
        let pb = PathBuf::from(&p);
        if std::fs::metadata(&pb)
            .map(|m| m.len() > 1000)
            .unwrap_or(false)
        {
            return pb;
        }
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            let bundled = dir.join("fluidasr");
            if std::fs::metadata(&bundled)
                .map(|m| m.len() > 1000)
                .unwrap_or(false)
            {
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

async fn spawn_sidecar(app: &AppHandle, model: AsrModel) -> Result<Sidecar, String> {
    let bin = binary_path(app);
    log::debug!("spawning sidecar: {}", bin.display());
    let mut cmd = Command::new(&bin);
    if let Some(arg) = model.arg() {
        cmd.arg(arg);
    }
    cmd.kill_on_drop(true);
    cmd.stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let mut child = cmd
        .spawn()
        .map_err(|e| format!("spawn {}: {}", bin.display(), e))?;
    let stdin = child.stdin.take().ok_or("no stdin")?;
    let mut stdout = BufReader::new(child.stdout.take().ok_or("no stdout")?);

    if let Some(stderr) = child.stderr.take() {
        tauri::async_runtime::spawn(async move {
            let mut lines = BufReader::new(stderr).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                eprintln!("[sidecar] {line}");
                log::info!("[sidecar] {line}");
            }
        });
    }

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
            if line == "READY" || line.ends_with("READY") {
                emit_progress(
                    app,
                    model,
                    ModelProgress {
                        fraction: 1.0,
                        percent: 100,
                        phase: "ready".into(),
                        model: String::new(),
                    },
                );
                return Ok(());
            }
            if let Some(progress) = parse_sidecar_progress(line) {
                emit_progress(app, model, progress);
                continue;
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
                model,
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
            let _ = child.try_wait();
            Err("sidecar did not become ready within 300s".into())
        }
    }
}

async fn run_download_sidecar(app: &AppHandle, model: AsrModel) -> Result<(), String> {
    let bin = binary_path(app);
    log::debug!("spawning download sidecar: {}", bin.display());
    let mut cmd = Command::new(&bin);
    cmd.arg("--download-only");
    if let Some(arg) = model.arg() {
        cmd.arg(arg);
    }
    cmd.kill_on_drop(true);
    cmd.stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let mut child = cmd
        .spawn()
        .map_err(|e| format!("spawn {}: {}", bin.display(), e))?;
    let mut stdout = BufReader::new(child.stdout.take().ok_or("no stdout")?);

    if let Some(stderr) = child.stderr.take() {
        tauri::async_runtime::spawn(async move {
            let mut lines = BufReader::new(stderr).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                eprintln!("[sidecar] {line}");
                log::info!("[sidecar] {line}");
            }
        });
    }

    let ready = tokio::time::timeout(Duration::from_secs(3600), async {
        loop {
            let mut line = String::new();
            let n = stdout
                .read_line(&mut line)
                .await
                .map_err(|e| format!("read download READY: {}", e))?;
            if n == 0 {
                return Err("sidecar exited before download completed".into());
            }
            let line = line.trim();
            if line == "READY" || line.ends_with("READY") {
                emit_progress(
                    app,
                    model,
                    ModelProgress {
                        fraction: 1.0,
                        percent: 100,
                        phase: "downloaded".into(),
                        model: String::new(),
                    },
                );
                return Ok(());
            }
            if let Some(progress) = parse_sidecar_progress(line) {
                emit_progress(app, model, progress);
                continue;
            }
            if let Some(msg) = line.strip_prefix("FATAL\t") {
                return Err(format!("sidecar fatal: {}", msg));
            }
        }
    })
    .await;

    match ready {
        Ok(Ok(())) => Ok(()),
        Ok(Err(e)) => Err(e),
        Err(_) => {
            let _ = child.start_kill();
            let _ = child.try_wait();
            Err("sidecar did not complete download within 3600s".into())
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
    setup_fluid_model(app, None).await
}

#[tauri::command]
pub async fn setup_fluid_model(app: AppHandle, model: Option<String>) -> Result<bool, String> {
    if !binary_present(&app) {
        return Err("Parakeet (Core ML) sidecar binary not installed.".into());
    }
    let requested_model = AsrModel::parse(model.as_deref());
    {
        let guard = slot().lock().await;
        if guard
            .as_ref()
            .map(|sc| sc.model == requested_model)
            .unwrap_or(false)
        {
            emit_progress(
                &app,
                requested_model,
                ModelProgress {
                    fraction: 1.0,
                    percent: 100,
                    phase: "ready".into(),
                    model: String::new(),
                },
            );
            return Ok(true);
        }
    }
    {
        let mut state = setup_state()
            .lock()
            .map_err(|_| "setup state unavailable".to_string())?;
        if state.running_model == Some(requested_model) {
            return Ok(true);
        }
        if let Some(task) = state.task.take() {
            task.abort();
        }
        state.running_model = Some(requested_model);
        state.error = None;
        state.progress = Some(ModelProgress {
            fraction: 0.0,
            percent: 0,
            phase: "starting".into(),
            model: requested_model.id().into(),
        });
    }

    let app_for_task = app.clone();
    let task = tauri::async_runtime::spawn(async move {
        let result = spawn_sidecar(&app_for_task, requested_model).await;
        match result {
            Ok(sidecar) => {
                let mut guard = slot().lock().await;
                *guard = Some(sidecar);
                if let Ok(mut state) = setup_state().lock() {
                    state.running_model = None;
                    state.task = None;
                    state.error = None;
                }
            }
            Err(error) => {
                emit_setup_error(&app_for_task, requested_model, error);
            }
        }
    });
    if let Ok(mut state) = setup_state().lock() {
        state.task = Some(task);
    }

    Ok(true)
}

#[tauri::command]
pub async fn download_model(app: AppHandle, model: Option<String>) -> Result<bool, String> {
    if !binary_present(&app) {
        return Err("ASR sidecar binary not installed.".into());
    }
    let requested_model = AsrModel::parse(model.as_deref());
    if let Some(dir) = model_cache_dir(requested_model) {
        if model_cache_complete(requested_model, &dir) {
            emit_progress(
                &app,
                requested_model,
                ModelProgress {
                    fraction: 1.0,
                    percent: 100,
                    phase: "downloaded".into(),
                    model: String::new(),
                },
            );
            return Ok(true);
        }
    }

    {
        let mut state = setup_state()
            .lock()
            .map_err(|_| "setup state unavailable".to_string())?;
        if state.running_model == Some(requested_model) {
            return Ok(true);
        }
        if let Some(task) = state.task.take() {
            task.abort();
        }
        state.running_model = Some(requested_model);
        state.error = None;
        state.progress = Some(ModelProgress {
            fraction: 0.0,
            percent: 0,
            phase: "starting".into(),
            model: requested_model.id().into(),
        });
    }

    let app_for_task = app.clone();
    let task = tauri::async_runtime::spawn(async move {
        let result = run_download_sidecar(&app_for_task, requested_model).await;
        match result {
            Ok(()) => {
                if let Ok(mut state) = setup_state().lock() {
                    state.running_model = None;
                    state.task = None;
                    state.error = None;
                }
            }
            Err(error) => {
                emit_setup_error(&app_for_task, requested_model, error);
            }
        }
    });
    if let Ok(mut state) = setup_state().lock() {
        state.task = Some(task);
    }

    Ok(true)
}

#[tauri::command]
pub async fn cancel_model_setup(model: Option<String>) -> Result<bool, String> {
    let requested_model = model.as_deref().map(|value| AsrModel::parse(Some(value)));
    let mut state = setup_state()
        .lock()
        .map_err(|_| "setup state unavailable".to_string())?;
    let should_cancel = state
        .running_model
        .map(|running| {
            requested_model
                .map(|requested| requested == running)
                .unwrap_or(true)
        })
        .unwrap_or(false);
    if !should_cancel {
        return Ok(false);
    }
    if let Some(task) = state.task.take() {
        task.abort();
    }
    state.running_model = None;
    state.progress = None;
    state.error = None;
    Ok(true)
}

#[tauri::command]
pub async fn model_setup_status(model: Option<String>) -> Result<ModelSetupStatus, String> {
    let requested_model = model.as_deref().map(|value| AsrModel::parse(Some(value)));
    let state = setup_state()
        .lock()
        .map_err(|_| "setup state unavailable".to_string())?;
    let model_matches = |progress: &ModelProgress| {
        requested_model
            .map(|requested| progress.model == requested.id())
            .unwrap_or(true)
    };
    let progress = state
        .progress
        .as_ref()
        .filter(|progress| model_matches(progress))
        .cloned();
    let running_model = state.running_model.filter(|running| {
        requested_model
            .map(|requested| requested == *running)
            .unwrap_or(true)
    });

    Ok(ModelSetupStatus {
        running: running_model.is_some(),
        model: running_model.map(|model| model.id().into()),
        progress,
        error: state.error.clone(),
    })
}

#[tauri::command]
pub async fn unload_fluid() -> Result<(), String> {
    let mut guard = slot().lock().await;
    *guard = None;
    Ok(())
}

#[tauri::command]
pub async fn fluid_loaded(model: Option<String>) -> Result<bool, String> {
    let requested_model = AsrModel::parse(model.as_deref());
    let guard = slot().lock().await;
    Ok(guard
        .as_ref()
        .map(|sc| sc.model == requested_model)
        .unwrap_or(false))
}

#[cfg(target_os = "macos")]
mod screen_access {
    #[link(name = "CoreGraphics", kind = "framework")]
    extern "C" {
        fn CGPreflightScreenCaptureAccess() -> bool;
        fn CGRequestScreenCaptureAccess() -> bool;
    }
    pub fn preflight() -> bool {
        unsafe { CGPreflightScreenCaptureAccess() }
    }
    pub fn request() -> bool {
        unsafe { CGRequestScreenCaptureAccess() }
    }
}

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

pub struct StreamSidecar {
    child: Child,
    stdin: Option<tokio::process::ChildStdin>,
}

impl Drop for StreamSidecar {
    fn drop(&mut self) {
        let _ = self.child.start_kill();
        let _ = self.child.try_wait();
    }
}

impl StreamSidecar {
    pub async fn finish(mut self) {
        self.stdin = None;
        match tokio::time::timeout(Duration::from_secs(5), self.child.wait()).await {
            Ok(Ok(status)) => log::debug!("stream sidecar exited: {status}"),
            Ok(Err(e)) => log::warn!("stream sidecar wait error: {e}"),
            Err(_) => {
                log::warn!("stream sidecar finish timeout, killing");
                let _ = self.child.start_kill();
                let _ = self.child.try_wait();
            }
        }
    }
}

pub async fn write_frame(
    stdin: &mut tokio::process::ChildStdin,
    payload: &[u8],
) -> Result<(), String> {
    let len = (payload.len() as u32).to_le_bytes();
    stdin
        .write_all(&len)
        .await
        .map_err(|e| format!("frame len: {e}"))?;
    if !payload.is_empty() {
        stdin
            .write_all(payload)
            .await
            .map_err(|e| format!("frame body: {e}"))?;
    }
    stdin.flush().await.map_err(|e| format!("frame flush: {e}"))
}

pub async fn spawn_stream_sidecar(
    app: &AppHandle,
    rate: u32,
    language: &str,
    source: &str,
    model: Option<&str>,
) -> Result<(StreamSidecar, BufReader<tokio::process::ChildStdout>), String> {
    let bin = binary_path(app);
    log::debug!(
        "spawning stream sidecar: {} --stream --source {}",
        bin.display(),
        source
    );
    let requested_model = AsrModel::parse(model);
    let mut cmd = Command::new(&bin);
    cmd.arg("--stream").arg("--source").arg(source);
    if let Some(arg) = requested_model.arg() {
        cmd.arg(arg);
    }
    cmd.stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let mut child = cmd
        .spawn()
        .map_err(|e| format!("spawn {}: {}", bin.display(), e))?;
    let mut stdin = child.stdin.take().ok_or("no stdin")?;
    let mut stdout = BufReader::new(child.stdout.take().ok_or("no stdout")?);

    if let Some(stderr) = child.stderr.take() {
        tauri::async_runtime::spawn(async move {
            let mut lines = BufReader::new(stderr).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                eprintln!("[sidecar] {line}");
                log::info!("[sidecar] {line}");
            }
        });
    }

    let cfg = format!("{}\t{}", rate, language);
    write_frame(&mut stdin, cfg.as_bytes()).await?;

    let ready = tokio::time::timeout(Duration::from_secs(300), async {
        loop {
            let mut line = String::new();
            let n = stdout
                .read_line(&mut line)
                .await
                .map_err(|e| format!("read READY: {e}"))?;
            if n == 0 {
                return Err("stream sidecar exited before READY".to_string());
            }
            let line = line.trim();
            if line == "READY" || line.ends_with("READY") {
                emit_progress(
                    app,
                    requested_model,
                    ModelProgress {
                        fraction: 1.0,
                        percent: 100,
                        phase: "ready".into(),
                        model: String::new(),
                    },
                );
                return Ok(());
            }
            if let Some(progress) = parse_sidecar_progress(line) {
                emit_progress(app, requested_model, progress);
                continue;
            }
            if let Some(msg) = line.strip_prefix("FATAL\t") {
                return Err(format!("stream sidecar fatal: {msg}"));
            }
        }
    })
    .await;

    match ready {
        Ok(Ok(())) => Ok((
            StreamSidecar {
                child,
                stdin: Some(stdin),
            },
            stdout,
        )),
        Ok(Err(e)) => Err(e),
        Err(_) => {
            let _ = child.start_kill();
            let _ = child.try_wait();
            Err("stream sidecar did not become ready within 300s".into())
        }
    }
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
    let requested_model = AsrModel::parse(model.as_deref());
    let dir = app
        .path()
        .app_data_dir()
        .unwrap_or_else(|_| std::env::temp_dir().join("meeting-notes"));
    tokio::fs::create_dir_all(&dir)
        .await
        .map_err(|e| format!("create dir: {}", e))?;

    let tmp_dir = tempfile::tempdir_in(&dir).map_err(|e| format!("temp dir: {}", e))?;
    let path = tmp_dir.path().join("audio.wav");
    tokio::fs::write(&path, &audio_data)
        .await
        .map_err(|e| format!("write wav: {}", e))?;

    let lang = language.as_deref().unwrap_or("");
    let path_str = path.to_string_lossy().to_string();
    log::debug!(
        "transcribe_audio_fluid: wav={}, size={} bytes, lang={}",
        path_str,
        audio_data.len(),
        if lang.is_empty() { "auto" } else { lang }
    );

    let result = {
        let mut guard = slot().lock().await;
        let needs_spawn = guard
            .as_ref()
            .map(|sc| sc.model != requested_model)
            .unwrap_or(true);
        if needs_spawn {
            log::debug!("no sidecar in slot, spawning...");
            *guard = Some(spawn_sidecar(&app, requested_model).await?);
        }
        match request(
            guard.as_mut().expect("guard is Some after spawn/check"),
            &path_str,
            lang,
        )
        .await
        {
            Ok(t) => {
                log::debug!("sidecar responded OK ({} chars)", t.len());
                Ok(t)
            }
            Err(e) => {
                log::error!("sidecar request failed: {e}, respawning...");
                *guard = Some(spawn_sidecar(&app, requested_model).await?);
                log::debug!("sidecar respawned, retrying request...");
                request(
                    guard.as_mut().expect("guard is Some after respawn"),
                    &path_str,
                    lang,
                )
                .await
            }
        }
    };

    drop(tmp_dir);
    result
}

// FluidAudio caches its CoreML models (Parakeet encoder/decoder, Silero VAD)
// under ~/Library/Application Support/FluidAudio/Models. They download on first
// use and are not part of the app bundle, so this is the on-disk footprint a
// user can reclaim.
fn fluid_models_dir() -> Option<PathBuf> {
    std::env::var_os("HOME")
        .map(|home| PathBuf::from(home).join("Library/Application Support/FluidAudio/Models"))
}

fn model_cache_dir(model: AsrModel) -> Option<PathBuf> {
    let root = fluid_models_dir()?;
    Some(match model {
        AsrModel::Parakeet => root.join("parakeet-tdt-0.6b-v3"),
        AsrModel::Qwen3 => root.join("qwen3-asr-0.6b/int8"),
    })
}

fn dir_size(path: &Path) -> u64 {
    let mut total = 0;
    if let Ok(entries) = std::fs::read_dir(path) {
        for entry in entries.flatten() {
            match entry.metadata() {
                Ok(meta) if meta.is_dir() => total += dir_size(&entry.path()),
                Ok(meta) => total += meta.len(),
                Err(_) => {}
            }
        }
    }
    total
}

fn model_cache_complete(model: AsrModel, dir: &Path) -> bool {
    if !dir.exists() {
        return false;
    }
    match model {
        AsrModel::Parakeet => dir_size(dir) > 0,
        AsrModel::Qwen3 => [
            "qwen3_asr_audio_encoder_v2.mlmodelc",
            "qwen3_asr_decoder_stateful.mlmodelc",
            "qwen3_asr_embeddings.bin",
            "vocab.json",
        ]
        .iter()
        .all(|file| dir.join(file).exists()),
    }
}

#[derive(serde::Serialize)]
pub struct ModelStorage {
    present: bool,
    bytes: u64,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_sidecar_progress_lines() {
        let progress = parse_sidecar_progress("PROGRESS\t0.375\tdownloading").unwrap();

        assert_eq!(progress.percent, 38);
        assert!((progress.fraction - 0.375).abs() < f64::EPSILON);
        assert_eq!(progress.phase, "downloading");
    }

    #[test]
    fn parses_qwen3_model_ids() {
        assert_eq!(AsrModel::parse(Some("qwen3-asr")), AsrModel::Qwen3);
        assert_eq!(AsrModel::parse(Some("qwen3-asr")).id(), "qwen3-asr");
        assert_eq!(AsrModel::parse(Some("parakeet-v3")), AsrModel::Parakeet);
        assert_eq!(AsrModel::parse(None), AsrModel::Parakeet);
    }
}

#[tauri::command]
pub async fn model_storage_info(model: Option<String>) -> Result<ModelStorage, String> {
    let requested_model = AsrModel::parse(model.as_deref());
    let dir = model_cache_dir(requested_model).ok_or("no home directory")?;
    if !model_cache_complete(requested_model, &dir) {
        return Ok(ModelStorage {
            present: false,
            bytes: 0,
        });
    }
    let bytes = dir_size(&dir);
    Ok(ModelStorage {
        present: bytes > 0,
        bytes,
    })
}

// Delete the downloaded models to reclaim disk. Unloads the in-memory sidecar
// first so it isn't holding the model, then removes the cache directory. The
// next recording/transcription re-downloads automatically.
#[tauri::command]
pub async fn delete_model(model: Option<String>) -> Result<ModelStorage, String> {
    {
        let mut guard = slot().lock().await;
        *guard = None; // Drop kills the batch sidecar child
    }
    let dir = model_cache_dir(AsrModel::parse(model.as_deref())).ok_or("no home directory")?;
    if dir.exists() {
        std::fs::remove_dir_all(&dir).map_err(|e| format!("delete models: {e}"))?;
    }
    Ok(ModelStorage {
        present: false,
        bytes: 0,
    })
}

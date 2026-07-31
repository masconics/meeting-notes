use std::path::PathBuf;
use std::process::Stdio;
use std::sync::OnceLock;
use std::time::Duration;

use tauri::{AppHandle, Manager};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, Command};
use tokio::sync::Mutex;

const READY_TIMEOUT_SECS: u64 = 30;
const REQUEST_TIMEOUT_SECS: u64 = 15;

pub(crate) struct EmbedSidecar {
    child: Child,
    stdin: tokio::process::ChildStdin,
    stdout: BufReader<tokio::process::ChildStdout>,
}

impl Drop for EmbedSidecar {
    fn drop(&mut self) {
        let _ = self.child.start_kill();
        let _ = self.child.try_wait();
    }
}

pub fn slot() -> &'static Mutex<Option<EmbedSidecar>> {
    static S: OnceLock<Mutex<Option<EmbedSidecar>>> = OnceLock::new();
    S.get_or_init(|| Mutex::new(None))
}

fn binary_path(app: &AppHandle) -> PathBuf {
    #[cfg(debug_assertions)]
    if let Ok(p) = std::env::var("FLUID_SIDECAR_BIN") {
        let pb = PathBuf::from(&p);
        if std::fs::metadata(&pb).map(|m| m.len() > 1000).unwrap_or(false) {
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

async fn spawn_embed_sidecar(app: &AppHandle) -> Result<EmbedSidecar, String> {
    let bin = binary_path(app);
    log::debug!("spawning embed sidecar: {}", bin.display());

    let mut cmd = Command::new(&bin);
    cmd.arg("--embed");
    cmd.kill_on_drop(true);
    cmd.stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("spawn embed sidecar {}: {}", bin.display(), e))?;

    let stdin = child.stdin.take().ok_or("no stdin")?;
    let mut stdout = BufReader::new(child.stdout.take().ok_or("no stdout")?);

    if let Some(stderr) = child.stderr.take() {
        tauri::async_runtime::spawn(async move {
            let mut lines = BufReader::new(stderr).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                eprintln!("[embed-sidecar] {line}");
            }
        });
    }

    let ready = tokio::time::timeout(Duration::from_secs(READY_TIMEOUT_SECS), async {
        loop {
            let mut line = String::new();
            let n = stdout
                .read_line(&mut line)
                .await
                .map_err(|e| format!("read READY: {e}"))?;
            if n == 0 {
                return Err("embed sidecar exited before READY".to_string());
            }
            let trimmed = line.trim();
            if trimmed == "READY" || trimmed.ends_with("READY") {
                return Ok(());
            }
            if let Some(msg) = trimmed.strip_prefix("FATAL\t") {
                return Err(format!("embed sidecar fatal: {msg}"));
            }
        }
    })
    .await;

    match ready {
        Ok(Ok(())) => {
            log::debug!("embed sidecar ready");
            Ok(EmbedSidecar { child, stdin, stdout })
        }
        Ok(Err(e)) => Err(e),
        Err(_) => {
            let _ = child.start_kill();
            let _ = child.try_wait();
            Err("embed sidecar did not become ready within 30s".into())
        }
    }
}

async fn read_vector(sc: &mut EmbedSidecar) -> Result<Vec<f64>, String> {
    let result = tokio::time::timeout(Duration::from_secs(REQUEST_TIMEOUT_SECS), async {
        loop {
            let mut line = String::new();
            let n = sc
                .stdout
                .read_line(&mut line)
                .await
                .map_err(|e| format!("read vector: {e}"))?;
            if n == 0 {
                return Err("embed sidecar closed".to_string());
            }
            let trimmed = line.trim();
            if trimmed.is_empty() {
                continue;
            }
            let vec: Vec<f64> =
                serde_json::from_str(trimmed).map_err(|e| format!("parse vector JSON: {e}"))?;
            return Ok(vec);
        }
    })
    .await;

    match result {
        Ok(r) => r,
        Err(_) => Err("embed sidecar request timed out".into()),
    }
}

async fn embed_via_sidecar(
    sc: &mut EmbedSidecar,
    texts: &[String],
) -> Result<Vec<Vec<f64>>, String> {
    for text in texts {
        sc.stdin
            .write_all(format!("{text}\n").as_bytes())
            .await
            .map_err(|e| format!("write embed: {e}"))?;
    }
    sc.stdin
        .flush()
        .await
        .map_err(|e| format!("flush embed: {e}"))?;

    let mut results = Vec::with_capacity(texts.len());
    for _ in texts {
        results.push(read_vector(sc).await?);
    }
    Ok(results)
}

#[tauri::command]
pub async fn embed_text(app: AppHandle, text: String) -> Result<Vec<f64>, String> {
    let mut guard = slot().lock().await;
    if guard.is_none() {
        *guard = Some(spawn_embed_sidecar(&app).await?);
    }

    let result = embed_via_sidecar(guard.as_mut().unwrap(), &[text]).await;

    if result.is_err() {
        *guard = None;
    }

    result.and_then(|mut v| {
        v.pop()
            .ok_or_else(|| "embed returned empty result".to_string())
    })
}

#[tauri::command]
pub async fn embed_batch(app: AppHandle, texts: Vec<String>) -> Result<Vec<Vec<f64>>, String> {
    if texts.is_empty() {
        return Ok(vec![]);
    }

    let mut guard = slot().lock().await;
    if guard.is_none() {
        *guard = Some(spawn_embed_sidecar(&app).await?);
    }

    let result = embed_via_sidecar(guard.as_mut().unwrap(), &texts).await;

    if result.is_err() {
        *guard = None;
    }

    result
}

#[tauri::command]
pub async fn unload_embed() -> Result<(), String> {
    let mut guard = slot().lock().await;
    *guard = None;
    Ok(())
}

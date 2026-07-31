//! Persist a JSON snapshot of meetings for the local MCP server.

use std::fs;
use std::path::PathBuf;

use tauri::Manager;

fn snapshot_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("app data dir: {e}"))?;
    fs::create_dir_all(&dir).map_err(|e| format!("create app data dir: {e}"))?;
    Ok(dir.join("meetings-mcp-snapshot.json"))
}

#[tauri::command]
pub fn write_mcp_snapshot(
    app: tauri::AppHandle,
    snapshot: serde_json::Value,
) -> Result<String, String> {
    let path = snapshot_path(&app)?;
    let body = serde_json::to_string_pretty(&snapshot).map_err(|e| e.to_string())?;
    fs::write(&path, body).map_err(|e| format!("write snapshot: {e}"))?;
    Ok(path.display().to_string())
}

#[tauri::command]
pub fn mcp_snapshot_path(app: tauri::AppHandle) -> Result<String, String> {
    Ok(snapshot_path(&app)?.display().to_string())
}

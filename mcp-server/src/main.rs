//! Minimal stdio MCP server for Myna Notes.
//!
//! Reads `meetings-mcp-snapshot.json` written by the app (gate: Settings → MCP).
//! Point Cursor/Claude at this binary:
//!
//! ```json
//! {
//!   "mcpServers": {
//!     "meeting-notes": {
//!       "command": "/absolute/path/to/meeting-notes-mcp",
//!       "args": [],
//!       "env": {
//!         "MEETING_NOTES_SNAPSHOT": "/Users/you/Library/Application Support/com.meeting-notes.app/meetings-mcp-snapshot.json"
//!       }
//!     }
//!   }
//! }
//! ```

use serde_json::{json, Value};
use std::env;
use std::fs;
use std::io::{self, BufRead, Write};
use std::path::PathBuf;

fn snapshot_path() -> PathBuf {
    if let Ok(p) = env::var("MEETING_NOTES_SNAPSHOT") {
        return PathBuf::from(p);
    }
    // Common Tauri bundle id fallbacks
    let home = env::var("HOME").unwrap_or_default();
    let candidates = [
        format!("{home}/Library/Application Support/com.notes.desktop/meetings-mcp-snapshot.json"),
        format!("{home}/Library/Application Support/com.meeting-notes.app/meetings-mcp-snapshot.json"),
        format!("{home}/Library/Application Support/meeting-notes/meetings-mcp-snapshot.json"),
        format!("{home}/Library/Application Support/com.tauri.dev/meetings-mcp-snapshot.json"),
    ];
    for c in &candidates {
        let p = PathBuf::from(c);
        if p.exists() {
            return p;
        }
    }
    PathBuf::from(candidates[0].clone())
}

fn load_snapshot() -> Result<Value, String> {
    let path = snapshot_path();
    let raw = fs::read_to_string(&path)
        .map_err(|e| format!("Cannot read snapshot at {}: {e}", path.display()))?;
    serde_json::from_str(&raw).map_err(|e| format!("Invalid snapshot JSON: {e}"))
}

fn tool_defs() -> Value {
    json!([
        {
            "name": "list_meetings",
            "description": "List saved meetings (id, title, date, duration, folders).",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "limit": { "type": "number", "description": "Max meetings to return (default 50)" }
                }
            }
        },
        {
            "name": "get_meeting",
            "description": "Get one meeting by id, including notes and brief.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "id": { "type": "string" }
                },
                "required": ["id"]
            }
        },
        {
            "name": "search_meetings",
            "description": "Search meetings by title/notes/transcript preview text.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "query": { "type": "string" },
                    "limit": { "type": "number" }
                },
                "required": ["query"]
            }
        },
        {
            "name": "list_folders",
            "description": "List folders and their meeting ids.",
            "inputSchema": { "type": "object", "properties": {} }
        },
        {
            "name": "list_open_actions",
            "description": "List open action items from the knowledge graph snapshot.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "assignee": { "type": "string" },
                    "limit": { "type": "number" }
                }
            }
        },
        {
            "name": "get_brief",
            "description": "Get the saved brief for a meeting id, if any.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "id": { "type": "string" }
                },
                "required": ["id"]
            }
        }
    ])
}

fn text_result(v: Value) -> Value {
    json!({
        "content": [{ "type": "text", "text": serde_json::to_string_pretty(&v).unwrap_or_else(|_| "{}".into()) }]
    })
}

fn err_result(msg: String) -> Value {
    json!({
        "content": [{ "type": "text", "text": msg }],
        "isError": true
    })
}

fn call_tool(name: &str, args: &Value) -> Value {
    let snap = match load_snapshot() {
        Ok(s) => s,
        Err(e) => return err_result(e),
    };

    match name {
        "list_meetings" => {
            let limit = args.get("limit").and_then(|x| x.as_u64()).unwrap_or(50) as usize;
            let meetings = snap
                .get("meetings")
                .and_then(|m| m.as_array())
                .cloned()
                .unwrap_or_default();
            let slim: Vec<Value> = meetings
                .into_iter()
                .take(limit)
                .map(|m| {
                    json!({
                        "id": m.get("id"),
                        "title": m.get("title"),
                        "date": m.get("date"),
                        "duration": m.get("duration"),
                        "folderIds": m.get("folderIds"),
                        "attendees": m.get("attendees"),
                    })
                })
                .collect();
            text_result(json!(slim))
        }
        "get_meeting" => {
            let id = args.get("id").and_then(|x| x.as_str()).unwrap_or("");
            let meetings = snap.get("meetings").and_then(|m| m.as_array());
            let found = meetings.and_then(|arr| arr.iter().find(|m| m.get("id").and_then(|x| x.as_str()) == Some(id)));
            match found {
                Some(m) => text_result(m.clone()),
                None => err_result(format!("Meeting not found: {id}")),
            }
        }
        "search_meetings" => {
            let q = args
                .get("query")
                .and_then(|x| x.as_str())
                .unwrap_or("")
                .to_lowercase();
            let limit = args.get("limit").and_then(|x| x.as_u64()).unwrap_or(20) as usize;
            let meetings = snap
                .get("meetings")
                .and_then(|m| m.as_array())
                .cloned()
                .unwrap_or_default();
            let hits: Vec<Value> = meetings
                .into_iter()
                .filter(|m| {
                    let blob = format!(
                        "{} {} {} {}",
                        m.get("title").and_then(|x| x.as_str()).unwrap_or(""),
                        m.get("notes").and_then(|x| x.as_str()).unwrap_or(""),
                        m.get("enhancedNotes").and_then(|x| x.as_str()).unwrap_or(""),
                        m.get("transcriptPreview").and_then(|x| x.as_str()).unwrap_or(""),
                    )
                    .to_lowercase();
                    blob.contains(&q)
                })
                .take(limit)
                .collect();
            text_result(json!(hits))
        }
        "list_folders" => text_result(snap.get("folders").cloned().unwrap_or(json!([]))),
        "list_open_actions" => {
            let assignee = args
                .get("assignee")
                .and_then(|x| x.as_str())
                .map(|s| s.to_lowercase());
            let limit = args.get("limit").and_then(|x| x.as_u64()).unwrap_or(50) as usize;
            let actions = snap
                .get("openActions")
                .and_then(|a| a.as_array())
                .cloned()
                .unwrap_or_default();
            let filtered: Vec<Value> = actions
                .into_iter()
                .filter(|a| match &assignee {
                    None => true,
                    Some(name) => a
                        .get("assignee")
                        .and_then(|x| x.as_str())
                        .map(|s| s.to_lowercase().contains(name))
                        .unwrap_or(false),
                })
                .take(limit)
                .collect();
            text_result(json!(filtered))
        }
        "get_brief" => {
            let id = args.get("id").and_then(|x| x.as_str()).unwrap_or("");
            let meetings = snap.get("meetings").and_then(|m| m.as_array());
            let found = meetings.and_then(|arr| arr.iter().find(|m| m.get("id").and_then(|x| x.as_str()) == Some(id)));
            match found {
                Some(m) => text_result(json!({
                    "id": id,
                    "title": m.get("title"),
                    "brief": m.get("brief"),
                })),
                None => err_result(format!("Meeting not found: {id}")),
            }
        }
        _ => err_result(format!("Unknown tool: {name}")),
    }
}

fn handle(req: &Value) -> Option<Value> {
    let id = req.get("id").cloned();
    let method = req.get("method").and_then(|m| m.as_str()).unwrap_or("");

    let result = match method {
        "initialize" => json!({
            "protocolVersion": "2024-11-05",
            "capabilities": { "tools": {} },
            "serverInfo": { "name": "meeting-notes-mcp", "version": "0.1.0" }
        }),
        "notifications/initialized" | "initialized" => return None,
        "tools/list" => json!({ "tools": tool_defs() }),
        "tools/call" => {
            let params = req.get("params").cloned().unwrap_or(json!({}));
            let name = params.get("name").and_then(|n| n.as_str()).unwrap_or("");
            let args = params.get("arguments").cloned().unwrap_or(json!({}));
            call_tool(name, &args)
        }
        "ping" => json!({}),
        _ => {
            return Some(json!({
                "jsonrpc": "2.0",
                "id": id,
                "error": { "code": -32601, "message": format!("Method not found: {method}") }
            }))
        }
    };

    Some(json!({
        "jsonrpc": "2.0",
        "id": id,
        "result": result
    }))
}

fn main() {
    let stdin = io::stdin();
    let mut stdout = io::stdout();
    for line in stdin.lock().lines() {
        let Ok(line) = line else { break };
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        let req: Value = match serde_json::from_str(line) {
            Ok(v) => v,
            Err(e) => {
                let _ = writeln!(
                    stdout,
                    "{}",
                    json!({
                        "jsonrpc": "2.0",
                        "id": null,
                        "error": { "code": -32700, "message": format!("Parse error: {e}") }
                    })
                );
                let _ = stdout.flush();
                continue;
            }
        };
        if let Some(resp) = handle(&req) {
            let _ = writeln!(stdout, "{resp}");
            let _ = stdout.flush();
        }
    }
}

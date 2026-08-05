// Lightweight "are you on a call?" signal for smart-start prompts.
// Checks running process names for common meeting apps — no silent recording.

use std::process::Command;

const MEETING_APP_PATTERNS: &[&str] = &[
    "zoom.us",
    "Zoom",
    "zoom",
    "Microsoft Teams",
    "Teams",
    "MSTeams",
    "Slack",
    "Discord",
    "Webex",
    "Cisco Webex",
    "GoToMeeting",
    "BlueJeans",
    "FaceTime",
    "Google Chrome Helper", // Meet often runs in browser — weak signal
    "Arc",
    "Firefox",
    "Safari",
    "Microsoft Edge",
    "Gather",
    "Around",
    "Loom",
];

// Strong signals: if any of these match, definitely prompt.
const STRONG_PATTERNS: &[&str] = &[
    "zoom.us",
    "Zoom",
    "Microsoft Teams",
    "MSTeams",
    "Webex",
    "Cisco Webex",
    "GoToMeeting",
    "BlueJeans",
    "FaceTime",
    "Discord",
];

#[derive(serde::Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CallDetectResult {
    pub active: bool,
    pub apps: Vec<String>,
    pub strong: bool,
}

fn list_process_names() -> Result<String, String> {
    let output = Command::new("ps")
        .args(["-axo", "comm="])
        .output()
        .map_err(|e| format!("ps failed: {e}"))?;
    if !output.status.success() {
        return Err("ps exited non-zero".into());
    }
    String::from_utf8(output.stdout).map_err(|e| format!("utf8: {e}"))
}

#[tauri::command]
pub fn detect_call_apps() -> Result<CallDetectResult, String> {
    let blob = list_process_names()?;
    let lower = blob.to_lowercase();
    let mut apps: Vec<String> = Vec::new();
    let mut strong = false;

    for pat in MEETING_APP_PATTERNS {
        let p = pat.to_lowercase();
        if lower.contains(&p) {
            // Dedup display names
            if !apps.iter().any(|a| a.eq_ignore_ascii_case(pat)) {
                apps.push((*pat).to_string());
            }
        }
    }

    for pat in STRONG_PATTERNS {
        if lower.contains(&pat.to_lowercase()) {
            strong = true;
            break;
        }
    }

    // Browser-only is a weak signal — don't treat as active alone.
    let active = strong
        || apps.iter().any(|a| {
            let a = a.to_lowercase();
            !a.contains("chrome")
                && !a.contains("safari")
                && !a.contains("firefox")
                && !a.contains("arc")
                && !a.contains("edge")
        });

    // Prefer a short strong-app list for the toast.
    let apps = if strong {
        apps
            .into_iter()
            .filter(|a| {
                let l = a.to_lowercase();
                STRONG_PATTERNS
                    .iter()
                    .any(|p| l.contains(&p.to_lowercase()))
            })
            .collect()
    } else {
        apps
    };

    Ok(CallDetectResult {
        active,
        apps,
        strong,
    })
}

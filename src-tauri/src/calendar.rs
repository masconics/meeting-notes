//! macOS Calendar access via native EventKit (in-process).
//!
//! Uses the `eventkit` crate, which links EventKit through a small Swift bridge
//! compiled into the app binary. Permission prompts are attributed to Myna Notes
//! (not `osascript`), and titles/dates come through as real strings.

use serde::Serialize;

#[derive(Debug, Clone, Serialize, serde::Deserialize)]
pub struct CalendarAttendee {
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub email: Option<String>,
}

#[derive(Debug, Clone, Serialize, serde::Deserialize)]
pub struct CalendarEventDto {
    pub id: String,
    pub title: String,
    pub start: String,
    pub end: String,
    #[serde(default)]
    pub attendees: Vec<CalendarAttendee>,
    #[serde(default)]
    pub calendar: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub location: Option<String>,
}

#[cfg(target_os = "macos")]
mod macos {
    use super::{CalendarAttendee, CalendarEventDto};
    use eventkit::error::EKAuthorizationStatus;
    use eventkit::event_store::{EKEntityType, EKEventStore};
    use eventkit::participant::EKParticipant;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn status_label(status: EKAuthorizationStatus) -> &'static str {
        match status {
            EKAuthorizationStatus::NotDetermined => "notDetermined",
            EKAuthorizationStatus::Restricted => "restricted",
            EKAuthorizationStatus::Denied => "denied",
            EKAuthorizationStatus::FullAccess => "authorized",
            // Write-only cannot read events for "Up next".
            EKAuthorizationStatus::WriteOnly => "writeOnly",
            EKAuthorizationStatus::Unknown(_) => "unknown",
            _ => "unknown",
        }
    }

    pub fn calendar_status() -> String {
        status_label(EKEventStore::authorization_status(EKEntityType::Event)).into()
    }

    fn can_read(status: EKAuthorizationStatus) -> bool {
        matches!(status, EKAuthorizationStatus::FullAccess)
    }

    fn denied_message() -> String {
        "Calendar access denied. Enable it in System Settings → Privacy & Security → Calendars."
            .into()
    }

    pub fn request_access() -> Result<bool, String> {
        let status = EKEventStore::authorization_status(EKEntityType::Event);
        match status {
            EKAuthorizationStatus::FullAccess => return Ok(true),
            EKAuthorizationStatus::WriteOnly => {
                // Already decided; user must flip to Full Access in System Settings.
                return Err(
                    "Calendar has write-only access. Grant full access in System Settings → Privacy & Security → Calendars."
                        .into(),
                );
            }
            EKAuthorizationStatus::Denied | EKAuthorizationStatus::Restricted => {
                return Err(denied_message());
            }
            _ => {}
        }

        let store = EKEventStore::new().map_err(|e| e.to_string())?;
        let granted = store
            .request_full_access_to_events()
            .map_err(|e| e.to_string())?;
        if granted {
            Ok(true)
        } else {
            let after = EKEventStore::authorization_status(EKEntityType::Event);
            if can_read(after) {
                Ok(true)
            } else {
                Err(denied_message())
            }
        }
    }

    fn iso_now() -> String {
        // eventkit expects ISO-8601 strings (Swift ISO8601DateFormatter).
        let secs = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();
        // Format as UTC ISO8601; EventKit converts correctly for range queries.
        // Using chrono would be nicer but avoid an extra dependency.
        format_unix_iso(secs)
    }

    fn iso_hours_ahead(hours: u32) -> String {
        let secs = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs()
            .saturating_add(u64::from(hours.max(1)) * 3600);
        format_unix_iso(secs)
    }

    fn format_unix_iso(secs: u64) -> String {
        // Manual UTC ISO8601 without chrono.
        // Algorithm from civil_from_days (Howard Hinnant).
        let days = (secs / 86_400) as i64;
        let tod = secs % 86_400;
        let z = days + 719_468;
        let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
        let doe = (z - era * 146_097) as u64;
        let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146_096) / 365;
        let y = yoe as i64 + era * 400;
        let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
        let mp = (5 * doy + 2) / 153;
        let d = doy - (153 * mp + 2) / 5 + 1;
        let m = if mp < 10 { mp + 3 } else { mp - 9 };
        let y = if m <= 2 { y + 1 } else { y };
        let hh = tod / 3600;
        let mm = (tod % 3600) / 60;
        let ss = tod % 60;
        format!(
            "{y:04}-{m:02}-{d:02}T{hh:02}:{mm:02}:{ss:02}Z",
            y = y,
            m = m,
            d = d,
            hh = hh,
            mm = mm,
            ss = ss
        )
    }

    fn email_from_participant(p: &EKParticipant) -> Option<String> {
        let url = p.url.as_deref()?.trim();
        if url.is_empty() {
            return None;
        }
        let lower = url.to_ascii_lowercase();
        if lower.starts_with("mailto:") {
            let original = &url["mailto:".len()..];
            let email = original.split(['?', '#']).next().unwrap_or(original).trim();
            if email.is_empty() {
                None
            } else {
                Some(email.to_string())
            }
        } else if url.contains('@') && !url.contains(' ') {
            Some(url.to_string())
        } else {
            None
        }
    }

    fn map_attendee(p: EKParticipant) -> Option<CalendarAttendee> {
        let email = email_from_participant(&p);
        let name = p
            .name
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty());
        match (name, email) {
            (Some(name), email) => Some(CalendarAttendee { name, email }),
            (None, Some(email)) => Some(CalendarAttendee {
                name: email.clone(),
                email: Some(email),
            }),
            (None, None) => None,
        }
    }

    /// Normalize EventKit date strings to something JS `Date` always parses.
    /// The bridge returns ISO8601; keep as-is when already parseable.
    fn normalize_iso(s: &str) -> String {
        let t = s.trim();
        if t.is_empty() {
            return String::new();
        }
        t.to_string()
    }

    pub fn list_upcoming(hours_ahead: u32) -> Result<Vec<CalendarEventDto>, String> {
        let mut status = EKEventStore::authorization_status(EKEntityType::Event);

        if matches!(status, EKAuthorizationStatus::NotDetermined) {
            // First open of Up next — show the system prompt under our app identity.
            let _ = request_access()?;
            status = EKEventStore::authorization_status(EKEntityType::Event);
        }

        if matches!(
            status,
            EKAuthorizationStatus::Denied | EKAuthorizationStatus::Restricted
        ) {
            return Err(denied_message());
        }
        if matches!(status, EKAuthorizationStatus::WriteOnly) {
            return Err(
                "Calendar has write-only access. Grant full access in System Settings → Privacy & Security → Calendars."
                    .into(),
            );
        }
        if !can_read(status) {
            // Ask once more if still undetermined after a partial flow.
            request_access()?;
            status = EKEventStore::authorization_status(EKEntityType::Event);
            if !can_read(status) {
                return Err(denied_message());
            }
        }

        let store = EKEventStore::new().map_err(|e| e.to_string())?;
        // Keep EventKit sources fresh after network calendars sync.
        store.refresh_sources_if_necessary();

        let start = iso_now();
        let end = iso_hours_ahead(hours_ahead.max(1));
        let predicate = store.predicate_for_events(start, end, None);
        let mut events = store.events_matching(&predicate).map_err(|e| e.to_string())?;

        // Chronological for "Up next".
        events.sort_by(|a, b| a.start_date.cmp(&b.start_date));

        let now_iso = iso_now();
        let mut out = Vec::with_capacity(events.len());
        for (i, ev) in events.into_iter().enumerate() {
            let start = normalize_iso(&ev.start_date);
            let end = normalize_iso(&ev.end_date);

            // Skip meetings that have already ended. If there is no end time,
            // drop once the start has passed.
            let still_upcoming = if !end.is_empty() {
                end.as_str() > now_iso.as_str()
            } else if !start.is_empty() {
                start.as_str() > now_iso.as_str()
            } else {
                false
            };
            if !still_upcoming {
                continue;
            }

            let id = ev
                .identifier
                .filter(|s| !s.is_empty())
                .or_else(|| ev.calendar_item_identifier.clone())
                .unwrap_or_else(|| format!("event-{i}"));

            let title = {
                let t = ev.title.trim();
                if t.is_empty() {
                    "Untitled".into()
                } else {
                    t.to_string()
                }
            };

            let calendar = ev
                .calendar
                .as_ref()
                .map(|c| c.title.trim().to_string())
                .filter(|s| !s.is_empty())
                .unwrap_or_else(|| "Calendar".into());

            let location = ev
                .location
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty());

            let attendees = ev.attendees.into_iter().filter_map(map_attendee).collect();

            out.push(CalendarEventDto {
                id,
                title,
                start,
                end,
                attendees,
                calendar,
                location,
            });
        }

        // Soft cap for dashboard "Up next".
        if out.len() > 24 {
            out.truncate(24);
        }

        log::debug!(
            "calendar: listed {} upcoming events (next {}h)",
            out.len(),
            hours_ahead.max(1)
        );
        Ok(out)
    }
}

#[cfg(not(target_os = "macos"))]
mod macos {
    use super::CalendarEventDto;

    pub fn request_access() -> Result<bool, String> {
        Err("Calendar is only available on macOS".into())
    }
    pub fn list_upcoming(_hours_ahead: u32) -> Result<Vec<CalendarEventDto>, String> {
        Ok(vec![])
    }
    pub fn calendar_status() -> String {
        "unavailable".into()
    }
}

#[tauri::command]
pub fn request_calendar_access() -> Result<bool, String> {
    macos::request_access()
}

#[tauri::command]
pub fn list_upcoming_events(hours_ahead: Option<u32>) -> Result<Vec<CalendarEventDto>, String> {
    macos::list_upcoming(hours_ahead.unwrap_or(12))
}

#[tauri::command]
pub fn calendar_authorization_status() -> String {
    macos::calendar_status()
}

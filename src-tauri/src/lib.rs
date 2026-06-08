mod fluid;

use tauri::menu::{MenuBuilder, MenuItemBuilder};
use tauri::tray::TrayIconBuilder;
use tauri::{Listener, Manager};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .setup(|app| {
            let show = MenuItemBuilder::with_id("show", "Show Meeting Notes").build(app)?;
            let recording = MenuItemBuilder::with_id("recording", "Not Recording").build(app)?;
            let separator = tauri::menu::PredefinedMenuItem::separator(app)?;
            let quit = MenuItemBuilder::with_id("quit", "Quit").build(app)?;
            let menu = MenuBuilder::new(app)
                .items(&[&show, &recording, &separator, &quit])
                .build()?;

            let _tray = TrayIconBuilder::with_id("main-tray")
                .menu(&menu)
                .tooltip("Meeting Notes")
                .on_menu_event(|app, event| {
                    match event.id().as_ref() {
                        "show" => {
                            if let Some(window) = app.get_webview_window("main") {
                                let _ = window.show();
                                let _ = window.set_focus();
                            }
                        }
                        "quit" => {
                            app.exit(0);
                        }
                        _ => {}
                    }
                })
                .build(app)?;

            let handle = app.handle().clone();
            app.listen("recording-state", move |event| {
                let payload: Option<serde_json::Value> =
                    serde_json::from_str(event.payload()).ok();
                let recording = payload
                    .and_then(|v| v.get("recording").and_then(|r| r.as_bool()))
                    .unwrap_or(false);

                if let Some(tray) = handle.tray_by_id("main-tray") {
                    let tooltip = if recording {
                        "Meeting Notes — Recording"
                    } else {
                        "Meeting Notes"
                    };
                    let _ = tray.set_tooltip(Some(tooltip));
                }
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            fluid::transcribe_audio_fluid,
            fluid::check_fluid_ready,
            fluid::setup_fluid,
            fluid::unload_fluid,
            fluid::fluid_loaded,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

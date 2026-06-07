mod transcribe;

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            greet,
            transcribe::transcribe_audio,
            transcribe::check_whisper_ready,
            transcribe::get_whisper_status,
            transcribe::setup_whisper,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

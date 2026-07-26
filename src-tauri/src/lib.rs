pub mod git;

#[cfg(feature = "app")]
pub mod commands;

#[cfg(feature = "app")]
pub fn run() -> Result<(), tauri::Error> {
    tauri::Builder::default()
        .plugin(tauri_plugin_clipboard_manager::init())
        .invoke_handler(tauri::generate_handler![
            commands::get_diff,
            commands::list_commits,
            commands::browse_dir,
            commands::read_blob,
        ])
        .run(tauri::generate_context!())
}

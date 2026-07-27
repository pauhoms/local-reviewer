pub mod cli;
pub mod export;
pub mod git;
pub mod review;

#[cfg(feature = "app")]
pub mod commands;

/// `startup` is resolved once, before the window exists: the webview asks for
/// it back through `get_startup` instead of re-reading a command line it has
/// no access to.
#[cfg(feature = "app")]
pub fn run(startup: cli::Startup) -> Result<(), tauri::Error> {
    tauri::Builder::default()
        .plugin(tauri_plugin_clipboard_manager::init())
        .manage(startup)
        .invoke_handler(tauri::generate_handler![
            commands::get_startup,
            commands::list_recents,
            commands::record_recent,
            commands::get_diff,
            commands::list_commits,
            commands::browse_dir,
            commands::read_blob,
            commands::load_review,
            commands::save_review,
            commands::export_review,
        ])
        .run(tauri::generate_context!())
}

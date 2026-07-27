use crate::cli::{self, Startup, StartupInfo};
use crate::export;
use crate::git::{self, CommitInfo, DirEntryInfo, FileDiff, Scope, Side};
use crate::review::model::Review;
use crate::review::{recents, store};

#[tauri::command]
pub fn get_startup(startup: tauri::State<'_, Startup>) -> Result<StartupInfo, String> {
    Ok(cli::startup_info(startup.inner()))
}

#[tauri::command]
pub fn list_recents(limit: usize) -> Result<Vec<String>, String> {
    recents::list(limit).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn record_recent(repo: String) -> Result<(), String> {
    recents::record(&repo).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_diff(scope: Scope) -> Result<Vec<FileDiff>, String> {
    git::diff::diff_for_scope(&scope).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn list_commits(repo: String, limit: usize) -> Result<Vec<CommitInfo>, String> {
    git::commits::list_commits(&repo, limit).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn browse_dir(path: String) -> Result<Vec<DirEntryInfo>, String> {
    git::browse::browse_dir(&path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn read_blob(scope: Scope, path: String, side: Side) -> Result<String, String> {
    git::blob::read_blob(&scope, &path, side).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn load_review(scope: Scope) -> Result<Option<Review>, String> {
    store::load(&scope).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn save_review(review: Review) -> Result<(), String> {
    store::save(&review).map_err(|e| e.to_string())
}

/// `order` is the paths of the tree, in the order the tree shows them; the
/// answer is the absolute path of the Markdown that got written.
#[tauri::command]
pub fn export_review(review: Review, order: Vec<String>) -> Result<String, String> {
    export::export(&review, &order).map_err(|e| e.to_string())
}

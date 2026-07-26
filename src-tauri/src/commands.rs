use crate::git::{self, CommitInfo, DirEntryInfo, FileDiff, Scope, Side};

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

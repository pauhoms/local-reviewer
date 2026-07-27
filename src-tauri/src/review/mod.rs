pub mod model;
pub mod recents;
pub mod store;

use std::ffi::OsString;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU32, Ordering};

const REVIEWS_DIR_ENV: &str = "LOCAL_REVIEWER_REVIEWS_DIR";
const STATE_DIR: &str = ".state";

#[derive(Debug, thiserror::Error)]
pub enum ReviewError {
    #[error("could not determine where to store reviews")]
    NoReviewsDir,
    #[error("could not save {path}: {source}")]
    Io {
        path: String,
        #[source]
        source: std::io::Error,
    },
    #[error("could not encode review state: {0}")]
    Encode(#[from] serde_json::Error),
}

pub type ReviewResult<T> = Result<T, ReviewError>;

/// Where every piece of persisted state lives. Shared by the recents list and
/// the review store, which write side by side in the same `.state/` directory.
pub(crate) fn reviews_dir() -> ReviewResult<PathBuf> {
    reviews_dir_from(
        std::env::var_os(REVIEWS_DIR_ENV),
        crate::git::browse::home_dir().ok(),
    )
}

fn reviews_dir_from(
    override_dir: Option<OsString>,
    home: Option<PathBuf>,
) -> ReviewResult<PathBuf> {
    if let Some(dir) = override_dir.filter(|value| !value.is_empty()) {
        return Ok(PathBuf::from(dir));
    }
    home.map(|home| home.join(".codex").join("reviews"))
        .ok_or(ReviewError::NoReviewsDir)
}

pub(crate) fn state_dir_in(reviews_dir: &Path) -> PathBuf {
    reviews_dir.join(STATE_DIR)
}

/// Writes `body` as `state_dir/file_name`, creating the directory if it is
/// missing. The temporary file lives in the very same directory so the rename
/// stays inside one filesystem and lands as a single atomic step: a reader
/// never sees half a file, and a write that dies half way leaves the previous
/// contents byte for byte.
pub(crate) fn write_state_file(state_dir: &Path, file_name: &str, body: &str) -> ReviewResult<()> {
    let target = state_dir.join(file_name);
    let io_error = |source: std::io::Error| ReviewError::Io {
        path: target.to_string_lossy().into_owned(),
        source,
    };

    fs::create_dir_all(state_dir).map_err(io_error)?;

    static NEXT: AtomicU32 = AtomicU32::new(0);
    let temporary = state_dir.join(format!(
        ".{file_name}.{}.{}.tmp",
        std::process::id(),
        NEXT.fetch_add(1, Ordering::Relaxed)
    ));
    fs::write(&temporary, body).map_err(io_error)?;
    match fs::rename(&temporary, &target) {
        Ok(()) => Ok(()),
        Err(e) => {
            let _ = fs::remove_file(&temporary);
            Err(io_error(e))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn the_environment_override_wins_over_the_home_default() {
        let dir = reviews_dir_from(
            Some(OsString::from("/tmp/reviews")),
            Some(PathBuf::from("/home/dev")),
        )
        .expect("an explicit reviews dir");

        assert_eq!(dir, PathBuf::from("/tmp/reviews"));
    }

    #[test]
    fn without_an_override_the_reviews_live_under_home() {
        let dir = reviews_dir_from(None, Some(PathBuf::from("/home/dev"))).expect("home default");

        assert_eq!(dir, PathBuf::from("/home/dev/.codex/reviews"));
    }

    #[test]
    fn an_empty_override_is_treated_as_no_override() {
        let dir = reviews_dir_from(Some(OsString::new()), Some(PathBuf::from("/home/dev")))
            .expect("home default");

        assert_eq!(dir, PathBuf::from("/home/dev/.codex/reviews"));
    }

    #[test]
    fn with_neither_an_override_nor_a_home_there_is_nowhere_to_write() {
        assert!(matches!(
            reviews_dir_from(None, None),
            Err(ReviewError::NoReviewsDir)
        ));
    }

    #[test]
    fn the_temporary_file_lands_in_the_same_directory_as_its_target() {
        let dir = TempDir::new().expect("temp dir");
        let state = state_dir_in(dir.path());

        write_state_file(&state, "a.json", "{}").expect("write");

        let names: Vec<String> = fs::read_dir(&state)
            .expect("read the state dir")
            .map(|entry| {
                entry
                    .expect("entry")
                    .file_name()
                    .to_string_lossy()
                    .into_owned()
            })
            .collect();
        assert_eq!(names, vec!["a.json".to_string()]);
    }

    #[test]
    fn two_files_written_at_once_do_not_share_a_temporary_name() {
        let dir = TempDir::new().expect("temp dir");
        let state = state_dir_in(dir.path());

        std::thread::scope(|threads| {
            for round in 0..8 {
                let state = state.clone();
                threads.spawn(move || {
                    write_state_file(&state, "a.json", &format!("{{\"round\": {round}}}"))
                        .expect("write");
                });
            }
        });

        let raw = fs::read_to_string(state.join("a.json")).expect("read");
        assert!(
            raw.starts_with("{\"round\": ") && raw.ends_with('}'),
            "a shared temporary name would interleave two writes: {raw}"
        );
    }
}

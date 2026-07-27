use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use super::{reviews_dir, state_dir_in, write_state_file, ReviewResult};

/// How many repositories the picker remembers. Beyond a screenful the list
/// stops being a shortcut and becomes another thing to search.
pub const MAX_RECENTS: usize = 10;

const STATE_FILE: &str = "recents.json";

/// Moves `repo` to the front of the remembered list.
pub fn record(repo: &str) -> ReviewResult<()> {
    record_in(&reviews_dir()?, repo)
}

/// The remembered repositories, newest first. A state file that cannot be read
/// or understood answers as an empty list: losing the shortcuts is a nuisance,
/// losing the app over them is not acceptable.
pub fn list(limit: usize) -> ReviewResult<Vec<String>> {
    let Ok(dir) = reviews_dir() else {
        return Ok(Vec::new());
    };
    let mut recents = read_recents(&dir);
    recents.truncate(limit);
    Ok(recents)
}

/// Recording is read-modify-write: the atomic rename keeps a reader from ever
/// seeing half a file, but two writers racing would still drop one update.
static RECORD: Mutex<()> = Mutex::new(());

fn record_in(reviews_dir: &Path, repo: &str) -> ReviewResult<()> {
    // Nothing is guarded but the sequence itself, so a poisoned lock carries no
    // broken state: the file on disk is whole either way.
    let _serialised = RECORD
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());

    let updated = with_repo_in_front(read_recents(reviews_dir), repo);
    write_recents(reviews_dir, &updated)
}

fn read_recents(reviews_dir: &Path) -> Vec<String> {
    match fs::read_to_string(state_path(reviews_dir)) {
        Ok(raw) => decode(&raw),
        Err(_) => Vec::new(),
    }
}

fn write_recents(reviews_dir: &Path, recents: &[String]) -> ReviewResult<()> {
    let body = serde_json::to_string_pretty(recents)?;
    write_state_file(&state_dir_in(reviews_dir), STATE_FILE, &body)
}

fn state_path(reviews_dir: &Path) -> PathBuf {
    state_dir_in(reviews_dir).join(STATE_FILE)
}

fn decode(raw: &str) -> Vec<String> {
    let parsed: Vec<String> = serde_json::from_str(raw).unwrap_or_default();
    normalize(parsed)
}

fn with_repo_in_front(recents: Vec<String>, repo: &str) -> Vec<String> {
    let mut updated = Vec::with_capacity(recents.len() + 1);
    updated.push(repo.to_string());
    updated.extend(recents);
    normalize(updated)
}

fn normalize(recents: Vec<String>) -> Vec<String> {
    let mut seen: Vec<String> = Vec::with_capacity(recents.len());
    for repo in recents {
        if repo.trim().is_empty() || seen.contains(&repo) {
            continue;
        }
        seen.push(repo);
        if seen.len() == MAX_RECENTS {
            break;
        }
    }
    seen
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::review::ReviewError;
    use tempfile::TempDir;

    fn strings(list: &[&str]) -> Vec<String> {
        list.iter().map(|item| item.to_string()).collect()
    }

    #[test]
    fn the_repo_just_opened_goes_first_and_only_once() {
        let list = with_repo_in_front(strings(&["/a", "/b", "/c"]), "/b");

        assert_eq!(list, strings(&["/b", "/a", "/c"]));
    }

    #[test]
    fn a_hand_edited_list_is_read_without_its_duplicates_or_its_blanks() {
        let raw = r#"["/a", "", "/b", "/a", "  ", "/b"]"#;

        assert_eq!(decode(raw), strings(&["/a", "/b"]));
    }

    #[test]
    fn a_list_longer_than_the_cap_is_cut_when_it_is_read() {
        let repos: Vec<String> = (0..MAX_RECENTS + 5).map(|i| format!("/r{i}")).collect();
        let raw = serde_json::to_string(&repos).expect("encode");

        assert_eq!(decode(&raw).len(), MAX_RECENTS);
    }

    #[test]
    fn anything_that_is_not_a_list_of_paths_reads_as_no_recents() {
        for raw in [
            "",
            "null",
            "{\"repos\": 3}",
            "[1, 2]",
            "[\"/a\", 2]",
            "[\"/a",
        ] {
            assert!(
                decode(raw).is_empty(),
                "state {raw:?} must be ignored, not guessed"
            );
        }
    }

    #[test]
    fn a_reviews_dir_that_cannot_be_created_fails_loudly_on_record() {
        let dir = TempDir::new().expect("temp dir");
        let blocked = dir.path().join("a-file");
        std::fs::write(&blocked, "not a directory").expect("write file");

        let err = record_in(&blocked, "/home/dev/alpha")
            .expect_err("a reviews dir that is a file cannot be written to");

        assert!(matches!(err, ReviewError::Io { .. }), "got {err:?}");
        assert!(
            err.to_string().contains("recents.json"),
            "the message must name the file it could not write: {err}"
        );
    }

    #[test]
    fn an_unreadable_reviews_dir_reads_as_no_recents() {
        let dir = TempDir::new().expect("temp dir");
        let blocked = dir.path().join("a-file");
        std::fs::write(&blocked, "not a directory").expect("write file");

        assert!(read_recents(&blocked).is_empty());
    }

    #[test]
    fn repos_recorded_at_the_same_time_do_not_overwrite_each_other() {
        let dir = TempDir::new().expect("temp dir");
        let expected: Vec<String> = (0..8).map(|i| format!("/home/dev/r{i}")).collect();

        let path = dir.path();
        std::thread::scope(|threads| {
            for repo in &expected {
                threads.spawn(move || record_in(path, repo).expect("record"));
            }
        });

        let mut recorded = read_recents(dir.path());
        recorded.sort();
        assert_eq!(
            recorded, expected,
            "a read-modify-write that is not serialised loses updates"
        );
    }

    #[test]
    fn a_repo_recorded_twice_in_a_row_is_stored_once() {
        let dir = TempDir::new().expect("temp dir");
        record_in(dir.path(), "/home/dev/alpha").expect("record");
        record_in(dir.path(), "/home/dev/alpha").expect("record again");

        assert_eq!(read_recents(dir.path()), strings(&["/home/dev/alpha"]));
    }
}

//! TS-15 — the recent repositories list: written atomically under
//! `$REVIEWV4_REVIEWS_DIR/.state/`, read back by a *different* process, capped
//! and free of duplicates. Nothing here may touch `~/.claude/reviews/`.

use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Mutex;

use reviewv4_lib::review::recents::{list, record, MAX_RECENTS};
use tempfile::TempDir;

const REVIEWS_DIR_ENV: &str = "REVIEWV4_REVIEWS_DIR";
const EXPECTED_ENV: &str = "REVIEWV4_TEST_EXPECTED_RECENTS";

/// The reviews directory travels in the environment, which is process-wide:
/// tests that point it somewhere else must not overlap.
static ENV_LOCK: Mutex<()> = Mutex::new(());

/// Clears the variable even when the body panics: leaving it pointing at a
/// dropped `TempDir` would turn one real failure into a cascade of confusing
/// ones across the rest of the binary.
struct ReviewsDirVar;

impl Drop for ReviewsDirVar {
    fn drop(&mut self) {
        std::env::remove_var(REVIEWS_DIR_ENV);
    }
}

fn with_reviews_dir<T>(body: impl FnOnce(&Path) -> T) -> T {
    // Declaration order matters: dropping runs in reverse, so `_restore` clears
    // the variable while `_guard` still holds the lock. Releasing the lock by
    // hand first would let the next test set the variable and see it wiped.
    let _guard = ENV_LOCK
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let dir = TempDir::new().expect("create temp reviews dir");
    std::env::set_var(REVIEWS_DIR_ENV, dir.path());
    let _restore = ReviewsDirVar;
    body(dir.path())
}

fn state_file(reviews_dir: &Path) -> PathBuf {
    reviews_dir.join(".state").join("recents.json")
}

fn write_state(reviews_dir: &Path, content: &str) {
    let file = state_file(reviews_dir);
    fs::create_dir_all(file.parent().expect("state dir")).expect("create state dir");
    fs::write(&file, content).expect("write state file");
}

fn strings(paths: &[&str]) -> Vec<String> {
    paths.iter().map(|p| p.to_string()).collect()
}

#[test]
fn ts15_records_a_repo_and_lists_it_back() {
    with_reviews_dir(|_dir| {
        assert_eq!(
            list(10).expect("listing with no state yet must succeed"),
            Vec::<String>::new()
        );

        record("/home/dev/alpha").expect("record");

        assert_eq!(list(10).expect("list"), strings(&["/home/dev/alpha"]));
    });
}

#[test]
fn ts15_creates_the_state_directory_and_writes_the_json_file() {
    with_reviews_dir(|dir| {
        let nested = dir.join("brand-new");
        std::env::set_var(REVIEWS_DIR_ENV, &nested);

        record("/home/dev/alpha").expect("record must create the state directory");

        let file = state_file(&nested);
        assert!(
            file.is_file(),
            "expected the recents at {file:?}, found nothing"
        );
        let raw = fs::read_to_string(&file).expect("read the state file");
        serde_json::from_str::<serde_json::Value>(&raw)
            .unwrap_or_else(|e| panic!("the state file must be valid JSON ({e}): {raw}"));
        assert!(
            raw.contains("/home/dev/alpha"),
            "the recorded repo must be in the file: {raw}"
        );
        assert_eq!(list(10).expect("list"), strings(&["/home/dev/alpha"]));
    });
}

#[test]
fn ts15_recents_survive_a_process_restart() {
    with_reviews_dir(|dir| {
        record("/home/dev/alpha").expect("record alpha");
        record("/home/dev/beta").expect("record beta");

        let exe = std::env::current_exe().expect("path of this test binary");
        let output = Command::new(exe)
            .args([
                "--exact",
                "--ignored",
                "--nocapture",
                "recents_child_reads_what_the_parent_process_recorded",
            ])
            .env(REVIEWS_DIR_ENV, dir)
            .env(EXPECTED_ENV, "/home/dev/beta\n/home/dev/alpha")
            .output()
            .expect("run a second process against the same reviews dir");

        assert!(
            output.status.success(),
            "a fresh process must read the recents back\n--- stdout ---\n{}\n--- stderr ---\n{}",
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        );
    });
}

/// The other half of `ts15_recents_survive_a_process_restart`: it runs in a
/// second process, so nothing it reads can come from memory this one wrote.
#[test]
#[ignore = "spawned by ts15_recents_survive_a_process_restart"]
fn recents_child_reads_what_the_parent_process_recorded() {
    let expected: Vec<String> = std::env::var(EXPECTED_ENV)
        .expect("the parent test passes the expected recents")
        .split('\n')
        .map(|line| line.to_string())
        .collect();

    assert_eq!(list(10).expect("list in a fresh process"), expected);
}

#[test]
fn ts15_recording_the_same_repo_again_moves_it_to_the_front_without_duplicating() {
    with_reviews_dir(|_dir| {
        record("/home/dev/alpha").expect("record alpha");
        record("/home/dev/beta").expect("record beta");
        record("/home/dev/gamma").expect("record gamma");
        record("/home/dev/beta").expect("record beta again");

        assert_eq!(
            list(10).expect("list"),
            strings(&["/home/dev/beta", "/home/dev/gamma", "/home/dev/alpha"]),
        );
    });
}

#[test]
fn ts15_keeps_only_the_most_recent_repos_once_the_cap_is_passed() {
    assert!(
        (4..=100).contains(&MAX_RECENTS),
        "MAX_RECENTS must be a real cap, got {MAX_RECENTS}"
    );

    with_reviews_dir(|_dir| {
        let repos: Vec<String> = (0..MAX_RECENTS + 3)
            .map(|index| format!("/home/dev/repo{index}"))
            .collect();
        for repo in &repos {
            record(repo).expect("record");
        }

        let listed = list(MAX_RECENTS + 3).expect("list");

        let newest_first: Vec<String> = repos.iter().rev().take(MAX_RECENTS).cloned().collect();
        assert_eq!(listed, newest_first);
        for dropped in &repos[..3] {
            assert!(
                !listed.contains(dropped),
                "{dropped} is past the cap and must have been dropped"
            );
        }
    });
}

#[test]
fn ts15_list_returns_at_most_the_requested_limit_newest_first() {
    with_reviews_dir(|_dir| {
        record("/home/dev/alpha").expect("record alpha");
        record("/home/dev/beta").expect("record beta");
        record("/home/dev/gamma").expect("record gamma");

        assert_eq!(
            list(2).expect("list"),
            strings(&["/home/dev/gamma", "/home/dev/beta"])
        );
        assert_eq!(list(0).expect("list"), Vec::<String>::new());
    });
}

#[test]
fn ts15_a_corrupt_state_file_does_not_break_the_app() {
    with_reviews_dir(|dir| {
        write_state(dir, "{not json at all");

        assert_eq!(
            list(10).expect("a corrupt state file must not fail the startup"),
            Vec::<String>::new()
        );

        record("/home/dev/alpha").expect("recording over a corrupt file must succeed");
        assert_eq!(list(10).expect("list"), strings(&["/home/dev/alpha"]));
    });
}

#[test]
fn ts15_a_truncated_or_wrongly_shaped_state_file_is_ignored() {
    for content in [
        "[\"/home/dev/alpha\", \"/home/dev/be",
        "{\"repos\": 3}",
        "null",
        "",
    ] {
        with_reviews_dir(|dir| {
            write_state(dir, content);

            assert_eq!(
                list(10).unwrap_or_else(|e| panic!("state {content:?} must not fail: {e}")),
                Vec::<String>::new(),
                "state {content:?} must be ignored, not surfaced"
            );
        });
    }
}

#[test]
fn ts15_writes_atomically_leaving_no_leftover_files_in_the_state_dir() {
    with_reviews_dir(|dir| {
        record("/home/dev/alpha").expect("record alpha");
        record("/home/dev/beta").expect("record beta");
        record("/home/dev/gamma").expect("record gamma");

        let mut names: Vec<String> = fs::read_dir(dir.join(".state"))
            .expect("read the state dir")
            .map(|entry| {
                entry
                    .expect("dir entry")
                    .file_name()
                    .to_string_lossy()
                    .into_owned()
            })
            .collect();
        names.sort();

        assert_eq!(
            names,
            strings(&["recents.json"]),
            "the temporary file must be renamed over the target, never left behind"
        );

        let raw = fs::read_to_string(state_file(dir)).expect("read the state file");
        serde_json::from_str::<serde_json::Value>(&raw)
            .unwrap_or_else(|e| panic!("every write must leave complete JSON ({e}): {raw}"));
    });
}

/// The leftover check above would pass just as well for a plain `fs::write`
/// over the target, which is exactly what the atomic rule forbids. Renaming
/// only needs write permission on the *directory*, so a read-only target tells
/// the two apart: `rename` replaces it, `fs::write` gets EACCES.
#[test]
fn ts15_replaces_a_read_only_state_file_the_way_only_a_rename_can() {
    // Root carries CAP_DAC_OVERRIDE and writes through a 0444 file, which would
    // let a non-atomic write pass this test unnoticed.
    if unsafe { libc::geteuid() } == 0 {
        eprintln!("skipped: running as root, a read-only target proves nothing");
        return;
    }

    with_reviews_dir(|dir| {
        record("/home/dev/alpha").expect("record alpha");

        let target = state_file(dir);
        let mut perms = fs::metadata(&target)
            .expect("stat the state file")
            .permissions();
        perms.set_readonly(true);
        fs::set_permissions(&target, perms).expect("make the state file read-only");

        record("/home/dev/beta").expect("a read-only target must not stop an atomic write");

        assert_eq!(
            list(MAX_RECENTS).expect("list after replacing a read-only target"),
            strings(&["/home/dev/beta", "/home/dev/alpha"])
        );
    });
}

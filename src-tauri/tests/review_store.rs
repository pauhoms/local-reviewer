//! TS-29 / TS-30 — the review store: comments anchored to
//! (file, side, first line, last line), persisted as one JSON per review under
//! `$LOCAL_REVIEWER_REVIEWS_DIR/.state/` with an atomic write.
//!
//! Nothing here may touch `~/.codex/reviews/`: every test points the reviews
//! directory at a `TempDir` through the environment variable.

use std::fs;
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::Mutex;

use local_reviewer_lib::git::{Scope, Side};
use local_reviewer_lib::review::model::{Comment, DiffView, Review};
use local_reviewer_lib::review::store::{load, save, scope_key};
use local_reviewer_lib::review::ReviewError;
use serde_json::{json, Value};
use tempfile::TempDir;

const REVIEWS_DIR_ENV: &str = "LOCAL_REVIEWER_REVIEWS_DIR";
const EXPECTED_ENV: &str = "LOCAL_REVIEWER_TEST_EXPECTED_REVIEW";

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
    // the variable while `_guard` still holds the lock.
    let _guard = ENV_LOCK
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let dir = TempDir::new().expect("create temp reviews dir");
    std::env::set_var(REVIEWS_DIR_ENV, dir.path());
    let _restore = ReviewsDirVar;
    body(dir.path())
}

fn state_dir(reviews_dir: &Path) -> PathBuf {
    reviews_dir.join(".state")
}

fn state_file(reviews_dir: &Path, scope: &Scope) -> PathBuf {
    state_dir(reviews_dir).join(format!("{}.json", scope_key(scope)))
}

fn file_names(dir: &Path) -> Vec<String> {
    let mut names: Vec<String> = fs::read_dir(dir)
        .unwrap_or_else(|e| panic!("read {dir:?}: {e}"))
        .map(|entry| {
            entry
                .expect("dir entry")
                .file_name()
                .to_string_lossy()
                .into_owned()
        })
        .collect();
    names.sort();
    names
}

fn worktree() -> Scope {
    Scope::Worktree {
        repo: "/home/dev/local-reviewer".to_string(),
    }
}

fn comment(id: &str, path: &str, side: Side, from: u32, to: u32, text: &str) -> Comment {
    Comment {
        id: id.to_string(),
        path: path.to_string(),
        side,
        from,
        to,
        text: text.to_string(),
    }
}

fn review(scope: Scope, comments: Vec<Comment>) -> Review {
    Review {
        scope,
        comments,
        view: DiffView::Unified,
    }
}

fn loaded(scope: &Scope) -> Review {
    load(scope)
        .expect("loading a review that was just saved must succeed")
        .expect("the review must be on disk")
}

// ---------------------------------------------------------------------------
// TS-29 — the anchor survives the round trip
// ---------------------------------------------------------------------------

#[test]
fn ts29_a_comment_keeps_its_file_side_and_line_range_across_a_reopen() {
    with_reviews_dir(|_dir| {
        let saved = review(
            worktree(),
            vec![
                comment(
                    "c1",
                    "src/UserService.php",
                    Side::New,
                    35,
                    37,
                    "El método tiene demasiadas responsabilidades.",
                ),
                comment(
                    "c2",
                    "src/order/Order.ts",
                    Side::Old,
                    102,
                    102,
                    "Evitar duplicación del try/catch.",
                ),
            ],
        );

        save(&saved).expect("save");
        let back = loaded(&worktree());

        assert_eq!(back, saved);

        let first = &back.comments[0];
        assert_eq!(first.id, "c1");
        assert_eq!(first.path, "src/UserService.php");
        assert_eq!(first.side, Side::New);
        assert_eq!((first.from, first.to), (35, 37));
        assert_eq!(first.text, "El método tiene demasiadas responsabilidades.");

        let second = &back.comments[1];
        assert_eq!(second.side, Side::Old);
        assert_eq!((second.from, second.to), (102, 102));
    });
}

#[test]
fn ts29_a_scope_with_nothing_saved_yet_loads_as_no_review() {
    with_reviews_dir(|dir| {
        assert!(
            !state_dir(dir).exists(),
            "the fixture must start with no state directory at all"
        );

        assert_eq!(
            load(&worktree()).expect("loading a scope with no state must succeed"),
            None
        );
    });
}

#[test]
fn ts29_editing_the_text_of_a_comment_persists() {
    with_reviews_dir(|_dir| {
        save(&review(
            worktree(),
            vec![comment(
                "c1",
                "src/a.php",
                Side::New,
                12,
                14,
                "primera versión",
            )],
        ))
        .expect("save");

        save(&review(
            worktree(),
            vec![comment(
                "c1",
                "src/a.php",
                Side::New,
                12,
                14,
                "segunda versión, más precisa",
            )],
        ))
        .expect("save the edit");

        let back = loaded(&worktree());
        assert_eq!(back.comments.len(), 1, "editing must not add a comment");
        assert_eq!(back.comments[0].text, "segunda versión, más precisa");
        assert_eq!((back.comments[0].from, back.comments[0].to), (12, 14));
    });
}

#[test]
fn ts29_deleting_a_comment_persists() {
    with_reviews_dir(|_dir| {
        save(&review(
            worktree(),
            vec![
                comment("c1", "src/a.php", Side::New, 1, 1, "uno"),
                comment("c2", "src/a.php", Side::New, 2, 3, "dos"),
                comment("c3", "src/b.ts", Side::Old, 9, 9, "tres"),
            ],
        ))
        .expect("save");

        save(&review(
            worktree(),
            vec![
                comment("c1", "src/a.php", Side::New, 1, 1, "uno"),
                comment("c3", "src/b.ts", Side::Old, 9, 9, "tres"),
            ],
        ))
        .expect("save the deletion");

        let back = loaded(&worktree());
        let ids: Vec<&str> = back.comments.iter().map(|c| c.id.as_str()).collect();
        assert_eq!(ids, vec!["c1", "c3"]);
    });
}

#[test]
fn ts29_deleting_the_last_comment_leaves_a_review_with_none() {
    with_reviews_dir(|_dir| {
        save(&review(
            worktree(),
            vec![comment("c1", "src/a.php", Side::New, 1, 1, "uno")],
        ))
        .expect("save");

        save(&review(worktree(), Vec::new())).expect("save the empty review");

        let back = loaded(&worktree());
        assert_eq!(
            back.comments,
            Vec::new(),
            "an emptied review must persist as empty, not resurrect the old comment"
        );
    });
}

#[test]
fn ts29_the_old_and_the_new_side_of_the_same_lines_stay_apart() {
    with_reviews_dir(|_dir| {
        save(&review(
            worktree(),
            vec![
                comment("old", "src/a.php", Side::Old, 36, 36, "el borrado"),
                comment("new", "src/a.php", Side::New, 36, 36, "el añadido"),
            ],
        ))
        .expect("save");

        let back = loaded(&worktree());
        let sides: Vec<(String, Side)> = back
            .comments
            .iter()
            .map(|c| (c.id.clone(), c.side))
            .collect();

        assert_eq!(
            sides,
            vec![
                ("old".to_string(), Side::Old),
                ("new".to_string(), Side::New),
            ],
            "the side is the only thing telling these two anchors apart"
        );
    });
}

#[test]
fn ts29_a_single_line_anchor_is_not_widened_into_a_range() {
    with_reviews_dir(|_dir| {
        save(&review(
            worktree(),
            vec![
                comment("one", "src/a.php", Side::New, 35, 35, "una línea"),
                comment("many", "src/a.php", Side::New, 35, 48, "un rango"),
            ],
        ))
        .expect("save");

        let back = loaded(&worktree());
        assert_eq!((back.comments[0].from, back.comments[0].to), (35, 35));
        assert_eq!((back.comments[1].from, back.comments[1].to), (35, 48));
    });
}

#[test]
fn ts29_two_comments_on_the_very_same_range_both_survive() {
    with_reviews_dir(|_dir| {
        save(&review(
            worktree(),
            vec![
                comment("c1", "src/a.php", Side::New, 35, 48, "primera lectura"),
                comment("c2", "src/a.php", Side::New, 35, 48, "segunda lectura"),
            ],
        ))
        .expect("save");

        let back = loaded(&worktree());
        assert_eq!(back.comments.len(), 2);
        assert_eq!(back.comments[0].text, "primera lectura");
        assert_eq!(back.comments[1].text, "segunda lectura");
    });
}

#[test]
fn ts29_the_first_line_of_a_file_and_a_very_high_line_are_both_valid_anchors() {
    with_reviews_dir(|_dir| {
        save(&review(
            worktree(),
            vec![
                comment("first", "src/a.php", Side::New, 1, 1, "la primera línea"),
                comment(
                    "last",
                    "src/a.php",
                    Side::Old,
                    u32::MAX,
                    u32::MAX,
                    "la última línea",
                ),
            ],
        ))
        .expect("save");

        let back = loaded(&worktree());
        assert_eq!((back.comments[0].from, back.comments[0].to), (1, 1));
        assert_eq!(
            (back.comments[1].from, back.comments[1].to),
            (u32::MAX, u32::MAX)
        );
    });
}

#[test]
fn ts29_text_that_would_break_the_json_round_trips_byte_for_byte() {
    let texts = [
        "",
        "   ",
        "comillas \" y barra \\ y ambas \\\"",
        "primera línea\nsegunda línea\r\ntercera\ttabulada",
        "acentos: año señal ünïcode 🚀🙈 — em dash",
        "{\"comments\": [\"esto no es el JSON del estado\"]}",
        "</script><!-- ni esto -->",
    ];

    with_reviews_dir(|_dir| {
        let long = "x".repeat(100_000);
        let mut comments: Vec<Comment> = texts
            .iter()
            .enumerate()
            .map(|(index, text)| {
                comment(
                    &format!("c{index}"),
                    "src/a.php",
                    Side::New,
                    index as u32 + 1,
                    index as u32 + 1,
                    text,
                )
            })
            .collect();
        comments.push(comment("long", "src/a.php", Side::New, 99, 99, &long));

        save(&review(worktree(), comments)).expect("save");

        let back = loaded(&worktree());
        for (index, text) in texts.iter().enumerate() {
            assert_eq!(&back.comments[index].text, text, "text {index} drifted");
        }
        assert_eq!(back.comments[texts.len()].text.len(), 100_000);
    });
}

#[test]
fn ts29_a_path_with_spaces_accents_and_quotes_round_trips() {
    with_reviews_dir(|_dir| {
        let path = "informes finales/año 2026/resumen \"final\".md";
        save(&review(
            worktree(),
            vec![comment("c1", path, Side::New, 3, 4, "ojo con el nombre")],
        ))
        .expect("save");

        assert_eq!(loaded(&worktree()).comments[0].path, path);
    });
}

#[test]
fn ts29_the_review_serialises_to_the_shape_the_front_expects() {
    let value = serde_json::to_value(review(
        worktree(),
        vec![comment(
            "c1",
            "src/UserService.php",
            Side::New,
            35,
            37,
            "nota",
        )],
    ))
    .expect("serialise the review");

    assert_eq!(
        value,
        json!({
            "scope": { "kind": "worktree", "repo": "/home/dev/local-reviewer" },
            "comments": [{
                "id": "c1",
                "path": "src/UserService.php",
                "side": "new",
                "from": 35,
                "to": 37,
                "text": "nota",
            }],
            "view": "unified",
        }),
        "src/ipc/types.ts mirrors this payload; the two change together or neither"
    );
}

#[test]
fn ts29_the_state_lands_in_one_json_file_named_after_the_scope() {
    with_reviews_dir(|dir| {
        let scope = worktree();
        save(&review(
            scope.clone(),
            vec![comment("c1", "src/a.php", Side::Old, 7, 9, "nota")],
        ))
        .expect("save");

        let file = state_file(dir, &scope);
        assert!(
            file.is_file(),
            "expected the review at {file:?}; the state dir holds {:?}",
            file_names(&state_dir(dir))
        );

        let raw = fs::read_to_string(&file).expect("read the state file");
        let parsed: Value = serde_json::from_str(&raw)
            .unwrap_or_else(|e| panic!("the state file must be valid JSON ({e}): {raw}"));
        assert_eq!(parsed["comments"][0]["side"], json!("old"));
        assert_eq!(parsed["comments"][0]["from"], json!(7));
        assert_eq!(parsed["comments"][0]["to"], json!(9));
        assert_eq!(parsed["comments"][0]["path"], json!("src/a.php"));
    });
}

#[test]
fn ts29_scope_key_is_stable_and_tells_every_scope_apart() {
    let scopes = [
        Scope::Worktree {
            repo: "/home/dev/alpha".to_string(),
        },
        Scope::Worktree {
            repo: "/home/dev/beta".to_string(),
        },
        // A key built by swapping separators for underscores would collapse
        // these two different repositories into the same file.
        Scope::Worktree {
            repo: "/home/dev/a/b".to_string(),
        },
        Scope::Worktree {
            repo: "/home/dev/a_b".to_string(),
        },
        Scope::Commit {
            repo: "/home/dev/alpha".to_string(),
            sha: "a1b2c3".to_string(),
        },
        Scope::Commit {
            repo: "/home/dev/alpha".to_string(),
            sha: "d4e5f6".to_string(),
        },
        Scope::Range {
            repo: "/home/dev/alpha".to_string(),
            from: "a1b2c3".to_string(),
            to: "d4e5f6".to_string(),
        },
        Scope::Range {
            repo: "/home/dev/alpha".to_string(),
            from: "d4e5f6".to_string(),
            to: "a1b2c3".to_string(),
        },
    ];

    let keys: Vec<String> = scopes.iter().map(scope_key).collect();

    for (index, scope) in scopes.iter().enumerate() {
        assert_eq!(
            scope_key(scope),
            keys[index],
            "the key of {scope:?} must not change between calls"
        );
    }

    let mut unique = keys.clone();
    unique.sort();
    unique.dedup();
    assert_eq!(
        unique.len(),
        keys.len(),
        "two scopes share a state file: {keys:?}"
    );

    for key in &keys {
        assert!(!key.is_empty(), "an empty key names no file");
        assert!(
            !key.contains('/') && !key.contains('\\') && !key.contains('\0'),
            "the key becomes a file name, so it cannot carry separators: {key:?}"
        );
        assert!(
            key != "." && key != ".." && !key.starts_with(".."),
            "the key must not escape the state directory: {key:?}"
        );
    }
}

#[test]
fn ts29_two_scopes_of_the_same_repo_do_not_overwrite_each_other() {
    with_reviews_dir(|dir| {
        let tree = worktree();
        let commit = Scope::Commit {
            repo: "/home/dev/local-reviewer".to_string(),
            sha: "a1b2c3".to_string(),
        };

        save(&review(
            tree.clone(),
            vec![comment("w", "src/a.php", Side::New, 1, 1, "sin commitear")],
        ))
        .expect("save the worktree review");
        save(&review(
            commit.clone(),
            vec![comment("c", "src/b.ts", Side::Old, 2, 2, "del commit")],
        ))
        .expect("save the commit review");

        assert_eq!(loaded(&tree).comments[0].text, "sin commitear");
        assert_eq!(loaded(&commit).comments[0].text, "del commit");
        assert_eq!(file_names(&state_dir(dir)).len(), 2);

        let other_repo = Scope::Worktree {
            repo: "/home/dev/otro".to_string(),
        };
        assert_eq!(
            load(&other_repo).expect("load an untouched scope"),
            None,
            "a scope nobody reviewed must not inherit another one's comments"
        );
    });
}

#[test]
fn ts29_the_review_survives_a_process_restart() {
    with_reviews_dir(|dir| {
        let saved = review(
            worktree(),
            vec![
                comment(
                    "c1",
                    "src/UserService.php",
                    Side::New,
                    35,
                    37,
                    "separar\ncosas",
                ),
                comment("c2", "src/legacy.ts", Side::Old, 12, 12, "esto sobra"),
            ],
        );
        save(&saved).expect("save");

        let expected = serde_json::to_string(&saved).expect("encode the expectation");
        let exe = std::env::current_exe().expect("path of this test binary");
        let output = Command::new(exe)
            .args([
                "--exact",
                "--ignored",
                "--nocapture",
                "review_child_reads_what_the_parent_process_saved",
            ])
            .env(REVIEWS_DIR_ENV, dir)
            .env(EXPECTED_ENV, expected)
            .output()
            .expect("run a second process against the same reviews dir");

        assert!(
            output.status.success(),
            "a fresh process must read the review back\n--- stdout ---\n{}\n--- stderr ---\n{}",
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        );
    });
}

/// The other half of `ts29_the_review_survives_a_process_restart`: it runs in a
/// second process, so nothing it reads can come from memory this one wrote.
#[test]
#[ignore = "spawned by ts29_the_review_survives_a_process_restart"]
fn review_child_reads_what_the_parent_process_saved() {
    let raw = std::env::var(EXPECTED_ENV).expect("the parent test passes the expected review");
    let expected: Review = serde_json::from_str(&raw).expect("decode the expectation");

    let back = load(&worktree())
        .expect("load in a fresh process")
        .expect("the review must be on disk");

    assert_eq!(back, expected);
}

// ---------------------------------------------------------------------------
// TS-30 — where it lands and how it is written
// ---------------------------------------------------------------------------

#[test]
fn ts30_creates_the_state_directory_when_it_is_missing() {
    with_reviews_dir(|dir| {
        let nested = dir.join("aún").join("no").join("existe");
        std::env::set_var(REVIEWS_DIR_ENV, &nested);

        save(&review(
            worktree(),
            vec![comment("c1", "src/a.php", Side::New, 1, 2, "nota")],
        ))
        .expect("save must create the state directory");

        let file = state_file(&nested, &worktree());
        assert!(file.is_file(), "expected the review at {file:?}");
        assert_eq!(loaded(&worktree()).comments.len(), 1);
    });
}

#[test]
fn ts30_leaves_no_temporary_file_behind_in_the_state_dir() {
    with_reviews_dir(|dir| {
        for round in 0..5 {
            save(&review(
                worktree(),
                vec![comment(
                    "c1",
                    "src/a.php",
                    Side::New,
                    1,
                    2,
                    &format!("vuelta {round}"),
                )],
            ))
            .expect("save");
        }

        assert_eq!(
            file_names(&state_dir(dir)),
            vec![format!("{}.json", scope_key(&worktree()))],
            "the temporary file must be renamed over the target, never left behind"
        );
    });
}

/// The leftover check above would pass just as well for a plain `fs::write`
/// over the target, which is exactly what the atomic rule forbids. Renaming
/// only needs write permission on the *directory*, so a read-only target tells
/// the two apart: `rename` replaces it, `fs::write` gets EACCES.
#[test]
fn ts30_replaces_a_read_only_state_file_the_way_only_a_rename_can() {
    if unsafe { libc::geteuid() } == 0 {
        eprintln!("skipped: running as root, a read-only target proves nothing");
        return;
    }

    with_reviews_dir(|dir| {
        save(&review(
            worktree(),
            vec![comment("c1", "src/a.php", Side::New, 1, 2, "antes")],
        ))
        .expect("save");

        let target = state_file(dir, &worktree());
        let mut perms = fs::metadata(&target).expect("stat").permissions();
        perms.set_readonly(true);
        fs::set_permissions(&target, perms).expect("make the state file read-only");

        save(&review(
            worktree(),
            vec![comment("c1", "src/a.php", Side::New, 1, 2, "después")],
        ))
        .expect("a read-only target must not stop an atomic write");

        assert_eq!(loaded(&worktree()).comments[0].text, "después");
    });
}

#[test]
fn ts30_a_write_that_fails_leaves_the_previous_json_untouched() {
    if unsafe { libc::geteuid() } == 0 {
        eprintln!("skipped: running as root, a read-only directory proves nothing");
        return;
    }

    with_reviews_dir(|dir| {
        let good = review(
            worktree(),
            vec![comment(
                "c1",
                "src/a.php",
                Side::New,
                1,
                2,
                "la revisión que ya estaba",
            )],
        );
        save(&good).expect("save");

        let target = state_file(dir, &worktree());
        let before = fs::read(&target).expect("read the state file");

        // A directory nobody may write to is the closest thing to a write that
        // dies half way: the temporary file never lands and the rename never runs.
        let state = state_dir(dir);
        fs::set_permissions(&state, fs::Permissions::from_mode(0o555))
            .expect("make the state dir read-only");

        let err = save(&review(
            worktree(),
            vec![comment(
                "c2",
                "src/a.php",
                Side::New,
                9,
                9,
                "la que no cabe",
            )],
        ))
        .expect_err("a write that cannot happen must be reported, not swallowed");
        assert!(matches!(err, ReviewError::Io { .. }), "got {err:?}");

        assert_eq!(
            fs::read(&target).expect("read the state file again"),
            before,
            "the interrupted write must leave the previous JSON byte for byte"
        );

        fs::set_permissions(&state, fs::Permissions::from_mode(0o755))
            .expect("give the state dir its permissions back");

        assert_eq!(loaded(&worktree()), good);
    });
}

#[test]
fn ts30_a_reader_never_sees_half_a_write() {
    with_reviews_dir(|_dir| {
        const ROUNDS: usize = 120;
        const COMMENTS: usize = 200;

        // Big enough that a non-atomic write takes several syscalls to land:
        // a reader hitting the middle of one would read a truncated file.
        fn bulk(mark: char) -> Review {
            let text: String = std::iter::repeat(mark).take(500).collect();
            review(
                worktree(),
                (0..COMMENTS)
                    .map(|index| {
                        comment(
                            &format!("c{index}"),
                            "src/a.php",
                            Side::New,
                            index as u32 + 1,
                            index as u32 + 1,
                            &text,
                        )
                    })
                    .collect(),
            )
        }

        save(&bulk('A')).expect("first save");

        let writing = AtomicBool::new(true);
        let reads = AtomicUsize::new(0);

        std::thread::scope(|threads| {
            threads.spawn(|| {
                for round in 0..ROUNDS {
                    let mark = if round % 2 == 0 { 'B' } else { 'A' };
                    save(&bulk(mark)).expect("save while others read");
                }
                writing.store(false, Ordering::Release);
            });

            for _ in 0..3 {
                threads.spawn(|| {
                    while writing.load(Ordering::Acquire) {
                        let answer = load(&worktree()).expect("a concurrent read must never fail");
                        let Some(seen) = answer else {
                            panic!(
                                "a read landed inside a write and found no review at all: \
                                 the file was replaced in place instead of renamed over"
                            );
                        };

                        assert_eq!(
                            seen.comments.len(),
                            COMMENTS,
                            "a torn read lost comments: the write was not atomic"
                        );
                        let marks: std::collections::BTreeSet<char> = seen
                            .comments
                            .iter()
                            .filter_map(|c| c.text.chars().next())
                            .collect();
                        assert_eq!(
                            marks.len(),
                            1,
                            "a read mixed two different writes: {marks:?}"
                        );
                        for entry in &seen.comments {
                            assert_eq!(entry.text.len(), 500, "a comment came back truncated");
                        }
                        reads.fetch_add(1, Ordering::Relaxed);
                    }
                });
            }
        });

        assert!(
            reads.load(Ordering::Relaxed) > 0,
            "the readers never read anything, so this test proved nothing"
        );
    });
}

#[test]
fn ts30_a_reviews_dir_that_is_a_file_fails_loudly() {
    with_reviews_dir(|dir| {
        let blocked = dir.join("no-soy-un-directorio");
        fs::write(&blocked, "un fichero cualquiera").expect("write file");
        std::env::set_var(REVIEWS_DIR_ENV, &blocked);

        let err = save(&review(
            worktree(),
            vec![comment("c1", "src/a.php", Side::New, 1, 1, "nota")],
        ))
        .expect_err("a reviews dir that is a file cannot be written to");

        assert!(matches!(err, ReviewError::Io { .. }), "got {err:?}");
        assert!(
            err.to_string().contains(".json"),
            "the message must name the file it could not write: {err}"
        );
    });
}

#[test]
fn ts30_a_corrupt_state_file_invents_nothing_and_can_be_written_over() {
    for content in [
        "{no es json",
        "[\"esto es la lista de recientes\"]",
        "null",
        "",
        "{\"scope\": {\"kind\": \"worktree\", \"repo\": \"/home/dev/local-reviewer\"}, \"comments\": [{\"id\"",
    ] {
        with_reviews_dir(|dir| {
            fs::create_dir_all(state_dir(dir)).expect("create the state dir");
            fs::write(state_file(dir, &worktree()), content).expect("write a corrupt state file");

            // Either answer is defensible — say nothing, or say it failed — but
            // handing back a review nobody wrote is not.
            if let Ok(Some(found)) = load(&worktree()) {
                panic!("state {content:?} must not be read as a review, got {found:?}");
            }

            let fresh = review(
                worktree(),
                vec![comment("c1", "src/a.php", Side::New, 4, 5, "empezamos de cero")],
            );
            save(&fresh).expect("saving over a corrupt state file must succeed");
            assert_eq!(loaded(&worktree()), fresh);
        });
    }
}

#[test]
fn ts30_a_leftover_temporary_file_is_never_read_as_the_review() {
    with_reviews_dir(|dir| {
        let good = review(
            worktree(),
            vec![comment("c1", "src/a.php", Side::New, 1, 2, "la buena")],
        );
        save(&good).expect("save");

        // What a process killed mid-write leaves behind, in the very directory
        // the store reads from.
        let leftover = state_dir(dir).join(format!(".{}.json.999.0.tmp", scope_key(&worktree())));
        fs::write(&leftover, "{\"comments\": [ trunc").expect("write the leftover");

        assert_eq!(loaded(&worktree()), good);

        save(&review(
            worktree(),
            vec![comment("c1", "src/a.php", Side::New, 1, 2, "la siguiente")],
        ))
        .expect("a leftover must not block the next save");
        assert_eq!(loaded(&worktree()).comments[0].text, "la siguiente");
    });
}

/// The file is named after a hash of the scope, so a hand-edited or
/// hand-copied state file could claim to be a review of something else.
/// Loading it under the wrong scope would anchor its comments to a diff they
/// were never written against.
#[test]
fn ts29_a_state_file_holding_another_scope_is_not_read_as_this_one() {
    with_reviews_dir(|dir| {
        let intruder = review(
            Scope::Commit {
                repo: "/home/dev/local-reviewer".to_string(),
                sha: "a1b2c3d".to_string(),
            },
            vec![comment(
                "x1",
                "src/a.ts",
                Side::New,
                1,
                1,
                "de otro alcance",
            )],
        );
        let json = serde_json::to_string(&intruder).expect("serialise the intruder");
        let target = state_file(dir, &worktree());
        fs::create_dir_all(target.parent().expect("state dir")).expect("create state dir");
        fs::write(&target, json).expect("plant the intruder");

        assert_eq!(
            load(&worktree()).expect("a mismatched scope is not a failure"),
            None,
            "a review of another scope must not be served as this one"
        );

        // And the guard must not wedge the scope: a real save still takes.
        save(&review(
            worktree(),
            vec![comment("m1", "src/a.ts", Side::New, 2, 2, "la buena")],
        ))
        .expect("save over the intruder");
        assert_eq!(loaded(&worktree()).comments.len(), 1);
    });
}

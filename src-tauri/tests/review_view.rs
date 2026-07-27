//! TS-39 — the view a review was left in travels with it. This is also where
//! the debt phase 6 wrote down gets paid: `src/ipc/types.ts` declares
//! `view: "unified" | "split"`, a closed union, so the Rust side may not hand
//! the webview any other string. Every assertion here goes through JSON on
//! purpose: it says nothing about how `Review::view` is spelled in Rust, only
//! that the payload crossing the border is one the front's type allows.
//!
//! Nothing here may touch `~/.codex/reviews/`: the reviews directory is
//! pointed at a `TempDir` through the environment variable.

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use reviewv4_lib::review::model::Review;
use reviewv4_lib::review::store::{load, save, scope_key};
use serde_json::{json, Value};
use tempfile::TempDir;

const REVIEWS_DIR_ENV: &str = "REVIEWV4_REVIEWS_DIR";

/// The reviews directory travels in the environment, which is process-wide:
/// tests that point it somewhere else must not overlap.
static ENV_LOCK: Mutex<()> = Mutex::new(());

struct ReviewsDirVar;

impl Drop for ReviewsDirVar {
    fn drop(&mut self) {
        std::env::remove_var(REVIEWS_DIR_ENV);
    }
}

fn with_reviews_dir<T>(body: impl FnOnce(&Path) -> T) -> T {
    let _guard = ENV_LOCK
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let dir = TempDir::new().expect("create temp reviews dir");
    std::env::set_var(REVIEWS_DIR_ENV, dir.path());
    let _restore = ReviewsDirVar;
    body(dir.path())
}

fn worktree_scope() -> Value {
    json!({ "kind": "worktree", "repo": "/home/dev/reviewv4" })
}

fn scope() -> reviewv4_lib::git::Scope {
    reviewv4_lib::git::Scope::Worktree {
        repo: "/home/dev/reviewv4".to_string(),
    }
}

fn state_file(reviews_dir: &Path) -> PathBuf {
    reviews_dir
        .join(".state")
        .join(format!("{}.json", scope_key(&scope())))
}

/// A review as the front sends it, built from JSON so this file never has to
/// name the Rust type of `view`.
fn review_json(view: &str) -> Value {
    json!({
        "scope": worktree_scope(),
        "comments": [{
            "id": "c1",
            "path": "src/UserService.php",
            "side": "new",
            "from": 38,
            "to": 38,
            "text": "nota",
        }],
        "view": view,
    })
}

fn decode(view: &str) -> Result<Review, serde_json::Error> {
    serde_json::from_value::<Review>(review_json(view))
}

fn encode(review: &Review) -> Value {
    serde_json::to_value(review).expect("serialise the review")
}

#[test]
fn ts39_both_views_the_front_knows_round_trip_through_the_state_file() {
    for view in ["unified", "split"] {
        with_reviews_dir(|_dir| {
            let review = decode(view).unwrap_or_else(|e| panic!("{view:?} must decode: {e}"));
            save(&review).expect("save");

            let back = load(&scope())
                .expect("loading a review that was just saved must succeed")
                .expect("the review must be on disk");

            assert_eq!(
                encode(&back)["view"],
                json!(view),
                "the view the review was left in must come back unchanged"
            );
            assert_eq!(back, review);
        });
    }
}

#[test]
fn ts39_the_saved_json_names_the_view_the_typescript_union_allows() {
    with_reviews_dir(|dir| {
        save(&decode("split").expect("decode")).expect("save");

        let raw = fs::read_to_string(state_file(dir)).expect("read the state file");
        let parsed: Value = serde_json::from_str(&raw).expect("the state file must be valid JSON");

        assert_eq!(
            parsed["view"],
            json!("split"),
            "src/ipc/types.ts mirrors this payload; the two change together or neither"
        );
    });
}

/// The debt of phase 6: `view` was a bare `String`, so a hand-edited state file
/// could hand the webview a value its own type declares impossible.
#[test]
fn ts39_a_view_outside_the_union_is_not_decoded_as_a_review() {
    for view in ["diagonal", "Unified", "SPLIT", "split ", "", "unificado"] {
        let decoded = decode(view);
        assert!(
            decoded.is_err(),
            "view {view:?} is not one of unified/split, yet it decoded into {:?}",
            decoded.ok()
        );
    }
}

#[test]
fn ts39_a_state_file_with_a_view_nobody_knows_is_not_served_as_a_review() {
    for body in [
        review_json("diagonal").to_string(),
        json!({ "scope": worktree_scope(), "comments": [] }).to_string(),
        json!({ "scope": worktree_scope(), "comments": [], "view": null }).to_string(),
        json!({ "scope": worktree_scope(), "comments": [], "view": 2 }).to_string(),
    ] {
        with_reviews_dir(|dir| {
            let target = state_file(dir);
            fs::create_dir_all(target.parent().expect("state dir")).expect("create the state dir");
            fs::write(&target, &body).expect("plant the state file");

            // Either answer is defensible — say nothing, or say it failed — but
            // handing the front a view its type says cannot exist is not.
            if let Ok(Some(found)) = load(&scope()) {
                let view = encode(&found)["view"].clone();
                assert!(
                    view == json!("unified") || view == json!("split"),
                    "state {body} came back as a review whose view is {view}"
                );
            }
        });
    }
}

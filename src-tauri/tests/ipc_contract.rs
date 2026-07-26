//! The IPC payloads crossing into the webview, pinned to the exact JSON that
//! `src/ipc/types.ts` declares. `commands.rs` lives behind the `app` feature,
//! so without these round-trips nothing would notice the contract drifting.

use reviewv4_lib::git::{
    CommitInfo, DirEntryInfo, FileDiff, FileStatus, Hunk, Line, LineKind, Scope, Side,
};
use serde::de::DeserializeOwned;
use serde::Serialize;
use serde_json::{json, Value};

/// Asserts both directions at once: the value serialises to exactly `expected`
/// and `expected` deserialises back into the same value.
fn assert_json<T>(value: T, expected: Value)
where
    T: Serialize + DeserializeOwned + PartialEq + std::fmt::Debug,
{
    assert_eq!(serde_json::to_value(&value).expect("serialise"), expected);
    assert_eq!(
        serde_json::from_value::<T>(expected).expect("deserialise"),
        value
    );
}

#[test]
fn file_diff_matches_the_typescript_shape() {
    let file = FileDiff {
        path: "src/util/Util.ts".to_string(),
        old_path: Some("src/old/Util.ts".to_string()),
        status: FileStatus::Renamed,
        additions: 1,
        deletions: 1,
        hunks: vec![Hunk {
            header: "@@ -1,2 +1,2 @@ fn main()".to_string(),
            old_start: 1,
            old_lines: 2,
            new_start: 1,
            new_lines: 2,
            lines: vec![
                Line {
                    kind: LineKind::Context,
                    old_no: Some(1),
                    new_no: Some(1),
                    content: "kept".to_string(),
                },
                Line {
                    kind: LineKind::Del,
                    old_no: Some(2),
                    new_no: None,
                    content: "gone".to_string(),
                },
                Line {
                    kind: LineKind::Add,
                    old_no: None,
                    new_no: Some(2),
                    content: "fresh".to_string(),
                },
            ],
        }],
    };

    assert_json(
        file,
        json!({
            "path": "src/util/Util.ts",
            "oldPath": "src/old/Util.ts",
            "status": "R",
            "additions": 1,
            "deletions": 1,
            "hunks": [{
                "header": "@@ -1,2 +1,2 @@ fn main()",
                "oldStart": 1,
                "oldLines": 2,
                "newStart": 1,
                "newLines": 2,
                "lines": [
                    { "kind": "context", "oldNo": 1, "newNo": 1, "content": "kept" },
                    { "kind": "del", "oldNo": 2, "newNo": null, "content": "gone" },
                    { "kind": "add", "oldNo": null, "newNo": 2, "content": "fresh" },
                ],
            }],
        }),
    );
}

#[test]
fn file_diff_without_an_old_path_serialises_it_as_null() {
    let file = FileDiff {
        path: "a.txt".to_string(),
        old_path: None,
        status: FileStatus::Modified,
        additions: 0,
        deletions: 0,
        hunks: Vec::new(),
    };

    assert_json(
        file,
        json!({
            "path": "a.txt",
            "oldPath": null,
            "status": "M",
            "additions": 0,
            "deletions": 0,
            "hunks": [],
        }),
    );
}

#[test]
fn file_status_uses_the_single_letter_codes() {
    let codes = [
        (FileStatus::Modified, "M"),
        (FileStatus::Added, "A"),
        (FileStatus::Deleted, "D"),
        (FileStatus::Renamed, "R"),
    ];
    for (status, code) in codes {
        assert_json(status, json!(code));
    }
}

#[test]
fn line_kind_uses_lowercase_names() {
    let kinds = [
        (LineKind::Add, "add"),
        (LineKind::Del, "del"),
        (LineKind::Context, "context"),
    ];
    for (kind, name) in kinds {
        assert_json(kind, json!(name));
    }
}

#[test]
fn commit_info_matches_the_typescript_shape() {
    let commit = CommitInfo {
        hash: "0123456789abcdef".to_string(),
        short_hash: "0123456".to_string(),
        subject: "feat: add the scope picker".to_string(),
        author: "Jane Doe".to_string(),
        date: "2021-02-02T00:00:00+00:00".to_string(),
    };

    assert_json(
        commit,
        json!({
            "hash": "0123456789abcdef",
            "shortHash": "0123456",
            "subject": "feat: add the scope picker",
            "author": "Jane Doe",
            "date": "2021-02-02T00:00:00+00:00",
        }),
    );
}

#[test]
fn dir_entry_info_matches_the_typescript_shape() {
    let entry = DirEntryInfo {
        name: "beta".to_string(),
        path: "/home/dev/beta".to_string(),
        is_git_repo: true,
    };

    assert_json(
        entry,
        json!({ "name": "beta", "path": "/home/dev/beta", "isGitRepo": true }),
    );
}

#[test]
fn worktree_scope_matches_the_typescript_shape() {
    assert_json(
        Scope::Worktree {
            repo: "/home/dev/p".to_string(),
        },
        json!({ "kind": "worktree", "repo": "/home/dev/p" }),
    );
}

#[test]
fn commit_scope_matches_the_typescript_shape() {
    assert_json(
        Scope::Commit {
            repo: "/home/dev/p".to_string(),
            sha: "abc123".to_string(),
        },
        json!({ "kind": "commit", "repo": "/home/dev/p", "sha": "abc123" }),
    );
}

#[test]
fn range_scope_matches_the_typescript_shape() {
    assert_json(
        Scope::Range {
            repo: "/home/dev/p".to_string(),
            from: "abc123".to_string(),
            to: "def456".to_string(),
        },
        json!({ "kind": "range", "repo": "/home/dev/p", "from": "abc123", "to": "def456" }),
    );
}

#[test]
fn side_uses_lowercase_names() {
    assert_json(Side::Old, json!("old"));
    assert_json(Side::New, json!("new"));
}

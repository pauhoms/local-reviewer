//! Every case here feeds the parser with what `git` actually prints, not a
//! hand-written diff: the quoting, tab and marker conventions that only show up
//! in real output are exactly what used to slip through.

mod helpers;

use std::ffi::OsStr;
use std::os::unix::ffi::OsStrExt;
use std::os::unix::fs::symlink;

use helpers::git_fixture::{canonical, temp_dir_outside_home, TempRepo};
use local_reviewer_lib::git::blob::read_blob;
use local_reviewer_lib::git::diff::diff_for_scope;
use local_reviewer_lib::git::parse::parse_unified_diff;
use local_reviewer_lib::git::{FileDiff, FileStatus, GitError, LineKind, Scope, Side};

fn shape(file: &FileDiff) -> Vec<(LineKind, Option<u32>, Option<u32>, String)> {
    file.hunks
        .iter()
        .flat_map(|h| h.lines.iter())
        .map(|l| (l.kind, l.old_no, l.new_no, l.content.clone()))
        .collect()
}

fn diff_head(repo: &TempRepo) -> Vec<FileDiff> {
    parse_unified_diff(&repo.git(&["diff", "--no-color", "--find-renames", "HEAD"]))
}

/// The fixture only writes text; a binary file has to go in as raw bytes.
fn write_bytes(repo: &TempRepo, rel: &str, bytes: &[u8]) {
    std::fs::write(repo.path().join(rel), bytes).expect("write binary file");
}

fn worktree_paths(repo: &TempRepo) -> Vec<String> {
    let files = diff_for_scope(&Scope::Worktree {
        repo: repo.path_str(),
    })
    .expect("worktree diff");
    let mut paths: Vec<String> = files.iter().map(|f| f.path.clone()).collect();
    paths.sort();
    paths
}

#[test]
fn keeps_the_lines_after_a_no_newline_at_end_of_file_marker() {
    let repo = TempRepo::new();
    repo.write("nonl.txt", "a\nb\nc");
    repo.commit_all("base");
    repo.write("nonl.txt", "a\nb\nC");

    let files = diff_head(&repo);

    assert_eq!(files.len(), 1);
    assert_eq!(
        shape(&files[0]),
        vec![
            (LineKind::Context, Some(1), Some(1), "a".to_string()),
            (LineKind::Context, Some(2), Some(2), "b".to_string()),
            (LineKind::Del, Some(3), None, "c".to_string()),
            (LineKind::Add, None, Some(3), "C".to_string()),
        ]
    );
    assert_eq!(files[0].additions, 1);
    assert_eq!(files[0].deletions, 1);
}

#[test]
fn reports_the_real_name_of_a_tracked_non_ascii_path() {
    let repo = TempRepo::new();
    repo.write("cañón.txt", "p\n");
    repo.commit_all("base");
    repo.write("cañón.txt", "P\n");

    assert_eq!(worktree_paths(&repo), vec!["cañón.txt".to_string()]);
}

#[test]
fn reports_an_untracked_non_ascii_path_instead_of_failing_the_whole_worktree() {
    let repo = TempRepo::new();
    repo.write("tracked.txt", "t\n");
    repo.commit_all("base");
    repo.write("señor.txt", "s\n");

    assert_eq!(worktree_paths(&repo), vec!["señor.txt".to_string()]);
}

/// `core.quotePath=false` still leaves git quoting names that contain a double
/// quote, so the parser has to undo C-style quoting on its own.
#[test]
fn unquotes_a_path_git_quoted_despite_quote_path_being_off() {
    let repo = TempRepo::new();
    repo.write("we\"ird.txt", "q\n");
    repo.commit_all("base");
    repo.write("we\"ird.txt", "Q\n");

    assert_eq!(worktree_paths(&repo), vec!["we\"ird.txt".to_string()]);
}

/// git appends a TAB to the `---`/`+++` lines of a path that contains a space;
/// keeping it would give the same file two different keys.
#[test]
fn strips_the_tab_git_appends_to_a_path_with_spaces() {
    let repo = TempRepo::new();
    repo.write("my file.txt", "x\ny\n");
    repo.write("plain.txt", "p\n");
    repo.commit_all("base");
    repo.write("my file.txt", "x\nY\n");
    repo.write("my other file.txt", "u\n");

    assert_eq!(
        worktree_paths(&repo),
        vec!["my file.txt".to_string(), "my other file.txt".to_string()]
    );
}

/// A name with both a quote and a space gets the two conventions at once: git
/// quotes the path *and* appends a TAB behind the closing quote.
#[test]
fn unquotes_a_quoted_path_that_also_carries_a_trailing_tab() {
    let repo = TempRepo::new();
    repo.write("we\"ird file.txt", "x\n");
    repo.commit_all("base");
    repo.write("we\"ird file.txt", "X\n");

    assert_eq!(worktree_paths(&repo), vec!["we\"ird file.txt".to_string()]);
}

#[test]
fn reports_an_untracked_binary_file_as_added_without_hunks() {
    let repo = TempRepo::new();
    repo.write("tracked.txt", "t\n");
    repo.commit_all("base");
    write_bytes(
        &repo,
        "logo.png",
        &[0x89, b'P', b'N', b'G', 0xff, 0xfe, 0x00],
    );
    repo.write("notes.txt", "n1\n");

    let files = diff_for_scope(&Scope::Worktree {
        repo: repo.path_str(),
    })
    .expect("a binary untracked file must not fail the whole worktree diff");

    let logo = files
        .iter()
        .find(|f| f.path == "logo.png")
        .expect("logo.png is listed");
    assert_eq!(logo.status, FileStatus::Added);
    assert_eq!(logo.additions, 0);
    assert_eq!(logo.deletions, 0);
    assert!(logo.hunks.is_empty(), "hunks: {:?}", logo.hunks);

    let notes = files
        .iter()
        .find(|f| f.path == "notes.txt")
        .expect("the text untracked file is still listed");
    assert_eq!(notes.additions, 1);
}

/// A binary change has no `---`/`+++` lines, so the path has to come from the
/// `diff --git` header or two binaries become indistinguishable.
#[test]
fn names_tracked_binary_files_from_the_diff_git_header() {
    let repo = TempRepo::new();
    write_bytes(&repo, "a.dat", &[0x00, 0x01, 0x02]);
    write_bytes(&repo, "b.dat", &[0x10, 0x00, 0x12]);
    repo.commit_all("base");
    write_bytes(&repo, "a.dat", &[0x00, 0x01, 0x03]);
    write_bytes(&repo, "b.dat", &[0x10, 0x00, 0x13]);

    let files = diff_head(&repo);

    let mut paths: Vec<String> = files.iter().map(|f| f.path.clone()).collect();
    paths.sort();
    assert_eq!(paths, vec!["a.dat".to_string(), "b.dat".to_string()]);
    assert!(files.iter().all(|f| f.status == FileStatus::Modified));
    assert!(files.iter().all(|f| f.hunks.is_empty()));
}

#[test]
fn names_a_pure_mode_change_from_the_diff_git_header() {
    let repo = TempRepo::new();
    repo.write("script.sh", "echo hi\n");
    repo.commit_all("base");
    repo.git(&["update-index", "--chmod=+x", "script.sh"]);

    let files = parse_unified_diff(&repo.git(&["diff", "--no-color", "--cached", "HEAD"]));

    assert_eq!(files.len(), 1);
    assert_eq!(files[0].path, "script.sh");
}

#[test]
fn reports_both_sides_of_a_rename_with_non_ascii_names() {
    let repo = TempRepo::new();
    repo.write("informé.md", "línea uno\nlínea dos\n");
    repo.write("we\"ird.md", "q\n");
    repo.commit_all("base");
    repo.rename("informé.md", "reporté.md");
    repo.rename("we\"ird.md", "we\"ird2.md");

    let files = diff_for_scope(&Scope::Worktree {
        repo: repo.path_str(),
    })
    .expect("worktree diff");

    let renames: Vec<(String, Option<String>)> = files
        .iter()
        .filter(|f| f.status == FileStatus::Renamed)
        .map(|f| (f.path.clone(), f.old_path.clone()))
        .collect();
    assert_eq!(
        renames,
        vec![
            ("reporté.md".to_string(), Some("informé.md".to_string())),
            ("we\"ird2.md".to_string(), Some("we\"ird.md".to_string())),
        ]
    );
}

/// A ref that starts with `-` becomes a git option: `--output=…` made git
/// write inside the repo under review, which the app must never do.
#[test]
fn rejects_a_ref_that_would_smuggle_an_option_into_git() {
    let repo = TempRepo::new();
    repo.write("only.txt", "a\n");
    let base = repo.commit_all("base");
    let pwned = repo.path().join("PWNED.txt");
    let malicious = format!("--output={}", pwned.display());

    let scopes = vec![
        Scope::Range {
            repo: repo.path_str(),
            from: base.clone(),
            to: malicious.clone(),
        },
        Scope::Range {
            repo: repo.path_str(),
            from: malicious.clone(),
            to: base.clone(),
        },
        Scope::Commit {
            repo: repo.path_str(),
            sha: malicious.clone(),
        },
    ];

    for scope in &scopes {
        let err = diff_for_scope(scope).expect_err("a malicious ref must be rejected");
        assert!(
            matches!(err, GitError::BadRef(_)),
            "expected GitError::BadRef for {scope:?}, got {err:?}"
        );
    }

    let err = read_blob(&scopes[0], "only.txt", Side::New)
        .expect_err("a malicious ref must be rejected when reading a blob");
    assert!(
        matches!(err, GitError::BadRef(_)),
        "expected GitError::BadRef, got {err:?}"
    );

    assert!(!pwned.exists(), "git must not have written into the repo");
}

/// A branch whose name is also a file in the tree passes `ensure_ref` and then
/// made `git diff` bail out with an ambiguity `fatal:` — in English, inside a
/// Spanish UI.
#[test]
fn diffs_a_ref_that_is_also_the_name_of_a_file() {
    let repo = TempRepo::new();
    repo.write("feature", "v1\n");
    repo.commit_all("base");
    repo.write("feature", "v2\n");
    let sha = repo.commit_all("second");
    repo.git(&["branch", "feature"]);

    for scope in [
        Scope::Commit {
            repo: repo.path_str(),
            sha: "feature".to_string(),
        },
        Scope::Range {
            repo: repo.path_str(),
            from: "feature".to_string(),
            to: "feature".to_string(),
        },
    ] {
        let files = diff_for_scope(&scope).expect("a ref that is also a filename must still diff");
        assert_eq!(
            files.iter().map(|f| f.path.clone()).collect::<Vec<_>>(),
            vec!["feature".to_string()],
            "scope {scope:?}"
        );
    }

    assert_eq!(repo.git(&["rev-parse", "feature"]), sha);
}

/// "the path is absent at that revision" is the only `git show` failure that
/// means an empty side; anything else has to reach the user as an error.
#[test]
fn propagates_a_git_show_failure_that_is_not_a_missing_path() {
    let repo = TempRepo::new();
    repo.write("a.txt", "hello\n");
    let sha = repo.commit_all("base");
    let blob = repo.git(&["rev-parse", "HEAD:a.txt"]);
    let (dir, name) = blob.split_at(2);
    std::fs::remove_file(repo.path().join(".git/objects").join(dir).join(name))
        .expect("drop the blob object");

    let scope = Scope::Commit {
        repo: repo.path_str(),
        sha,
    };

    let err = read_blob(&scope, "a.txt", Side::New)
        .expect_err("a corrupt object store must not look like an empty file");
    assert!(
        matches!(err, GitError::CommandFailed(_)),
        "expected GitError::CommandFailed, got {err:?}"
    );

    assert_eq!(
        read_blob(&scope, "absent.txt", Side::New).expect("a missing path is still an empty side"),
        ""
    );
}

#[test]
fn refuses_to_read_a_blob_from_outside_the_repo() {
    let repo = TempRepo::new();
    repo.write("src/app.ts", "const a = 1;\n");
    let sha = repo.commit_all("base");

    let worktree = Scope::Worktree {
        repo: repo.path_str(),
    };
    let commit = Scope::Commit {
        repo: repo.path_str(),
        sha,
    };

    for path in ["/etc/hostname", "../../../etc/hostname"] {
        for (scope, side) in [
            (&worktree, Side::New),
            (&worktree, Side::Old),
            (&commit, Side::New),
            (&commit, Side::Old),
        ] {
            let err =
                read_blob(scope, path, side).expect_err("a path outside the repo must be rejected");
            assert!(
                matches!(err, GitError::PathOutsideRepo(_)),
                "expected GitError::PathOutsideRepo for {path}, got {err:?}"
            );
        }
    }

    assert_eq!(
        read_blob(&worktree, "src/app.ts", Side::New).expect("a path inside the repo still reads"),
        "const a = 1;\n"
    );
}

/// `git diff HEAD` is fatal in a repo that has no commits yet, and its English
/// `fatal: …` has no business reaching a Spanish UI.
#[test]
fn diffs_a_repo_without_commits_against_the_empty_tree() {
    let repo = TempRepo::new();
    repo.write("staged.txt", "s1\ns2\n");
    repo.add("staged.txt");
    repo.write("untracked.txt", "u1\n");

    let files = diff_for_scope(&Scope::Worktree {
        repo: repo.path_str(),
    })
    .expect("a repo without commits must not error");

    let mut paths: Vec<String> = files.iter().map(|f| f.path.clone()).collect();
    paths.sort();
    assert_eq!(
        paths,
        vec!["staged.txt".to_string(), "untracked.txt".to_string()]
    );
    assert!(files.iter().all(|f| f.status == FileStatus::Added));
}

#[test]
fn reads_the_working_tree_side_of_a_repo_without_commits() {
    let repo = TempRepo::new();
    repo.write("staged.txt", "s1\n");
    repo.add("staged.txt");
    let scope = Scope::Worktree {
        repo: repo.path_str(),
    };

    assert_eq!(
        read_blob(&scope, "staged.txt", Side::New).expect("new side"),
        "s1\n"
    );
    assert_eq!(
        read_blob(&scope, "staged.txt", Side::Old).expect("there is no HEAD to compare against"),
        ""
    );
}

/// `git diff` reports paths relative to the repo root while `ls-files` reports
/// them relative to the cwd, so a subdirectory used to mislabel untracked files.
#[test]
fn reports_untracked_paths_relative_to_the_repo_root_from_a_subdirectory() {
    let repo = TempRepo::new();
    repo.write("sub/tracked.txt", "t\n");
    repo.commit_all("base");
    repo.write("sub/tracked.txt", "T\n");
    repo.write("sub/untracked.txt", "u\n");
    repo.write("root.txt", "r\n");

    let sub = repo.path().join("sub");
    let files = diff_for_scope(&Scope::Worktree {
        repo: sub.to_string_lossy().into_owned(),
    })
    .expect("worktree diff from a subdirectory");

    let mut paths: Vec<String> = files.iter().map(|f| f.path.clone()).collect();
    paths.sort();
    assert_eq!(
        paths,
        vec![
            "root.txt".to_string(),
            "sub/tracked.txt".to_string(),
            "sub/untracked.txt".to_string(),
        ]
    );
}

/// `ls-files` quotes a name containing a `"` even with `core.quotePath=false`,
/// and the quoted form is not a usable filesystem path: reading it failed and
/// took every other file in the worktree down with it.
#[test]
fn lists_an_untracked_path_whose_name_contains_a_quote() {
    let repo = TempRepo::new();
    repo.write("tracked.txt", "t\n");
    repo.commit_all("base");
    repo.write("tracked.txt", "T\n");
    repo.write("unt\"racked.txt", "u\n");

    assert_eq!(
        worktree_paths(&repo),
        vec!["tracked.txt".to_string(), "unt\"racked.txt".to_string()]
    );
}

/// An untracked nested repo (`vendor/`, `.venv/`) is reported by `ls-files` as
/// a directory, and a dangling symlink cannot be read at all: neither may take
/// the rest of the worktree with it.
#[test]
fn keeps_the_worktree_diff_when_an_untracked_entry_cannot_be_read() {
    let repo = TempRepo::new();
    repo.write("tracked.txt", "t\n");
    repo.commit_all("base");
    repo.write("tracked.txt", "T\n");
    TempRepo::init_at(repo.path().join("vendor/nested"));
    repo.write("vendor/nested/inner.txt", "i\n");
    symlink("/nonexistent/target", repo.path().join("broken.link")).expect("create symlink");

    let paths = worktree_paths(&repo);

    assert!(
        paths.contains(&"tracked.txt".to_string()),
        "the tracked change must survive, got {paths:?}"
    );
    assert!(
        !paths.iter().any(|p| p.ends_with('/')),
        "a directory is not a reviewable file, got {paths:?}"
    );
}

/// `rev-parse --is-inside-work-tree` succeeds inside `.git/` and prints
/// `false`, so the exit code alone let the directory through and git's English
/// `fatal:` reached the user instead of the typed error.
#[test]
fn rejects_the_dot_git_directory_as_a_repository() {
    let repo = TempRepo::new();
    repo.write("tracked.txt", "t\n");
    repo.commit_all("base");

    let scope = Scope::Worktree {
        repo: repo.path().join(".git").to_string_lossy().into_owned(),
    };

    let err = diff_for_scope(&scope).expect_err("the .git directory is not a worktree");
    assert!(
        matches!(err, GitError::NotAGitRepo(_)),
        "expected GitError::NotAGitRepo, got {err:?}"
    );
}

/// A single file whose name is not valid UTF-8 used to fail the whole scope.
/// Showing that one name with a replacement character is the lesser evil.
#[test]
fn keeps_the_worktree_diff_when_a_path_is_not_valid_utf8() {
    let repo = TempRepo::new();
    let tracked_odd = OsStr::from_bytes(b"tracked\xff.txt");
    std::fs::write(repo.path().join(tracked_odd), "v1\n").expect("write a non-utf8 name");
    repo.write("tracked.txt", "t\n");
    repo.commit_all("base");
    std::fs::write(repo.path().join(tracked_odd), "v2\n").expect("modify a non-utf8 name");
    repo.write("tracked.txt", "T\n");
    let untracked_odd = OsStr::from_bytes(b"untracked\xff.txt");
    std::fs::write(repo.path().join(untracked_odd), "u\n").expect("write a non-utf8 name");

    let paths = worktree_paths(&repo);

    assert_eq!(
        paths,
        vec![
            "tracked.txt".to_string(),
            "tracked\u{fffd}.txt".to_string(),
            "untracked\u{fffd}.txt".to_string(),
        ]
    );
}

/// git stores a symlink's target as the blob body, so that is what a review
/// shows. Following the link instead would pull a file from outside the repo
/// into the review, which is exactly what `read_blob` refuses to do.
#[test]
fn shows_an_untracked_symlink_as_its_target_not_as_the_file_it_points_at() {
    let outside = temp_dir_outside_home();
    let secret = canonical(outside.path()).join("secret.txt");
    std::fs::write(&secret, "classified\n").expect("write secret");
    let repo = TempRepo::new();
    repo.write("tracked.txt", "t\n");
    repo.commit_all("base");
    symlink(&secret, repo.path().join("leak.link")).expect("create symlink");

    let files = diff_for_scope(&Scope::Worktree {
        repo: repo.path_str(),
    })
    .expect("worktree diff");

    let link = files
        .iter()
        .find(|f| f.path == "leak.link")
        .expect("the symlink is listed");
    assert_eq!(
        shape(link),
        vec![(
            LineKind::Add,
            None,
            Some(1),
            secret.to_string_lossy().into_owned()
        )]
    );
}

/// `get_diff` names files relative to the repo root, so `read_blob` has to
/// resolve them from there too: anchored at the subdirectory the new side came
/// back empty, which reads as "the whole file was deleted".
#[test]
fn reads_both_sides_from_the_repo_root_when_the_scope_points_at_a_subdirectory() {
    let repo = TempRepo::new();
    repo.write("sub/tracked.txt", "v1\n");
    repo.commit_all("base");
    repo.write("sub/tracked.txt", "v2\n");

    let scope = Scope::Worktree {
        repo: repo.path().join("sub").to_string_lossy().into_owned(),
    };
    let path = &diff_for_scope(&scope).expect("worktree diff")[0].path;
    assert_eq!(path, "sub/tracked.txt");

    assert_eq!(
        read_blob(&scope, path, Side::New).expect("new side"),
        "v2\n"
    );
    assert_eq!(
        read_blob(&scope, path, Side::Old).expect("old side"),
        "v1\n"
    );
}

#[test]
fn refuses_to_read_a_blob_through_a_symlink_that_leaves_the_repo() {
    let outside = temp_dir_outside_home();
    std::fs::write(outside.path().join("secret.txt"), "classified\n").expect("write secret");
    let repo = TempRepo::new();
    repo.write("app.ts", "const a = 1;\n");
    repo.commit_all("base");
    symlink(canonical(outside.path()), repo.path().join("link")).expect("create symlink");

    let err = read_blob(
        &Scope::Worktree {
            repo: repo.path_str(),
        },
        "link/secret.txt",
        Side::New,
    )
    .expect_err("a symlink out of the repo must be rejected");

    assert!(
        matches!(err, GitError::PathOutsideRepo(_)),
        "expected GitError::PathOutsideRepo, got {err:?}"
    );
}

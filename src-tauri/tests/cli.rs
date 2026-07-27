//! TS-14 — `argv` + cwd resolved into a startup decision, against real git
//! repositories: the two entry doors (`reviewer …` and the pick screen) must
//! agree on the very same `Scope` the git layer already speaks.

mod helpers;

use std::fs;

use helpers::git_fixture::{canonical, path_str, TempRepo};
use local_reviewer_lib::cli::{parse_args, Startup, StartupInfo};
use local_reviewer_lib::git::{GitError, Scope};
use serde_json::json;
use tempfile::TempDir;

fn args(list: &[&str]) -> Vec<String> {
    list.iter().map(|arg| arg.to_string()).collect()
}

/// A repo with three commits, oldest first in the returned vector.
fn repo_with_history() -> (TempRepo, Vec<String>) {
    let repo = TempRepo::new();
    let mut shas = Vec::new();
    for (index, content) in ["one\n", "two\n", "three\n"].iter().enumerate() {
        repo.write("a.txt", content);
        shas.push(repo.commit_all(&format!("commit {index}")));
    }
    (repo, shas)
}

fn plain_dir() -> TempDir {
    TempDir::new().expect("create temp dir")
}

#[test]
fn ts14_no_arguments_inside_a_repo_reviews_the_worktree() {
    let (repo, _shas) = repo_with_history();

    let startup = parse_args(&args(&[]), &repo.path_str()).expect("no args inside a repo");

    assert_eq!(
        startup,
        Startup::Review(Scope::Worktree {
            repo: repo.path_str()
        })
    );
}

#[test]
fn ts14_no_arguments_in_a_subdirectory_reviews_the_repo_root() {
    let (repo, _shas) = repo_with_history();
    let subdir = repo.path().join("src").join("deep");
    fs::create_dir_all(&subdir).expect("create subdir");

    let startup = parse_args(&args(&[]), &path_str(&subdir)).expect("no args in a subdirectory");

    assert_eq!(
        startup,
        Startup::Review(Scope::Worktree {
            repo: repo.path_str()
        }),
        "the scope must carry the repo root, not the cwd"
    );
}

#[test]
fn ts14_a_commit_argument_reviews_that_commit_from_the_repo_root() {
    let (repo, shas) = repo_with_history();
    let subdir = repo.path().join("src");
    fs::create_dir_all(&subdir).expect("create subdir");

    let startup = parse_args(&args(&[&shas[0]]), &path_str(&subdir)).expect("a sha inside a repo");

    assert_eq!(
        startup,
        Startup::Review(Scope::Commit {
            repo: repo.path_str(),
            sha: shas[0].clone(),
        })
    );
}

#[test]
fn ts14_a_range_argument_reviews_the_accumulated_range() {
    let (repo, shas) = repo_with_history();
    let range = format!("{}..{}", shas[0], shas[2]);

    let startup = parse_args(&args(&[&range]), &repo.path_str()).expect("a..b inside a repo");

    assert_eq!(
        startup,
        Startup::Review(Scope::Range {
            repo: repo.path_str(),
            from: shas[0].clone(),
            to: shas[2].clone(),
        })
    );
}

#[test]
fn ts14_no_arguments_outside_a_repo_asks_for_a_pick() {
    let dir = plain_dir();

    let startup =
        parse_args(&args(&[]), &path_str(canonical(dir.path()))).expect("no args outside a repo");

    assert_eq!(startup, Startup::Pick);
}

#[test]
fn ts14_an_unknown_ref_fails_with_a_typed_actionable_error() {
    let (repo, _shas) = repo_with_history();

    let err = parse_args(&args(&["no-such-ref"]), &repo.path_str())
        .expect_err("an unknown ref must not resolve to a scope");

    assert!(
        matches!(&err, GitError::BadRef(reference) if reference == "no-such-ref"),
        "expected GitError::BadRef(\"no-such-ref\"), got {err:?}"
    );
    let message = err.to_string();
    assert!(
        message.contains("no-such-ref"),
        "the message must name the ref: {message}"
    );
    assert!(
        message.contains("does not exist"),
        "the message must say the ref does not exist: {message}"
    );
}

#[test]
fn ts14_a_range_with_a_missing_endpoint_fails_with_bad_ref() {
    let (repo, shas) = repo_with_history();

    let missing_right = format!("{}..nope", shas[0]);
    let err = parse_args(&args(&[&missing_right]), &repo.path_str())
        .expect_err("a range whose right side does not exist must fail");
    assert!(
        matches!(&err, GitError::BadRef(reference) if reference == "nope"),
        "expected GitError::BadRef(\"nope\"), got {err:?}"
    );

    let missing_left = format!("nope..{}", shas[2]);
    let err = parse_args(&args(&[&missing_left]), &repo.path_str())
        .expect_err("a range whose left side does not exist must fail");
    assert!(
        matches!(&err, GitError::BadRef(reference) if reference == "nope"),
        "expected GitError::BadRef(\"nope\"), got {err:?}"
    );
}

#[test]
fn ts14_a_ref_that_is_also_a_file_name_still_resolves_as_a_commit() {
    let repo = TempRepo::new();
    repo.write("build", "a tracked file named like the branch\n");
    repo.commit_all("first");
    repo.git(&["branch", "build"]);

    let startup =
        parse_args(&args(&["build"]), &repo.path_str()).expect("an ambiguous name must resolve");

    assert_eq!(
        startup,
        Startup::Review(Scope::Commit {
            repo: repo.path_str(),
            sha: "build".to_string(),
        }),
        "the ref is kept as the user typed it and read as a revision, not as a path"
    );
}

#[test]
fn ts14_extra_arguments_are_reported_instead_of_silently_ignored() {
    let (repo, shas) = repo_with_history();

    let err = parse_args(&args(&[&shas[0], &shas[1]]), &repo.path_str())
        .expect_err("two positional arguments are not a valid invocation");

    let message = err.to_string();
    assert!(
        message.contains(&shas[1]),
        "the message must name the extra argument «{}»: {message}",
        shas[1]
    );
}

#[test]
fn ts14_help_returns_the_usage_text_without_needing_a_repo() {
    let dir = plain_dir();
    let cwd = path_str(canonical(dir.path()));

    for flag in ["--help", "-h"] {
        let startup = parse_args(&args(&[flag]), &cwd)
            .unwrap_or_else(|e| panic!("{flag} must not fail outside a repo: {e}"));

        let Startup::Help(usage) = startup else {
            panic!("expected Startup::Help for {flag}, got {startup:?}");
        };
        for fragment in [
            "reviewer",
            "<commit>",
            "<a>..<b>",
            "no arguments",
            "repository picker",
        ] {
            assert!(
                usage.contains(fragment),
                "the usage of {flag} must document \"{fragment}\":\n{usage}"
            );
        }
    }
}

#[test]
fn ts14_a_cwd_that_no_longer_exists_falls_back_to_the_pick_screen() {
    let dir = plain_dir();
    let gone = path_str(canonical(dir.path()));
    drop(dir);

    let startup =
        parse_args(&args(&[]), &gone).expect("a vanished cwd must not blow up the startup");

    assert_eq!(startup, Startup::Pick);
}

#[test]
fn ts14_a_ref_outside_a_repo_fails_instead_of_opening_the_picker() {
    let dir = plain_dir();
    let cwd = path_str(canonical(dir.path()));

    let err = parse_args(&args(&["HEAD"]), &cwd)
        .expect_err("an explicit ref outside a repo must not be dropped on the floor");

    assert!(
        matches!(err, GitError::NotAGitRepo(_)),
        "expected GitError::NotAGitRepo, got {err:?}"
    );
}

#[test]
fn ts14_startup_info_matches_the_typescript_shape() {
    let with_scope = StartupInfo {
        scope: Some(Scope::Worktree {
            repo: "/home/dev/p".to_string(),
        }),
        home: "/home/dev".to_string(),
    };
    assert_eq!(
        serde_json::to_value(&with_scope).expect("serialise"),
        json!({
            "scope": { "kind": "worktree", "repo": "/home/dev/p" },
            "home": "/home/dev",
        })
    );

    let pick = StartupInfo {
        scope: None,
        home: "/home/dev".to_string(),
    };
    assert_eq!(
        serde_json::to_value(&pick).expect("serialise"),
        json!({ "scope": null, "home": "/home/dev" })
    );
}

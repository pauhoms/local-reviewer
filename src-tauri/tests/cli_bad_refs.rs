//! What `reviewer <arg>` does with an argument that looks like a revision but
//! is not one: the failure has to be named on the startup screen, not deferred
//! to `get_diff` where git's own usage text ends up in front of the user.

mod helpers;

use helpers::git_fixture::{canonical, path_str, TempRepo};
use reviewv4_lib::cli::{parse_args, Startup};
use reviewv4_lib::git::{diff, GitError, Scope};
use tempfile::TempDir;

fn args(list: &[&str]) -> Vec<String> {
    list.iter().map(|arg| arg.to_string()).collect()
}

fn repo_with_a_file() -> TempRepo {
    let repo = TempRepo::new();
    repo.write("a.txt", "one\n");
    repo.commit_all("first");
    repo
}

#[test]
fn a_blob_is_reported_as_a_ref_that_is_not_a_commit() {
    let repo = repo_with_a_file();

    let err = parse_args(&args(&["HEAD:a.txt"]), &repo.path_str())
        .expect_err("a blob is not something to review");

    assert!(
        matches!(&err, GitError::NotACommit(named) if named == "HEAD:a.txt"),
        "got {err:?}"
    );
    let message = err.to_string();
    assert!(
        !message.contains("no existe"),
        "the blob does exist; saying otherwise sends the user hunting for a typo: {message}"
    );
    assert!(
        message.contains("HEAD:a.txt") && message.contains("commit"),
        "the message must name the ref and what is wrong with it: {message}"
    );
}

#[test]
fn a_tree_is_reported_as_a_ref_that_is_not_a_commit() {
    let repo = repo_with_a_file();

    let err = parse_args(&args(&["HEAD^{tree}"]), &repo.path_str())
        .expect_err("a tree is not something to review");

    assert!(
        matches!(&err, GitError::NotACommit(named) if named == "HEAD^{tree}"),
        "got {err:?}"
    );
}

#[test]
fn a_ref_that_resolves_to_nothing_at_all_is_still_reported_as_missing() {
    let repo = repo_with_a_file();

    let err = parse_args(&args(&["no-such-ref"]), &repo.path_str())
        .expect_err("an unknown ref must not resolve to a scope");

    assert!(
        matches!(&err, GitError::BadRef(named) if named == "no-such-ref"),
        "got {err:?}"
    );
    assert!(err.to_string().contains("no existe"), "{err}");
}

#[test]
fn a_range_endpoint_that_is_not_a_commit_is_rejected_before_any_diff_runs() {
    let repo = repo_with_a_file();
    let range = "HEAD..HEAD:a.txt";

    let err = parse_args(&args(&[range]), &repo.path_str())
        .expect_err("a range that ends in a blob is not reviewable");

    assert!(
        matches!(&err, GitError::NotACommit(named) if named == "HEAD:a.txt"),
        "got {err:?}"
    );
}

#[test]
fn an_annotated_tag_still_reviews_the_commit_it_points_at() {
    let repo = repo_with_a_file();
    repo.git(&["tag", "--annotate", "v1", "--message", "release"]);

    let startup = parse_args(&args(&["v1"]), &repo.path_str()).expect("a tag names a commit");

    assert_eq!(
        startup,
        Startup::Review(Scope::Commit {
            repo: repo.path_str(),
            sha: "v1".to_string(),
        })
    );
    diff::diff_for_scope(&Scope::Commit {
        repo: repo.path_str(),
        sha: "v1".to_string(),
    })
    .expect("the scope the startup accepted must be readable");
}

#[test]
fn a_three_dot_range_names_the_whole_argument_the_user_typed() {
    let repo = repo_with_a_file();

    let err = parse_args(&args(&["HEAD~1...HEAD"]), &repo.path_str())
        .expect_err("a symmetric difference is not a range this tool reviews");

    assert!(
        matches!(&err, GitError::BadRef(named) if named == "HEAD~1...HEAD"),
        "the error must name what the user typed, got {err:?}"
    );
}

#[test]
fn a_spec_with_more_than_one_range_separator_names_the_whole_argument() {
    let repo = repo_with_a_file();

    let err = parse_args(&args(&["a..b..c"]), &repo.path_str())
        .expect_err("two separators are not a range");

    assert!(
        matches!(&err, GitError::BadRef(named) if named == "a..b..c"),
        "got {err:?}"
    );
}

#[test]
fn outside_a_repo_a_malformed_ref_complains_about_the_missing_repo() {
    let dir = TempDir::new().expect("create temp dir");
    let cwd = path_str(canonical(dir.path()));

    for spec in ["", "HEAD~1...HEAD"] {
        let err = parse_args(&args(&[spec]), &cwd)
            .expect_err("there is no repository to resolve anything against");
        assert!(
            matches!(&err, GitError::NotAGitRepo(named) if named == &cwd),
            "expected NotAGitRepo for {spec:?}, got {err:?}"
        );
    }
}

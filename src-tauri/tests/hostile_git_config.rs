//! git's output shape is configurable, and not only by the person running the
//! app: the reviewed repo carries its own `.git/config` and `.gitattributes`.
//! Every option here is set on the fixture repo — exactly how a user's
//! `~/.gitconfig` would reach us — and the layer must produce the same result
//! as with git's defaults.

mod helpers;

use helpers::git_fixture::TempRepo;
use reviewv4_lib::git::diff::diff_for_scope;
use reviewv4_lib::git::{FileDiff, LineKind, Scope};

fn worktree(repo: &TempRepo) -> Vec<FileDiff> {
    diff_for_scope(&Scope::Worktree {
        repo: repo.path_str(),
    })
    .expect("worktree diff")
}

fn sorted_paths(files: &[FileDiff]) -> Vec<String> {
    let mut paths: Vec<String> = files.iter().map(|f| f.path.clone()).collect();
    paths.sort();
    paths
}

fn shape(file: &FileDiff) -> Vec<(LineKind, String)> {
    file.hunks
        .iter()
        .flat_map(|h| h.lines.iter())
        .map(|l| (l.kind, l.content.clone()))
        .collect()
}

/// `diff.external` replaces git's whole diff output with a third-party tool's:
/// the app reported "no changes" over a dirty repo.
#[test]
fn diffs_a_dirty_repo_even_when_an_external_diff_driver_is_configured() {
    let repo = TempRepo::new();
    repo.write("tracked.txt", "v1\n");
    repo.commit_all("base");
    repo.write("tracked.txt", "v2\n");
    repo.git(&["config", "diff.external", "/bin/echo"]);

    let files = worktree(&repo);

    assert_eq!(sorted_paths(&files), vec!["tracked.txt".to_string()]);
    assert_eq!(
        shape(&files[0]),
        vec![
            (LineKind::Del, "v1".to_string()),
            (LineKind::Add, "v2".to_string()),
        ]
    );
}

/// A `textconv` driver is declared by the reviewed repo's own `.gitattributes`,
/// so it needs no user config at all to replace every line under review.
#[test]
fn reviews_the_real_lines_even_when_the_repo_declares_a_textconv_driver() {
    let repo = TempRepo::new();
    repo.write(".gitattributes", "*.txt diff=fake\n");
    repo.git(&["config", "diff.fake.textconv", "/bin/echo"]);
    repo.write("tracked.txt", "v1\n");
    repo.commit_all("base");
    repo.write("tracked.txt", "v2\n");

    let files = worktree(&repo);

    let tracked = files
        .iter()
        .find(|f| f.path == "tracked.txt")
        .expect("tracked.txt is listed");
    assert_eq!(
        shape(tracked),
        vec![
            (LineKind::Del, "v1".to_string()),
            (LineKind::Add, "v2".to_string()),
        ]
    );
}

/// With `diff.mnemonicPrefix` git writes `c/…` and `w/…` instead of `a/…` and
/// `b/…`, and the prefix ended up glued to every path.
#[test]
fn names_files_the_same_way_when_mnemonic_prefixes_are_configured() {
    let repo = TempRepo::new();
    repo.write("tracked.txt", "v1\n");
    repo.commit_all("base");
    repo.write("tracked.txt", "v2\n");
    repo.git(&["config", "diff.mnemonicPrefix", "true"]);

    assert_eq!(
        sorted_paths(&worktree(&repo)),
        vec!["tracked.txt".to_string()]
    );
}

/// `diff.noprefix` drops the prefix altogether, which silently beheads any file
/// that really lives under a directory called `b/`.
#[test]
fn names_files_the_same_way_when_the_prefix_is_configured_away() {
    let repo = TempRepo::new();
    repo.write("b/x.txt", "v1\n");
    repo.commit_all("base");
    repo.write("b/x.txt", "v2\n");
    repo.git(&["config", "diff.noprefix", "true"]);

    assert_eq!(sorted_paths(&worktree(&repo)), vec!["b/x.txt".to_string()]);
}

/// `diff.suppressBlankEmpty` prints a blank context line with no leading space,
/// which used to end the hunk early and drop every line after it.
#[test]
fn keeps_the_lines_after_a_blank_context_line_when_its_marker_is_suppressed() {
    let repo = TempRepo::new();
    repo.write("tracked.txt", "l1\n\nl3\nl4\n");
    repo.commit_all("base");
    repo.write("tracked.txt", "l1\n\nl3\nL4\n");
    repo.git(&["config", "diff.suppressBlankEmpty", "true"]);

    let files = worktree(&repo);

    assert_eq!(
        shape(&files[0]),
        vec![
            (LineKind::Context, "l1".to_string()),
            (LineKind::Context, String::new()),
            (LineKind::Context, "l3".to_string()),
            (LineKind::Del, "l4".to_string()),
            (LineKind::Add, "L4".to_string()),
        ]
    );
}

/// `diff.relative` makes git report paths relative to the cwd *and* hide
/// everything above it, so a scope pointed at a subdirectory would lose files.
#[test]
fn names_files_from_the_repo_root_when_diff_relative_is_configured() {
    let repo = TempRepo::new();
    repo.write("sub/tracked.txt", "v1\n");
    repo.write("root.txt", "r1\n");
    repo.commit_all("base");
    repo.write("sub/tracked.txt", "v2\n");
    repo.write("root.txt", "r2\n");
    let sha = repo.commit_all("second");
    repo.git(&["config", "diff.relative", "true"]);

    let sub = repo.path().join("sub").to_string_lossy().into_owned();
    let expected = vec!["root.txt".to_string(), "sub/tracked.txt".to_string()];

    let commit = diff_for_scope(&Scope::Commit {
        repo: sub.clone(),
        sha: sha.clone(),
    })
    .expect("commit diff from a subdirectory");
    assert_eq!(sorted_paths(&commit), expected);

    let range = diff_for_scope(&Scope::Range {
        repo: sub,
        from: sha.clone(),
        to: sha,
    })
    .expect("range diff from a subdirectory");
    assert_eq!(sorted_paths(&range), expected);
}

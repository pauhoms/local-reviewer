mod helpers;

use helpers::git_fixture::TempRepo;
use reviewv4_lib::git::diff::diff_for_scope;
use reviewv4_lib::git::{FileDiff, FileStatus, LineKind, Scope};

fn file<'a>(files: &'a [FileDiff], path: &str) -> &'a FileDiff {
    files
        .iter()
        .find(|f| f.path == path)
        .unwrap_or_else(|| panic!("no FileDiff for {path}; got {:?}", sorted_paths(files)))
}

fn sorted_paths(files: &[FileDiff]) -> Vec<String> {
    let mut paths: Vec<String> = files.iter().map(|f| f.path.clone()).collect();
    paths.sort();
    paths
}

fn shape(file: &FileDiff) -> Vec<(LineKind, Option<u32>, Option<u32>, String)> {
    file.hunks
        .iter()
        .flat_map(|h| h.lines.iter())
        .map(|l| (l.kind, l.old_no, l.new_no, l.content.clone()))
        .collect()
}

/// base commit + one staged change, one unstaged change, one worktree deletion
/// and one untracked file.
fn dirty_repo() -> TempRepo {
    let repo = TempRepo::new();
    repo.write("staged.txt", "l1\nl2\nl3\nl4\nl5\n");
    repo.write("unstaged.txt", "u1\nu2\nu3\n");
    repo.write("gone.txt", "g1\ng2\n");
    repo.commit_all("base");

    repo.write("staged.txt", "l1\nl2\nl3-changed\nl4\nl5\n");
    repo.add("staged.txt");
    repo.write("unstaged.txt", "u1\nu2-changed\nu3\n");
    repo.remove("gone.txt");
    repo.write("untracked.txt", "n1\nn2\nn3\n");
    repo
}

#[test]
fn ts02_worktree_lists_staged_unstaged_untracked_and_deleted_files() {
    let repo = dirty_repo();
    let files = diff_for_scope(&Scope::Worktree {
        repo: repo.path_str(),
    })
    .expect("worktree diff");

    assert_eq!(
        sorted_paths(&files),
        vec![
            "gone.txt".to_string(),
            "staged.txt".to_string(),
            "unstaged.txt".to_string(),
            "untracked.txt".to_string(),
        ]
    );

    assert_eq!(file(&files, "staged.txt").status, FileStatus::Modified);
    assert_eq!(file(&files, "unstaged.txt").status, FileStatus::Modified);
    assert_eq!(file(&files, "gone.txt").status, FileStatus::Deleted);
    assert_eq!(file(&files, "untracked.txt").status, FileStatus::Added);
}

#[test]
fn ts02_worktree_reports_hunks_and_line_numbers_of_the_staged_change() {
    let repo = dirty_repo();
    let files = diff_for_scope(&Scope::Worktree {
        repo: repo.path_str(),
    })
    .expect("worktree diff");
    let staged = file(&files, "staged.txt");

    assert_eq!(staged.additions, 1);
    assert_eq!(staged.deletions, 1);
    assert_eq!(staged.hunks.len(), 1);
    assert_eq!(staged.hunks[0].header, "@@ -1,5 +1,5 @@");
    assert_eq!(staged.hunks[0].old_start, 1);
    assert_eq!(staged.hunks[0].old_lines, 5);
    assert_eq!(staged.hunks[0].new_start, 1);
    assert_eq!(staged.hunks[0].new_lines, 5);

    assert_eq!(
        shape(staged),
        vec![
            (LineKind::Context, Some(1), Some(1), "l1".to_string()),
            (LineKind::Context, Some(2), Some(2), "l2".to_string()),
            (LineKind::Del, Some(3), None, "l3".to_string()),
            (LineKind::Add, None, Some(3), "l3-changed".to_string()),
            (LineKind::Context, Some(4), Some(4), "l4".to_string()),
            (LineKind::Context, Some(5), Some(5), "l5".to_string()),
        ]
    );
}

#[test]
fn ts02_worktree_reports_hunks_and_line_numbers_of_the_unstaged_change() {
    let repo = dirty_repo();
    let files = diff_for_scope(&Scope::Worktree {
        repo: repo.path_str(),
    })
    .expect("worktree diff");
    let unstaged = file(&files, "unstaged.txt");

    assert_eq!(unstaged.additions, 1);
    assert_eq!(unstaged.deletions, 1);
    assert_eq!(unstaged.hunks.len(), 1);
    assert_eq!(unstaged.hunks[0].header, "@@ -1,3 +1,3 @@");

    assert_eq!(
        shape(unstaged),
        vec![
            (LineKind::Context, Some(1), Some(1), "u1".to_string()),
            (LineKind::Del, Some(2), None, "u2".to_string()),
            (LineKind::Add, None, Some(2), "u2-changed".to_string()),
            (LineKind::Context, Some(3), Some(3), "u3".to_string()),
        ]
    );
}

#[test]
fn ts02_worktree_reports_the_deleted_file_with_all_lines_as_del() {
    let repo = dirty_repo();
    let files = diff_for_scope(&Scope::Worktree {
        repo: repo.path_str(),
    })
    .expect("worktree diff");
    let gone = file(&files, "gone.txt");

    assert_eq!(gone.status, FileStatus::Deleted);
    assert_eq!(gone.additions, 0);
    assert_eq!(gone.deletions, 2);
    assert_eq!(gone.hunks.len(), 1);
    assert_eq!(gone.hunks[0].old_start, 1);
    assert_eq!(gone.hunks[0].old_lines, 2);
    assert_eq!(gone.hunks[0].new_lines, 0);

    assert_eq!(
        shape(gone),
        vec![
            (LineKind::Del, Some(1), None, "g1".to_string()),
            (LineKind::Del, Some(2), None, "g2".to_string()),
        ]
    );
}

#[test]
fn ts02_worktree_reports_the_untracked_file_as_added_with_all_lines_as_add() {
    let repo = dirty_repo();
    let files = diff_for_scope(&Scope::Worktree {
        repo: repo.path_str(),
    })
    .expect("worktree diff");
    let untracked = file(&files, "untracked.txt");

    assert_eq!(untracked.status, FileStatus::Added);
    assert_eq!(untracked.old_path, None);
    assert_eq!(untracked.additions, 3);
    assert_eq!(untracked.deletions, 0);
    assert_eq!(untracked.hunks.len(), 1);
    assert_eq!(untracked.hunks[0].old_start, 0);
    assert_eq!(untracked.hunks[0].old_lines, 0);
    assert_eq!(untracked.hunks[0].new_start, 1);
    assert_eq!(untracked.hunks[0].new_lines, 3);

    assert_eq!(
        shape(untracked),
        vec![
            (LineKind::Add, None, Some(1), "n1".to_string()),
            (LineKind::Add, None, Some(2), "n2".to_string()),
            (LineKind::Add, None, Some(3), "n3".to_string()),
        ]
    );
}

/// c1 base · c2 edits keep.txt · c3 adds added.txt · c4 deletes doomed.txt
fn history_repo() -> (TempRepo, Vec<String>) {
    let repo = TempRepo::new();
    repo.write("keep.txt", "a\nb\nc\n");
    repo.write("doomed.txt", "one\ntwo\n");
    let c1 = repo.commit_all("c1: base");

    repo.write("keep.txt", "a\nB\nc\n");
    let c2 = repo.commit_all("c2: change keep");

    repo.write("added.txt", "x\ny\n");
    let c3 = repo.commit_all("c3: add file");

    repo.remove("doomed.txt");
    let c4 = repo.commit_all("c4: delete doomed");

    (repo, vec![c1, c2, c3, c4])
}

#[test]
fn ts03_commit_scope_returns_only_that_commits_changes() {
    let (repo, shas) = history_repo();
    let files = diff_for_scope(&Scope::Commit {
        repo: repo.path_str(),
        sha: shas[2].clone(),
    })
    .expect("commit diff");

    assert_eq!(sorted_paths(&files), vec!["added.txt".to_string()]);
    let added = file(&files, "added.txt");
    assert_eq!(added.status, FileStatus::Added);
    assert_eq!(added.additions, 2);
    assert_eq!(added.deletions, 0);
    assert_eq!(
        shape(added),
        vec![
            (LineKind::Add, None, Some(1), "x".to_string()),
            (LineKind::Add, None, Some(2), "y".to_string()),
        ]
    );
}

#[test]
fn ts03_commit_scope_returns_the_deletion_of_the_last_commit() {
    let (repo, shas) = history_repo();
    let files = diff_for_scope(&Scope::Commit {
        repo: repo.path_str(),
        sha: shas[3].clone(),
    })
    .expect("commit diff");

    assert_eq!(sorted_paths(&files), vec!["doomed.txt".to_string()]);
    let doomed = file(&files, "doomed.txt");
    assert_eq!(doomed.status, FileStatus::Deleted);
    assert_eq!(doomed.deletions, 2);
    assert_eq!(
        shape(doomed),
        vec![
            (LineKind::Del, Some(1), None, "one".to_string()),
            (LineKind::Del, Some(2), None, "two".to_string()),
        ]
    );
}

#[test]
fn ts03_commit_scope_works_for_the_root_commit() {
    let (repo, shas) = history_repo();
    let files = diff_for_scope(&Scope::Commit {
        repo: repo.path_str(),
        sha: shas[0].clone(),
    })
    .expect("root commit diff");

    assert_eq!(
        sorted_paths(&files),
        vec!["doomed.txt".to_string(), "keep.txt".to_string()]
    );

    let keep = file(&files, "keep.txt");
    assert_eq!(keep.status, FileStatus::Added);
    assert_eq!(keep.additions, 3);
    assert_eq!(keep.deletions, 0);
    assert_eq!(
        shape(keep),
        vec![
            (LineKind::Add, None, Some(1), "a".to_string()),
            (LineKind::Add, None, Some(2), "b".to_string()),
            (LineKind::Add, None, Some(3), "c".to_string()),
        ]
    );

    let doomed = file(&files, "doomed.txt");
    assert_eq!(doomed.status, FileStatus::Added);
    assert_eq!(doomed.additions, 2);
}

#[test]
fn ts04_range_scope_accumulates_from_the_parent_of_the_oldest_commit() {
    let (repo, shas) = history_repo();
    let files = diff_for_scope(&Scope::Range {
        repo: repo.path_str(),
        from: shas[1].clone(),
        to: shas[3].clone(),
    })
    .expect("range diff");

    assert_eq!(
        sorted_paths(&files),
        vec![
            "added.txt".to_string(),
            "doomed.txt".to_string(),
            "keep.txt".to_string(),
        ]
    );

    // keep.txt only changed in `from` itself: it is in the diff because the
    // range starts at `from^`, not at `from`.
    let keep = file(&files, "keep.txt");
    assert_eq!(keep.status, FileStatus::Modified);
    assert_eq!(keep.additions, 1);
    assert_eq!(keep.deletions, 1);
    assert_eq!(keep.hunks.len(), 1);
    assert_eq!(keep.hunks[0].header, "@@ -1,3 +1,3 @@");
    assert_eq!(
        shape(keep),
        vec![
            (LineKind::Context, Some(1), Some(1), "a".to_string()),
            (LineKind::Del, Some(2), None, "b".to_string()),
            (LineKind::Add, None, Some(2), "B".to_string()),
            (LineKind::Context, Some(3), Some(3), "c".to_string()),
        ]
    );

    let added = file(&files, "added.txt");
    assert_eq!(added.status, FileStatus::Added);
    assert_eq!(added.additions, 2);
}

#[test]
fn ts04_range_scope_reports_a_file_deleted_inside_the_range_as_deleted() {
    let (repo, shas) = history_repo();
    let files = diff_for_scope(&Scope::Range {
        repo: repo.path_str(),
        from: shas[1].clone(),
        to: shas[3].clone(),
    })
    .expect("range diff");

    let doomed = file(&files, "doomed.txt");
    assert_eq!(doomed.status, FileStatus::Deleted);
    assert_eq!(doomed.additions, 0);
    assert_eq!(doomed.deletions, 2);
    assert_eq!(doomed.hunks.len(), 1);
    assert_eq!(doomed.hunks[0].old_start, 1);
    assert_eq!(doomed.hunks[0].old_lines, 2);
    assert_eq!(doomed.hunks[0].new_lines, 0);
    assert_eq!(
        shape(doomed),
        vec![
            (LineKind::Del, Some(1), None, "one".to_string()),
            (LineKind::Del, Some(2), None, "two".to_string()),
        ]
    );
}

#[test]
fn ts05_clean_worktree_yields_an_empty_diff_instead_of_an_error() {
    let repo = TempRepo::new();
    repo.write("only.txt", "a\nb\n");
    repo.commit_all("base");

    let files = diff_for_scope(&Scope::Worktree {
        repo: repo.path_str(),
    })
    .expect("clean worktree must not error");

    assert_eq!(files, Vec::new());
}

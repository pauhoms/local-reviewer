mod helpers;

use helpers::git_fixture::{path_str, TempRepo};
use local_reviewer_lib::git::commits::list_commits;
use local_reviewer_lib::git::GitError;
use tempfile::TempDir;

fn repo_with_history() -> (TempRepo, Vec<String>) {
    let repo = TempRepo::new();
    repo.write("a.txt", "1\n");
    let c1 = repo.commit_all_at("first: add a", "2021-03-04T10:00:00+00:00");
    repo.write("b.txt", "2\n");
    let c2 = repo.commit_all_at("second: add b", "2021-03-05T11:30:00+00:00");
    repo.write("c.txt", "3\n");
    let c3 = repo.commit_all_at("third: add c", "2021-03-06T12:45:00+00:00");
    (repo, vec![c1, c2, c3])
}

#[test]
fn ts06_lists_commits_in_reverse_chronological_order() {
    let (repo, shas) = repo_with_history();
    let commits = list_commits(&repo.path_str(), 10).expect("list commits");

    assert_eq!(commits.len(), 3);
    assert_eq!(
        commits.iter().map(|c| c.hash.clone()).collect::<Vec<_>>(),
        vec![shas[2].clone(), shas[1].clone(), shas[0].clone()]
    );
    assert_eq!(
        commits
            .iter()
            .map(|c| c.subject.clone())
            .collect::<Vec<_>>(),
        vec![
            "third: add c".to_string(),
            "second: add b".to_string(),
            "first: add a".to_string(),
        ]
    );
}

#[test]
fn ts06_reports_hash_short_hash_author_and_date_of_each_commit() {
    let (repo, shas) = repo_with_history();
    let commits = list_commits(&repo.path_str(), 10).expect("list commits");

    let newest = &commits[0];
    assert_eq!(newest.hash, shas[2]);
    assert_eq!(newest.hash.len(), 40);
    assert!(
        newest.short_hash.len() >= 7 && newest.short_hash.len() < newest.hash.len(),
        "short_hash {:?} must be an abbreviation",
        newest.short_hash
    );
    assert!(
        newest.hash.starts_with(&newest.short_hash),
        "short_hash {:?} must prefix hash {:?}",
        newest.short_hash,
        newest.hash
    );
    assert!(
        newest.author.starts_with("Fixture User"),
        "author was {:?}",
        newest.author
    );
    assert!(
        newest.date.starts_with("2021-03-06"),
        "date was {:?}, expected the commit's ISO date first",
        newest.date
    );

    let oldest = &commits[2];
    assert_eq!(oldest.hash, shas[0]);
    assert!(
        oldest.date.starts_with("2021-03-04"),
        "date was {:?}, expected the commit's ISO date first",
        oldest.date
    );
}

#[test]
fn ts06_honours_the_limit_keeping_the_newest_commits() {
    let (repo, shas) = repo_with_history();
    let commits = list_commits(&repo.path_str(), 2).expect("list commits");

    assert_eq!(commits.len(), 2);
    assert_eq!(
        commits.iter().map(|c| c.hash.clone()).collect::<Vec<_>>(),
        vec![shas[2].clone(), shas[1].clone()]
    );
}

#[test]
fn ts06_returns_a_typed_error_for_a_path_that_is_not_a_git_repo() {
    let plain = TempDir::new().expect("temp dir");
    std::fs::write(plain.path().join("readme.txt"), "not a repo\n").expect("write file");

    let err = list_commits(&path_str(plain.path()), 10)
        .expect_err("a non-repo path must be a typed error, not a panic");

    assert!(
        matches!(err, GitError::NotAGitRepo(_)),
        "expected GitError::NotAGitRepo, got {err:?}"
    );
}

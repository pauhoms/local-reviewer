mod helpers;

use helpers::git_fixture::TempRepo;
use reviewv4_lib::git::blob::read_blob;
use reviewv4_lib::git::{Scope, Side};

const APP_V1: &str = "const a = 1;\nconst b = 2;\n";
const APP_V2: &str = "const a = 1;\nconst b = 22;\nconst c = 3;\n";
const NEW_V1: &str = "export const n = 1;\n";

/// c1 creates src/app.ts · c2 edits it and adds src/new.ts · c3 deletes src/new.ts
fn repo_with_history() -> (TempRepo, Vec<String>) {
    let repo = TempRepo::new();
    repo.write("src/app.ts", APP_V1);
    let c1 = repo.commit_all("c1: add app");

    repo.write("src/app.ts", APP_V2);
    repo.write("src/new.ts", NEW_V1);
    let c2 = repo.commit_all("c2: edit app, add new");

    repo.remove("src/new.ts");
    let c3 = repo.commit_all("c3: delete new");

    (repo, vec![c1, c2, c3])
}

#[test]
fn ts08_reads_the_whole_file_on_both_sides_of_a_commit() {
    let (repo, shas) = repo_with_history();
    let scope = Scope::Commit {
        repo: repo.path_str(),
        sha: shas[1].clone(),
    };

    assert_eq!(
        read_blob(&scope, "src/app.ts", Side::New).expect("new side"),
        APP_V2
    );
    assert_eq!(
        read_blob(&scope, "src/app.ts", Side::Old).expect("old side"),
        APP_V1
    );
}

#[test]
fn ts08_reads_the_working_tree_on_the_new_side_and_head_on_the_old_side() {
    let (repo, _shas) = repo_with_history();
    let working = "const a = 1;\nconst b = 999;\n";
    repo.write("src/app.ts", working);

    let scope = Scope::Worktree {
        repo: repo.path_str(),
    };

    assert_eq!(
        read_blob(&scope, "src/app.ts", Side::New).expect("working tree side"),
        working
    );
    assert_eq!(
        read_blob(&scope, "src/app.ts", Side::Old).expect("HEAD side"),
        APP_V2
    );
}

#[test]
fn ts08_returns_an_empty_old_side_for_a_file_added_in_a_commit() {
    let (repo, shas) = repo_with_history();
    let scope = Scope::Commit {
        repo: repo.path_str(),
        sha: shas[1].clone(),
    };

    assert_eq!(
        read_blob(&scope, "src/new.ts", Side::New).expect("new side"),
        NEW_V1
    );
    assert_eq!(
        read_blob(&scope, "src/new.ts", Side::Old).expect("old side of an added file"),
        ""
    );
}

#[test]
fn ts08_returns_an_empty_old_side_for_the_root_commit_and_for_untracked_files() {
    let (repo, shas) = repo_with_history();

    let root = Scope::Commit {
        repo: repo.path_str(),
        sha: shas[0].clone(),
    };
    assert_eq!(
        read_blob(&root, "src/app.ts", Side::New).expect("new side of the root commit"),
        APP_V1
    );
    assert_eq!(
        read_blob(&root, "src/app.ts", Side::Old).expect("old side of the root commit"),
        ""
    );

    let untracked = "export const fresh = true;\n";
    repo.write("src/fresh.ts", untracked);
    let worktree = Scope::Worktree {
        repo: repo.path_str(),
    };
    assert_eq!(
        read_blob(&worktree, "src/fresh.ts", Side::New).expect("new side of an untracked file"),
        untracked
    );
    assert_eq!(
        read_blob(&worktree, "src/fresh.ts", Side::Old).expect("old side of an untracked file"),
        ""
    );
}

#[test]
fn ts08_returns_an_empty_new_side_for_a_deleted_file() {
    let (repo, shas) = repo_with_history();

    let deleting_commit = Scope::Commit {
        repo: repo.path_str(),
        sha: shas[2].clone(),
    };
    assert_eq!(
        read_blob(&deleting_commit, "src/new.ts", Side::Old).expect("old side of a deleted file"),
        NEW_V1
    );
    assert_eq!(
        read_blob(&deleting_commit, "src/new.ts", Side::New).expect("new side of a deleted file"),
        ""
    );

    repo.remove("src/app.ts");
    let worktree = Scope::Worktree {
        repo: repo.path_str(),
    };
    assert_eq!(
        read_blob(&worktree, "src/app.ts", Side::Old).expect("old side of a worktree deletion"),
        APP_V2
    );
    assert_eq!(
        read_blob(&worktree, "src/app.ts", Side::New).expect("new side of a worktree deletion"),
        ""
    );
}

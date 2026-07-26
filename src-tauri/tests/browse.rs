mod helpers;

use std::fs;
use std::os::unix::fs::symlink;

use helpers::git_fixture::{
    canonical, path_str, temp_dir_in_home, temp_dir_outside_home, TempRepo,
};
use reviewv4_lib::git::browse::browse_dir;
use reviewv4_lib::git::{DirEntryInfo, GitError};

fn sorted(entries: Vec<DirEntryInfo>) -> Vec<DirEntryInfo> {
    let mut entries = entries;
    entries.sort_by(|a, b| a.name.cmp(&b.name));
    entries
}

#[test]
fn ts07_lists_subdirectories_under_home_flagging_git_repos() {
    let home_tmp = temp_dir_in_home();
    let base = canonical(home_tmp.path());
    fs::create_dir(base.join("alpha")).expect("create alpha");
    fs::create_dir(base.join("gamma")).expect("create gamma");
    fs::create_dir(base.join("gamma").join("nested")).expect("create nested");
    fs::write(base.join("notes.txt"), "a file, not a directory\n").expect("write file");
    let _repo = TempRepo::init_at(base.join("beta"));

    let entries = sorted(browse_dir(&path_str(&base)).expect("browse a dir under HOME"));

    assert_eq!(
        entries
            .iter()
            .map(|e| e.name.clone())
            .collect::<Vec<String>>(),
        vec!["alpha".to_string(), "beta".to_string(), "gamma".to_string()],
        "only subdirectories are listed"
    );
    assert_eq!(
        entries
            .iter()
            .map(|e| e.path.clone())
            .collect::<Vec<String>>(),
        vec![
            path_str(base.join("alpha")),
            path_str(base.join("beta")),
            path_str(base.join("gamma")),
        ]
    );
    assert_eq!(
        entries.iter().map(|e| e.is_git_repo).collect::<Vec<bool>>(),
        vec![false, true, false]
    );
}

#[test]
fn ts07_rejects_a_path_outside_home() {
    let outside = temp_dir_outside_home();
    fs::create_dir(outside.path().join("child")).expect("create child");

    let err = browse_dir(&path_str(canonical(outside.path())))
        .expect_err("a path outside HOME must be rejected");

    assert!(
        matches!(err, GitError::PathOutsideHome(_)),
        "expected GitError::PathOutsideHome, got {err:?}"
    );
}

#[test]
fn ts07_rejects_a_path_that_escapes_home_through_dotdot() {
    let home_tmp = temp_dir_in_home();
    let base = canonical(home_tmp.path());
    // `<home>/<tmp>/../../../tmp` resolves to `/tmp`, outside HOME.
    let escaping = format!("{}/../../../tmp", path_str(&base));

    let err = browse_dir(&escaping).expect_err("`..` must not escape HOME");

    assert!(
        matches!(err, GitError::PathOutsideHome(_)),
        "expected GitError::PathOutsideHome, got {err:?}"
    );
}

#[test]
fn ts07_rejects_a_symlink_that_escapes_home() {
    let outside = temp_dir_outside_home();
    fs::create_dir(outside.path().join("secret")).expect("create secret");
    let home_tmp = temp_dir_in_home();
    let base = canonical(home_tmp.path());
    let link = base.join("escape");
    symlink(canonical(outside.path()), &link).expect("create symlink");

    let err = browse_dir(&path_str(&link)).expect_err("a symlink out of HOME must be rejected");

    assert!(
        matches!(err, GitError::PathOutsideHome(_)),
        "expected GitError::PathOutsideHome, got {err:?}"
    );
}

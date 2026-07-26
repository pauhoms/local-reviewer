#![allow(dead_code)]

use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

use tempfile::TempDir;

/// A throwaway git repository. Never points at a real repo: either it owns a
/// `TempDir` or it is initialised inside one owned by the caller.
pub struct TempRepo {
    root: PathBuf,
    _owned: Option<TempDir>,
}

impl TempRepo {
    pub fn new() -> Self {
        let dir = TempDir::new().expect("create temp dir");
        let root = canonical(dir.path());
        let repo = TempRepo {
            root,
            _owned: Some(dir),
        };
        repo.init();
        repo
    }

    pub fn new_in(parent: impl AsRef<Path>) -> Self {
        let dir = TempDir::new_in(parent.as_ref()).expect("create temp dir");
        let root = canonical(dir.path());
        let repo = TempRepo {
            root,
            _owned: Some(dir),
        };
        repo.init();
        repo
    }

    /// Initialises a repo at `path` (created if missing); cleanup is the
    /// caller's problem, so `path` must live inside a `TempDir` they own.
    pub fn init_at(path: impl AsRef<Path>) -> Self {
        fs::create_dir_all(path.as_ref()).expect("create repo dir");
        let repo = TempRepo {
            root: canonical(path.as_ref()),
            _owned: None,
        };
        repo.init();
        repo
    }

    fn init(&self) {
        self.git(&["init", "--quiet", "--initial-branch=main", "."]);
        self.git(&["config", "user.name", "Fixture User"]);
        self.git(&["config", "user.email", "fixture@example.test"]);
        self.git(&["config", "commit.gpgsign", "false"]);
        self.git(&["config", "core.autocrlf", "false"]);
    }

    pub fn path(&self) -> &Path {
        &self.root
    }

    pub fn path_str(&self) -> String {
        self.root.to_string_lossy().into_owned()
    }

    pub fn write(&self, rel: &str, content: &str) {
        let target = self.root.join(rel);
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent).expect("create parent dir");
        }
        fs::write(&target, content).expect("write file");
    }

    pub fn remove(&self, rel: &str) {
        fs::remove_file(self.root.join(rel)).expect("remove file");
    }

    pub fn add(&self, rel: &str) {
        self.git(&["add", "--", rel]);
    }

    pub fn add_all(&self) {
        self.git(&["add", "--all"]);
    }

    /// `git mv`, so the rename lands in the index the way git records it.
    pub fn rename(&self, from: &str, to: &str) {
        if let Some(parent) = self.root.join(to).parent() {
            fs::create_dir_all(parent).expect("create parent dir");
        }
        self.git(&["mv", from, to]);
    }

    pub fn commit(&self, message: &str) -> String {
        self.git(&["commit", "--quiet", "--message", message]);
        self.head()
    }

    pub fn commit_all(&self, message: &str) -> String {
        self.add_all();
        self.commit(message)
    }

    /// Fixed author/committer date so ordering assertions do not depend on how
    /// fast the test machine runs.
    pub fn commit_all_at(&self, message: &str, iso_date: &str) -> String {
        self.add_all();
        self.git_env(
            &["commit", "--quiet", "--message", message],
            &[
                ("GIT_AUTHOR_DATE", iso_date),
                ("GIT_COMMITTER_DATE", iso_date),
            ],
        );
        self.head()
    }

    pub fn head(&self) -> String {
        self.git(&["rev-parse", "HEAD"])
    }

    pub fn git(&self, args: &[&str]) -> String {
        self.git_env(args, &[])
    }

    pub fn git_env(&self, args: &[&str], env: &[(&str, &str)]) -> String {
        let mut cmd = Command::new("git");
        cmd.current_dir(&self.root).args(args);
        for (key, value) in env {
            cmd.env(key, value);
        }
        let out = cmd.output().expect("run git");
        assert!(
            out.status.success(),
            "git {:?} failed: {}",
            args,
            String::from_utf8_lossy(&out.stderr)
        );
        String::from_utf8(out.stdout)
            .expect("git output is utf-8")
            .trim_end()
            .to_string()
    }
}

pub fn home_dir() -> PathBuf {
    PathBuf::from(std::env::var("HOME").expect("HOME is set"))
}

/// A temp dir that really lives under `$HOME`, so the "under $HOME" check can
/// be exercised instead of stubbed.
pub fn temp_dir_in_home() -> TempDir {
    TempDir::new_in(home_dir()).expect("create temp dir in HOME")
}

/// A temp dir outside `$HOME` (under `/tmp`).
pub fn temp_dir_outside_home() -> TempDir {
    let dir = TempDir::new_in("/tmp").expect("create temp dir in /tmp");
    assert!(
        !canonical(dir.path()).starts_with(canonical(home_dir())),
        "temp dir must be outside HOME"
    );
    dir
}

pub fn canonical(path: impl AsRef<Path>) -> PathBuf {
    fs::canonicalize(path.as_ref())
        .unwrap_or_else(|e| panic!("canonicalize {path:?}: {e}", path = path.as_ref()))
}

pub fn path_str(path: impl AsRef<Path>) -> String {
    path.as_ref().to_string_lossy().into_owned()
}

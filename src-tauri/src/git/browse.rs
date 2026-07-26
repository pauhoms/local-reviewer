use std::ffi::OsString;
use std::fs;
use std::path::{Path, PathBuf};

use super::{DirEntryInfo, GitError, GitResult};

pub fn browse_dir(path: &str) -> GitResult<Vec<DirEntryInfo>> {
    let home = home_dir()?;
    let resolved = resolve_under_home(path, &home)?;
    list_directories(&resolved)
}

pub(crate) fn home_dir() -> GitResult<PathBuf> {
    home_from_env(std::env::var_os("HOME"))
}

/// `$HOME` is the only anchor the browser has, so its absence is a failure of
/// its own — not "the path you asked for is outside your home".
fn home_from_env(raw: Option<OsString>) -> GitResult<PathBuf> {
    raw.filter(|value| !value.is_empty())
        .map(PathBuf::from)
        .ok_or(GitError::NoHome)
}

/// Resolves `path` with `canonicalize` (following symlinks and `..`) and
/// rejects it unless it lands under `home`.
fn resolve_under_home(path: &str, home: &Path) -> GitResult<PathBuf> {
    let canonical_home = fs::canonicalize(home).map_err(|e| GitError::Io {
        path: home.to_string_lossy().into_owned(),
        source: e,
    })?;
    let resolved = fs::canonicalize(path).map_err(|e| GitError::Io {
        path: path.to_string(),
        source: e,
    })?;

    if resolved.starts_with(&canonical_home) {
        Ok(resolved)
    } else {
        Err(GitError::PathOutsideHome(path.to_string()))
    }
}

fn list_directories(dir: &Path) -> GitResult<Vec<DirEntryInfo>> {
    let read_dir = fs::read_dir(dir).map_err(|e| GitError::Io {
        path: dir.to_string_lossy().into_owned(),
        source: e,
    })?;

    let mut entries = Vec::new();
    for entry in read_dir {
        let entry = entry.map_err(|e| GitError::Io {
            path: dir.to_string_lossy().into_owned(),
            source: e,
        })?;
        let entry_path = entry.path();
        let is_dir = fs::metadata(&entry_path)
            .map(|m| m.is_dir())
            .unwrap_or(false);
        if !is_dir {
            continue;
        }
        entries.push(DirEntryInfo {
            name: entry.file_name().to_string_lossy().into_owned(),
            path: entry_path.to_string_lossy().into_owned(),
            is_git_repo: entry_path.join(".git").exists(),
        });
    }
    // `read_dir` yields whatever order the filesystem feels like and the picker
    // does not reorder anything, so the order it shows is decided here.
    entries.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(entries)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::ffi::OsString;
    use tempfile::TempDir;

    #[test]
    fn resolves_a_path_under_home_to_its_canonical_form() {
        let home = TempDir::new().expect("temp home");
        let child = home.path().join("project");
        fs::create_dir(&child).expect("create child");

        let resolved = resolve_under_home(child.to_str().expect("utf8 path"), home.path())
            .expect("path is under home");

        assert_eq!(
            resolved,
            fs::canonicalize(&child).expect("canonicalize child")
        );
    }

    #[test]
    fn reports_a_missing_home_as_its_own_error() {
        assert!(matches!(home_from_env(None), Err(GitError::NoHome)));
        assert!(matches!(
            home_from_env(Some(OsString::new())),
            Err(GitError::NoHome)
        ));
        assert_eq!(
            GitError::NoHome.to_string(),
            "no se pudo determinar tu directorio personal"
        );
    }

    #[test]
    fn takes_home_from_the_environment_when_it_is_set() {
        assert_eq!(
            home_from_env(Some(OsString::from("/home/dev"))).expect("HOME is set"),
            PathBuf::from("/home/dev")
        );
    }

    #[test]
    fn lists_directories_sorted_by_name() {
        let dir = TempDir::new().expect("temp dir");
        let names = ["zeta", "mu", "alpha", "omega", "beta", "kappa", "delta"];
        for name in names {
            fs::create_dir(dir.path().join(name)).expect("create dir");
        }

        let listed: Vec<String> = list_directories(dir.path())
            .expect("list")
            .into_iter()
            .map(|e| e.name)
            .collect();

        let mut expected: Vec<String> = names.iter().map(|n| n.to_string()).collect();
        expected.sort();
        assert_eq!(listed, expected);
    }

    #[test]
    fn rejects_a_path_that_is_not_under_home() {
        let home = TempDir::new().expect("temp home");
        let outside = TempDir::new().expect("temp outside");

        let err = resolve_under_home(outside.path().to_str().expect("utf8 path"), home.path())
            .expect_err("outside path must be rejected");

        assert!(matches!(err, GitError::PathOutsideHome(_)));
    }
}

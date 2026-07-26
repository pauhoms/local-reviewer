use std::fs;
use std::path::{Component, Path, PathBuf};

use super::{ensure_ref, ensure_repo, ref_exists, repo_root, run_git};
use super::{GitError, GitResult, Scope, Side};

pub fn read_blob(scope: &Scope, path: &str, side: Side) -> GitResult<String> {
    ensure_repo(scope.repo())?;
    // `path` comes from a `FileDiff`, which names files relative to the repo
    // root: anchoring it at a `repo` that is a subdirectory silently read the
    // wrong (missing) file and every diff looked entirely deleted.
    let root = repo_root(scope.repo())?;
    ensure_scope_refs(&root, scope)?;
    let contained = contained_path(&root, path)?;

    match side {
        Side::New => match new_ref(scope) {
            None => read_worktree_file(&contained),
            Some(reference) => read_git_show(&root, &reference, path),
        },
        Side::Old => match old_ref(&root, scope) {
            None => Ok(String::new()),
            Some(reference) => read_git_show(&root, &reference, path),
        },
    }
}

/// Keeps a caller-supplied path inside the repo, the same containment
/// `browse_dir` applies to `$HOME`. The lexical pass is the only one available
/// for a path that no longer exists (the deleted side of a diff); when the file
/// is there, `canonicalize` also rules out escaping through a symlink.
fn contained_path(repo: &str, path: &str) -> GitResult<PathBuf> {
    let candidate = Path::new(path);
    let outside = || GitError::PathOutsideRepo(path.to_string());

    let mut depth: usize = 0;
    for component in candidate.components() {
        match component {
            Component::CurDir => {}
            Component::Normal(_) => depth += 1,
            Component::ParentDir => depth = depth.checked_sub(1).ok_or_else(outside)?,
            Component::RootDir | Component::Prefix(_) => return Err(outside()),
        }
    }

    let joined = Path::new(repo).join(candidate);
    if let (Ok(resolved), Ok(root)) = (fs::canonicalize(&joined), fs::canonicalize(repo)) {
        if !resolved.starts_with(&root) {
            return Err(outside());
        }
    }
    Ok(joined)
}

/// Both refs of a scope are validated up front, whichever side is asked for:
/// an unchecked ref reaching git's argv would be read as an option.
fn ensure_scope_refs(repo: &str, scope: &Scope) -> GitResult<()> {
    match scope {
        Scope::Worktree { .. } => Ok(()),
        Scope::Commit { sha, .. } => ensure_ref(repo, sha),
        Scope::Range { from, to, .. } => {
            ensure_ref(repo, from)?;
            ensure_ref(repo, to)
        }
    }
}

/// The git ref for the new side, or `None` when it is the working tree
/// (`Scope::Worktree`, read straight from disk instead of via `git show`).
fn new_ref(scope: &Scope) -> Option<String> {
    match scope {
        Scope::Worktree { .. } => None,
        Scope::Commit { sha, .. } => Some(sha.clone()),
        Scope::Range { to, .. } => Some(to.clone()),
    }
}

/// The git ref for the old side, or `None` when there is no old side at all
/// (a root commit's parent, or a repo without commits — the old side is the
/// empty tree, i.e. every path is absent there).
fn old_ref(repo: &str, scope: &Scope) -> Option<String> {
    match scope {
        Scope::Worktree { .. } => ref_exists(repo, "HEAD").then(|| "HEAD".to_string()),
        Scope::Commit { sha, .. } => parent_ref(repo, sha),
        Scope::Range { from, .. } => parent_ref(repo, from),
    }
}

fn parent_ref(repo: &str, sha: &str) -> Option<String> {
    let parent = format!("{sha}^");
    ref_exists(repo, &parent).then_some(parent)
}

fn read_worktree_file(full_path: &Path) -> GitResult<String> {
    if !full_path.exists() {
        return Ok(String::new());
    }
    fs::read_to_string(full_path).map_err(|e| GitError::Io {
        path: full_path.to_string_lossy().into_owned(),
        source: e,
    })
}

/// `git show <reference>:<path>`, mapping "the path does not exist at that
/// revision" to an empty string instead of an error. Any other failure (a
/// damaged object store, say) is a real error and must not look like an empty
/// file.
fn read_git_show(repo: &str, reference: &str, path: &str) -> GitResult<String> {
    let target = format!("{reference}:{path}");
    match run_git(repo, &["show", "--end-of-options", &target]) {
        Ok(content) => Ok(content),
        Err(GitError::CommandFailed(stderr)) if is_absent_path(&stderr) => Ok(String::new()),
        Err(e) => Err(e),
    }
}

/// The two `git show` failures that mean "this path simply is not in that
/// revision": one for a path git has never seen, one for a path that exists
/// only in the working tree.
fn is_absent_path(stderr: &str) -> bool {
    stderr.contains("does not exist in") || stderr.contains("exists on disk, but not in")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scope_of(kind: &str) -> Scope {
        match kind {
            "worktree" => Scope::Worktree {
                repo: "/repo".to_string(),
            },
            "commit" => Scope::Commit {
                repo: "/repo".to_string(),
                sha: "deadbeef".to_string(),
            },
            _ => Scope::Range {
                repo: "/repo".to_string(),
                from: "aaa".to_string(),
                to: "bbb".to_string(),
            },
        }
    }

    #[test]
    fn contained_path_allows_dotdot_that_stays_inside_the_repo() {
        assert_eq!(
            contained_path("/repo", "src/../src/app.ts").expect("still inside"),
            Path::new("/repo/src/../src/app.ts")
        );
    }

    #[test]
    fn contained_path_rejects_dotdot_that_climbs_above_the_repo() {
        assert!(matches!(
            contained_path("/repo", "src/../../etc/hostname"),
            Err(GitError::PathOutsideRepo(_))
        ));
    }

    #[test]
    fn new_ref_reads_the_working_tree_for_worktree_scope() {
        assert_eq!(new_ref(&scope_of("worktree")), None);
    }

    #[test]
    fn new_ref_is_the_commit_itself_for_commit_scope() {
        assert_eq!(new_ref(&scope_of("commit")), Some("deadbeef".to_string()));
    }

    #[test]
    fn new_ref_is_the_range_upper_bound_for_range_scope() {
        assert_eq!(new_ref(&scope_of("range")), Some("bbb".to_string()));
    }
}

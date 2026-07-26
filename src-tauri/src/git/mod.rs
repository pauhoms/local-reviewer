pub mod blob;
pub mod browse;
pub mod commits;
pub mod diff;
pub mod parse;
pub mod types;

pub use types::{
    CommitInfo, DirEntryInfo, FileDiff, FileStatus, GitError, GitResult, Hunk, Line, LineKind,
    Scope, Side,
};

use std::process::Command;

/// The shape of git's output is configurable, by the user's `~/.gitconfig` and
/// by the reviewed repo alike, so every option that could change it is pinned
/// here rather than trusted:
/// - `core.quotePath` would octal-escape and quote every non-ASCII path,
///   leaving names that are neither readable nor usable as real paths;
/// - `diff.relative` would report paths relative to the cwd and hide whatever
///   sits above it, so a scope pointed at a subdirectory would lose files;
/// - `diff.suppressBlankEmpty` would print blank context lines with no leading
///   space, which is not a shape the unified-diff format allows.
///
/// The locale goes the same way: git translates its messages, and this layer
/// reads `stderr` to tell an absent path apart from a real failure.
fn git_command(repo: &str, args: &[&str]) -> Command {
    let mut cmd = Command::new("git");
    cmd.current_dir(repo)
        .env("LC_ALL", "C")
        .env("LANGUAGE", "")
        .args([
            "-c",
            "core.quotePath=false",
            "-c",
            "diff.relative=false",
            "-c",
            "diff.suppressBlankEmpty=false",
        ])
        .args(args);
    cmd
}

/// Runs `git <args>` inside `repo` and returns stdout as text. Every git
/// invocation in this layer is read-only (`diff`, `log`, `show`, `rev-parse`,
/// `ls-files`) — never `add`/`commit`/`checkout`.
pub(crate) fn run_git(repo: &str, args: &[&str]) -> GitResult<String> {
    let output = git_command(repo, args).output().map_err(|e| GitError::Io {
        path: repo.to_string(),
        source: e,
    })?;

    if !output.status.success() {
        return Err(GitError::CommandFailed(
            String::from_utf8_lossy(&output.stderr).trim().to_string(),
        ));
    }

    // Lossy on purpose: a single file whose name is not valid UTF-8 would
    // otherwise fail the whole scope, and the parser copes with a name carrying
    // a replacement character far better than the user copes with an empty
    // review.
    Ok(String::from_utf8_lossy(&output.stdout).into_owned())
}

/// Fails fast with a typed error instead of letting `git` print `fatal: …` to
/// stderr for every later command.
pub(crate) fn ensure_repo(repo: &str) -> GitResult<()> {
    let output = git_command(repo, &["rev-parse", "--is-inside-work-tree"])
        .output()
        .map_err(|e| GitError::Io {
            path: repo.to_string(),
            source: e,
        })?;

    // The exit code alone is not enough: inside `.git/` the command succeeds
    // and answers `false`, and every later command would then fail with git's
    // own `fatal:` instead of this typed error.
    let inside_work_tree = String::from_utf8_lossy(&output.stdout).trim() == "true";
    if output.status.success() && inside_work_tree {
        Ok(())
    } else {
        Err(GitError::NotAGitRepo(repo.to_string()))
    }
}

/// The root of the worktree holding `repo`. Every path this layer reports or
/// accepts is relative to it, so a `repo` pointing at a subdirectory must not
/// give the same file two different names.
pub(crate) fn repo_root(repo: &str) -> GitResult<String> {
    // Only the trailing newline: a repo path may legitimately end in a space.
    Ok(run_git(repo, &["rev-parse", "--show-toplevel"])?
        .trim_end_matches('\n')
        .to_string())
}

/// Whether `reference` resolves in `repo`. Used to tell a root commit (no
/// parent) apart from a genuinely bad ref.
pub(crate) fn ref_exists(repo: &str, reference: &str) -> bool {
    let args = [
        "rev-parse",
        "--verify",
        "--quiet",
        "--end-of-options",
        reference,
    ];
    git_command(repo, &args)
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

/// The gate every caller-supplied ref must pass before it reaches git's argv:
/// a ref such as `--output=…` would otherwise be read as an option and make
/// git write inside the repo under review.
pub(crate) fn ensure_ref(repo: &str, reference: &str) -> GitResult<()> {
    if ref_exists(repo, reference) {
        Ok(())
    } else {
        Err(GitError::BadRef(reference.to_string()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Stderr is parsed to tell "this path is not in that revision" apart from
    /// a real failure, and git translates that text: left to the user's locale
    /// the match would break and every added file would surface as an error.
    #[test]
    fn pins_a_deterministic_locale_on_every_git_invocation() {
        let env: Vec<(String, Option<String>)> = git_command("/repo", &["rev-parse", "HEAD"])
            .get_envs()
            .map(|(key, value)| {
                (
                    key.to_string_lossy().into_owned(),
                    value.map(|v| v.to_string_lossy().into_owned()),
                )
            })
            .collect();

        assert!(
            env.contains(&("LC_ALL".to_string(), Some("C".to_string()))),
            "env: {env:?}"
        );
        assert!(
            env.contains(&("LANGUAGE".to_string(), Some(String::new()))),
            "env: {env:?}"
        );
    }
}

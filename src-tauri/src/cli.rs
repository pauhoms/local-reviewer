use std::ffi::OsString;
use std::fs;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};

use crate::git::{self, GitError, GitResult, Scope};

/// What the command line asked for, once the refs it names have been checked
/// against the repository the user is standing in.
#[derive(Debug, PartialEq, Eq)]
pub enum Startup {
    Review(Scope),
    Pick,
    Help(String),
}

/// The arrival payload of the UI: the scope to open, if any, plus the home the
/// directory browser starts from — the webview has no environment of its own.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartupInfo {
    pub scope: Option<Scope>,
    pub home: String,
}

/// The command line as read, before any of it touches git.
#[derive(Debug, PartialEq, Eq)]
enum Request {
    Help,
    Worktree,
    Commit(String),
    Range(String, String),
    /// An argument shaped like neither a revision nor a range, kept whole so
    /// the error can quote exactly what was typed.
    BadSpec(String),
}

const RANGE_SEPARATOR: &str = "..";

fn usage() -> String {
    [
        "reviewer [<commit>|<a>..<b>]",
        "  no arguments    review uncommitted changes in the current repository",
        "  <commit>        review one commit",
        "  <a>..<b>        review the accumulated changes in a commit range",
        "  --help, -h      show this help",
        "  outside Git     open the repository picker",
    ]
    .join("\n")
}

/// `argv` without the program name. The reference is kept exactly as typed:
/// resolving it to a full sha here would hide from the user which ref they are
/// reviewing, and git reads it again on every command anyway.
pub fn parse_args(argv: &[String], cwd: &str) -> GitResult<Startup> {
    match classify(argv)? {
        Request::Help => Ok(Startup::Help(usage())),
        Request::Worktree => Ok(match repo_root_of(cwd) {
            Some(repo) => Startup::Review(Scope::Worktree { repo }),
            None => Startup::Pick,
        }),
        Request::Commit(sha) => {
            let repo = require_repo(cwd)?;
            git::ensure_commit(&repo, &sha)?;
            Ok(Startup::Review(Scope::Commit { repo, sha }))
        }
        Request::Range(from, to) => {
            let repo = require_repo(cwd)?;
            git::ensure_commit(&repo, &from)?;
            git::ensure_commit(&repo, &to)?;
            Ok(Startup::Review(Scope::Range { repo, from, to }))
        }
        // The repo comes first: outside one, what is missing is the repository,
        // not the revision the argument failed to name.
        Request::BadSpec(spec) => {
            require_repo(cwd)?;
            Err(GitError::BadRef(spec))
        }
    }
}

pub fn from_env() -> GitResult<Startup> {
    let argv = utf8_args(std::env::args_os().skip(1))?;
    parse_args(&argv, &current_dir())
}

/// `std::env::args()` panics on a command line that is not valid text, and a
/// mistyped shell escape is not a crash the user should ever see.
fn utf8_args(argv: impl Iterator<Item = OsString>) -> GitResult<Vec<String>> {
    argv.map(|arg| {
        arg.into_string()
            .map_err(|bad| GitError::NonUtf8Argument(bad.to_string_lossy().into_owned()))
    })
    .collect()
}

/// Only the directory browser needs the home, and the UI already explains its
/// absence: losing it must not take down a scope the command line resolved.
pub fn startup_info(startup: &Startup) -> StartupInfo {
    StartupInfo {
        scope: scope_of(startup),
        home: git::browse::home_dir()
            .map(canonical_string)
            .unwrap_or_default(),
    }
}

fn classify(argv: &[String]) -> GitResult<Request> {
    if argv.iter().any(|arg| arg == "--help" || arg == "-h") {
        return Ok(Request::Help);
    }
    if let Some(option) = argv.iter().find(|arg| arg.starts_with('-')) {
        return Err(GitError::UnknownOption(option.clone()));
    }
    if let Some(extra) = argv.get(1) {
        return Err(GitError::UnexpectedArgument(extra.clone()));
    }

    let Some(spec) = argv.first() else {
        return Ok(Request::Worktree);
    };
    Ok(read_spec(spec))
}

/// `a...b` and `a..b..c` are neither a revision nor a range this tool reviews;
/// splitting them anyway would quote in the error a ref the user never typed.
fn read_spec(spec: &str) -> Request {
    if spec.is_empty() || spec.contains("...") || spec.matches(RANGE_SEPARATOR).count() > 1 {
        return Request::BadSpec(spec.to_string());
    }
    match spec.split_once(RANGE_SEPARATOR) {
        Some((from, to)) if !from.is_empty() && !to.is_empty() => {
            Request::Range(from.to_string(), to.to_string())
        }
        Some(_) => Request::BadSpec(spec.to_string()),
        None => Request::Commit(spec.to_string()),
    }
}

fn scope_of(startup: &Startup) -> Option<Scope> {
    match startup {
        Startup::Review(scope) => Some(scope.clone()),
        Startup::Pick | Startup::Help(_) => None,
    }
}

/// The root of the worktree `cwd` belongs to, or nothing at all: a cwd that is
/// not a repo — or no longer exists — is an answer, not a failure.
fn repo_root_of(cwd: &str) -> Option<String> {
    git::ensure_repo(cwd).ok()?;
    git::repo_root(cwd).ok()
}

fn require_repo(cwd: &str) -> GitResult<String> {
    repo_root_of(cwd).ok_or_else(|| GitError::NotAGitRepo(cwd.to_string()))
}

fn current_dir() -> String {
    match std::env::current_dir() {
        Ok(dir) => dir.to_string_lossy().into_owned(),
        Err(_) => ".".to_string(),
    }
}

/// Every path the UI compares against comes out of `browse_dir` canonicalised,
/// so a home reached through a symlink would never prefix any of them.
fn canonical_string(path: PathBuf) -> String {
    fs::canonicalize(&path)
        .unwrap_or(path)
        .to_string_lossy()
        .into_owned()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn argv(list: &[&str]) -> Vec<String> {
        list.iter().map(|arg| arg.to_string()).collect()
    }

    #[test]
    fn no_arguments_asks_for_the_worktree() {
        assert_eq!(classify(&argv(&[])).expect("no args"), Request::Worktree);
    }

    #[test]
    fn a_single_argument_is_a_revision() {
        assert_eq!(
            classify(&argv(&["HEAD~2"])).expect("one ref"),
            Request::Commit("HEAD~2".to_string())
        );
    }

    #[test]
    fn two_dots_split_the_argument_into_a_range() {
        assert_eq!(
            classify(&argv(&["a1b2c3..HEAD"])).expect("a range"),
            Request::Range("a1b2c3".to_string(), "HEAD".to_string())
        );
    }

    #[test]
    fn a_malformed_spec_is_kept_whole_so_the_error_can_quote_what_was_typed() {
        for spec in ["HEAD..", "..HEAD", "..", "HEAD~1...HEAD", "a..b..c"] {
            assert_eq!(
                classify(&argv(&[spec])).expect("a malformed spec is not a parse failure"),
                Request::BadSpec(spec.to_string()),
                "spec {spec:?}"
            );
        }
    }

    #[test]
    fn an_empty_argument_is_not_silently_read_as_the_worktree() {
        assert_eq!(
            classify(&argv(&[""])).expect("an empty argument reaches the repo check"),
            Request::BadSpec(String::new())
        );
    }

    #[test]
    fn help_wins_over_anything_else_on_the_line() {
        for line in [vec!["--help"], vec!["-h"], vec!["HEAD", "--help"]] {
            assert_eq!(classify(&argv(&line)).expect("help"), Request::Help);
        }
    }

    #[test]
    fn an_unknown_option_is_named_in_the_error() {
        let err = classify(&argv(&["--porcelain"])).expect_err("unknown option");
        assert!(
            matches!(&err, GitError::UnknownOption(name) if name == "--porcelain"),
            "got {err:?}"
        );
        assert!(err.to_string().contains("--porcelain"), "{err}");
    }

    #[test]
    fn a_second_revision_is_named_in_the_error() {
        let err = classify(&argv(&["aaa", "bbb"])).expect_err("two revisions");
        assert!(
            matches!(&err, GitError::UnexpectedArgument(name) if name == "bbb"),
            "got {err:?}"
        );
        assert!(err.to_string().contains("bbb"), "{err}");
    }

    #[test]
    fn an_argument_that_is_not_valid_text_is_named_instead_of_bringing_the_app_down() {
        use std::ffi::OsString;
        use std::os::unix::ffi::OsStringExt;

        let err =
            utf8_args([OsString::from("HEAD"), OsString::from_vec(vec![0xff, 0xfe])].into_iter())
                .expect_err("argv that is not text must not reach the parser");

        assert!(
            matches!(&err, GitError::NonUtf8Argument(shown) if shown.contains('\u{fffd}')),
            "got {err:?}"
        );
    }

    #[test]
    fn a_text_command_line_arrives_at_the_parser_untouched() {
        use std::ffi::OsString;

        let argv = utf8_args([OsString::from("a1b2c3..HEAD")].into_iter()).expect("valid text");

        assert_eq!(argv, vec!["a1b2c3..HEAD".to_string()]);
    }

    #[test]
    fn the_pick_screen_and_the_usage_text_carry_no_scope_across_the_ipc() {
        assert_eq!(scope_of(&Startup::Pick), None);
        assert_eq!(scope_of(&Startup::Help(usage())), None);
        assert_eq!(
            scope_of(&Startup::Review(Scope::Worktree {
                repo: "/repo".to_string()
            })),
            Some(Scope::Worktree {
                repo: "/repo".to_string()
            })
        );
    }

    #[test]
    fn a_missing_home_does_not_sink_a_scope_the_command_line_already_resolved() {
        let scope = Scope::Worktree {
            repo: "/repo".to_string(),
        };
        let saved = std::env::var_os("HOME");
        std::env::remove_var("HOME");
        let info = startup_info(&Startup::Review(scope.clone()));
        match saved {
            Some(home) => std::env::set_var("HOME", home),
            None => std::env::remove_var("HOME"),
        }

        assert_eq!(info.scope, Some(scope));
        assert_eq!(
            info.home, "",
            "the UI already explains an empty home; the browser is all that needs it"
        );
    }

    #[test]
    fn the_home_the_ui_receives_is_the_canonical_one() {
        let dir = tempfile::TempDir::new().expect("temp dir");
        let real = dir.path().join("real");
        std::fs::create_dir(&real).expect("create real dir");
        let link = dir.path().join("link");
        std::os::unix::fs::symlink(&real, &link).expect("create symlink");

        assert_eq!(
            canonical_string(link),
            std::fs::canonicalize(&real)
                .expect("canonicalize")
                .to_string_lossy()
                .into_owned()
        );
    }
}

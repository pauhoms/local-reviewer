use std::fs;
use std::path::Path;

use super::parse::parse_unified_diff;
use super::{ensure_ref, ensure_repo, ref_exists, repo_root, run_git};
use super::{FileDiff, FileStatus, GitResult, Hunk, Line, LineKind, Scope};

/// Git's well-known empty tree object, always resolvable even in a repo that
/// never created it explicitly. Used to diff a root commit against "nothing".
const EMPTY_TREE: &str = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";

/// What makes `git diff`'s output ours instead of the user's: an external diff
/// driver or a `textconv` filter — which the reviewed repo can declare all by
/// itself in `.gitattributes` — would otherwise replace the diff or the lines
/// under review, and a non-standard prefix would be glued onto every path.
const DIFF_FLAGS: [&str; 6] = [
    "--no-color",
    "--no-ext-diff",
    "--no-textconv",
    "--src-prefix=a/",
    "--dst-prefix=b/",
    "--find-renames",
];

pub fn diff_for_scope(scope: &Scope) -> GitResult<Vec<FileDiff>> {
    match scope {
        Scope::Worktree { repo } => worktree_diff(repo),
        Scope::Commit { repo, sha } => range_diff(repo, sha, sha),
        Scope::Range { repo, from, to } => range_diff(repo, from, to),
    }
}

fn worktree_diff(repo: &str) -> GitResult<Vec<FileDiff>> {
    ensure_repo(repo)?;
    // Everything runs from the repo root: `git diff` reports paths relative to
    // it but `ls-files` reports them relative to the cwd, so a `repo` pointing
    // at a subdirectory would give the same file two different names.
    let root = repo_root(repo)?;
    // A repo whose first commit is still pending has no `HEAD`: everything in
    // it is new, which is exactly a diff against the empty tree.
    let base = if ref_exists(&root, "HEAD") {
        "HEAD"
    } else {
        EMPTY_TREE
    };
    let output = run_git(&root, &diff_args(&[base]))?;
    let mut files = parse_unified_diff(&output);
    files.extend(untracked_files(&root)?);
    Ok(files)
}

/// `from^..to`: this also covers `Scope::Commit`, since a single commit's own
/// diff is `commit^..commit` — the same shape with `from == to`.
fn range_diff(repo: &str, from: &str, to: &str) -> GitResult<Vec<FileDiff>> {
    ensure_repo(repo)?;
    ensure_ref(repo, to)?;
    let base = parent_or_empty_tree(repo, from)?;
    let output = run_git(repo, &diff_args(&[&base, to]))?;
    Ok(parse_unified_diff(&output))
}

/// The trailing `--` is what keeps a ref that is also the name of a file in the
/// tree from making git bail out over the ambiguity.
fn diff_args<'a>(refs: &[&'a str]) -> Vec<&'a str> {
    let mut args = vec!["diff"];
    args.extend(DIFF_FLAGS);
    args.push("--end-of-options");
    args.extend_from_slice(refs);
    args.push("--");
    args
}

fn parent_or_empty_tree(repo: &str, sha: &str) -> GitResult<String> {
    ensure_ref(repo, sha)?;
    let parent = format!("{sha}^");
    if ref_exists(repo, &parent) {
        Ok(parent)
    } else {
        Ok(EMPTY_TREE.to_string())
    }
}

fn untracked_files(repo: &str) -> GitResult<Vec<FileDiff>> {
    // `-z` is what makes the output usable: without it `ls-files` C-quotes any
    // name holding a `"`, a `\` or a control character (`core.quotePath=false`
    // only covers non-ASCII), and the quoted form is not a real path.
    let output = run_git(repo, &["ls-files", "--others", "--exclude-standard", "-z"])?;
    Ok(output
        .split('\0')
        .filter(|rel_path| !rel_path.is_empty())
        .filter_map(|rel_path| untracked_file_diff(repo, rel_path))
        .collect())
}

/// One untracked entry, or `None` when it is not a reviewable file at all. No
/// single entry may sink the whole scope, so nothing in here fails: what cannot
/// be read degrades to the hunk-less shape used for binaries.
fn untracked_file_diff(repo: &str, rel_path: &str) -> Option<FileDiff> {
    // A trailing `/` is an untracked nested repo (`vendor/`, `.venv/`), which
    // `ls-files` reports as one entry; it is not a file.
    if rel_path.ends_with('/') {
        return None;
    }
    let full_path = Path::new(repo).join(rel_path);
    // Unstattable and still listed: a name git printed with bytes that are not
    // UTF-8 no longer resolves on disk, but the file is really there.
    let Ok(metadata) = fs::symlink_metadata(&full_path) else {
        return Some(binary_file_diff(rel_path));
    };
    if metadata.is_symlink() {
        // What git keeps in the blob is the target, and reading through the
        // link would pull a file from outside the repo into the review.
        let target = fs::read_link(&full_path).ok()?;
        return Some(added_file_diff(rel_path, &target.to_string_lossy()));
    }
    if !metadata.is_file() {
        return None;
    }
    Some(match fs::read(&full_path).map(String::from_utf8) {
        Ok(Ok(content)) => added_file_diff(rel_path, &content),
        _ => binary_file_diff(rel_path),
    })
}

/// Builds the synthetic `FileDiff` for an untracked file: every line is an
/// addition against an empty old side, keeping `path` relative to the repo
/// (not the absolute path `git diff --no-index` would report).
fn added_file_diff(rel_path: &str, content: &str) -> FileDiff {
    let content_lines: Vec<&str> = content.lines().collect();
    let count = content_lines.len() as u32;
    let lines = content_lines
        .into_iter()
        .enumerate()
        .map(|(i, text)| Line {
            kind: LineKind::Add,
            old_no: None,
            new_no: Some(i as u32 + 1),
            content: text.to_string(),
        })
        .collect();

    FileDiff {
        path: rel_path.to_string(),
        old_path: None,
        status: FileStatus::Added,
        additions: count,
        deletions: 0,
        hunks: vec![Hunk {
            header: format!("@@ -0,0 +1,{count} @@"),
            old_start: 0,
            old_lines: 0,
            new_start: 1,
            new_lines: count,
            lines,
        }],
    }
}

/// An untracked file whose bytes are not reviewable text (binary, or simply
/// unreadable) still belongs in the file list, but it has no lines — mirroring
/// what `git diff` does for a tracked binary ("Binary files … differ").
fn binary_file_diff(rel_path: &str) -> FileDiff {
    FileDiff {
        path: rel_path.to_string(),
        old_path: None,
        status: FileStatus::Added,
        additions: 0,
        deletions: 0,
        hunks: Vec::new(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn added_file_diff_turns_every_line_into_an_addition() {
        let diff = added_file_diff("untracked.txt", "n1\nn2\nn3\n");

        assert_eq!(diff.path, "untracked.txt");
        assert_eq!(diff.status, FileStatus::Added);
        assert_eq!(diff.additions, 3);
        assert_eq!(diff.deletions, 0);
        assert_eq!(diff.hunks.len(), 1);
        assert_eq!(diff.hunks[0].header, "@@ -0,0 +1,3 @@");

        let shape: Vec<(LineKind, Option<u32>, Option<u32>, &str)> = diff.hunks[0]
            .lines
            .iter()
            .map(|l| (l.kind, l.old_no, l.new_no, l.content.as_str()))
            .collect();
        assert_eq!(
            shape,
            vec![
                (LineKind::Add, None, Some(1), "n1"),
                (LineKind::Add, None, Some(2), "n2"),
                (LineKind::Add, None, Some(3), "n3"),
            ]
        );
    }

    #[test]
    fn added_file_diff_handles_an_empty_file() {
        let diff = added_file_diff("empty.txt", "");
        assert_eq!(diff.additions, 0);
        assert!(diff.hunks[0].lines.is_empty());
    }
}

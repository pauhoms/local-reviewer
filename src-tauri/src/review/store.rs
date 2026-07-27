use std::fs;
use std::path::PathBuf;

use super::model::Review;
use super::{reviews_dir, state_dir_in, write_state_file, ReviewResult};
use crate::git::Scope;

/// How much of the repository name travels in the file name. Enough to tell two
/// reviews apart at a glance, short enough to keep the whole key well inside the
/// 255 bytes a file name gets.
const SLUG_LIMIT: usize = 24;

/// The file name a scope owns inside `.state/`. It has to be stable across
/// runs, unique per scope, and safe as a file name — a key built by swapping
/// separators for underscores would give `/home/dev/a/b` and `/home/dev/a_b`
/// the same file, so the readable part is only a label and the digest carries
/// the identity.
pub fn scope_key(scope: &Scope) -> String {
    format!(
        "{}-{}-{:016x}",
        kind_of(scope),
        slug(scope.repo()),
        digest(&canonical(scope))
    )
}

pub fn load(scope: &Scope) -> ReviewResult<Option<Review>> {
    let path = state_path(scope)?;
    // State that cannot be read or understood is no state: the review starts
    // empty and the next save writes over whatever is there. Handing back a
    // review nobody wrote would be far worse than losing the offer to resume.
    let Ok(raw) = fs::read_to_string(&path) else {
        return Ok(None);
    };
    let Ok(review) = serde_json::from_str::<Review>(&raw) else {
        return Ok(None);
    };
    if review.scope != *scope {
        return Ok(None);
    }
    Ok(Some(review))
}

pub fn save(review: &Review) -> ReviewResult<()> {
    let dir = state_dir_in(&reviews_dir()?);
    let body = serde_json::to_string_pretty(review)?;
    write_state_file(&dir, &file_name(&review.scope), &body)
}

fn state_path(scope: &Scope) -> ReviewResult<PathBuf> {
    Ok(state_dir_in(&reviews_dir()?).join(file_name(scope)))
}

fn file_name(scope: &Scope) -> String {
    format!("{}.json", scope_key(scope))
}

fn kind_of(scope: &Scope) -> &'static str {
    match scope {
        Scope::Worktree { .. } => "worktree",
        Scope::Commit { .. } => "commit",
        Scope::Range { .. } => "range",
    }
}

/// Length-prefixed so no separator can be forged: `a/b` and `a_b` differ, and
/// so do a repo ending in the sha of the next field and its neighbour.
fn canonical(scope: &Scope) -> String {
    let parts: Vec<&str> = match scope {
        Scope::Worktree { repo } => vec!["worktree", repo],
        Scope::Commit { repo, sha } => vec!["commit", repo, sha],
        Scope::Range { repo, from, to } => vec!["range", repo, from, to],
    };
    parts
        .iter()
        .map(|part| format!("{}:{}", part.len(), part))
        .collect()
}

/// FNV-1a, spelled out rather than borrowed from `DefaultHasher`: the standard
/// hasher is free to change between Rust releases, and a key that changes with
/// the toolchain would orphan every review already on disk.
fn digest(text: &str) -> u64 {
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    for byte in text.as_bytes() {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
    }
    hash
}

/// The readable half of the key: the last segment of the repo path, with
/// anything that is not plainly safe in a file name folded into `_`.
fn slug(repo: &str) -> String {
    let name = repo
        .rsplit('/')
        .find(|segment| !segment.is_empty())
        .unwrap_or("");
    let cleaned: String = name
        .chars()
        .take(SLUG_LIMIT)
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' || c == '_' {
                c
            } else {
                '_'
            }
        })
        .collect();
    if cleaned.is_empty() {
        "repo".to_string()
    } else {
        cleaned
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn worktree(repo: &str) -> Scope {
        Scope::Worktree {
            repo: repo.to_string(),
        }
    }

    #[test]
    fn the_key_carries_the_repository_name_so_a_human_can_find_it() {
        assert!(
            scope_key(&worktree("/home/dev/reviewv4")).starts_with("worktree-reviewv4-"),
            "got {}",
            scope_key(&worktree("/home/dev/reviewv4"))
        );
    }

    #[test]
    fn a_repository_name_that_is_not_file_name_safe_is_folded_into_underscores() {
        let key = scope_key(&worktree("/home/dev/año \"raro\"/"));

        assert!(!key.contains(' ') && !key.contains('"'), "got {key}");
        assert!(key.starts_with("worktree-a_o__raro_-"), "got {key}");
    }

    #[test]
    fn a_repository_at_the_root_still_names_a_file() {
        let key = scope_key(&worktree("/"));

        assert!(key.starts_with("worktree-repo-"), "got {key}");
        assert!(!key.contains('/'), "got {key}");
    }

    #[test]
    fn a_very_long_repository_name_does_not_run_past_a_file_name() {
        let key = scope_key(&worktree(&format!("/home/dev/{}", "x".repeat(400))));

        assert!(key.len() < 100, "got a key of {} bytes", key.len());
    }

    #[test]
    fn the_length_prefix_keeps_two_scopes_that_share_their_text_apart() {
        assert_ne!(
            canonical(&Scope::Commit {
                repo: "/home/dev/a".to_string(),
                sha: "bc".to_string(),
            }),
            canonical(&Scope::Commit {
                repo: "/home/dev/ab".to_string(),
                sha: "c".to_string(),
            })
        );
    }

    #[test]
    fn the_digest_is_the_one_fnv_1a_answers_and_not_the_toolchains() {
        // Pinned so a rewrite of `digest` cannot silently orphan the reviews
        // already on disk; these are the published FNV-1a 64 test vectors.
        assert_eq!(digest(""), 0xcbf2_9ce4_8422_2325);
        assert_eq!(digest("a"), 0xaf63_dc4c_8601_ec8c);
        assert_eq!(digest("foobar"), 0x8594_4171_f739_67e8);
    }
}

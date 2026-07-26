use super::{ensure_repo, run_git};
use super::{CommitInfo, GitResult};

/// Unit separator: extremely unlikely to appear in a subject or author name,
/// unlike a plain comma or pipe.
const FIELD_SEP: char = '\x1f';

pub fn list_commits(repo: &str, limit: usize) -> GitResult<Vec<CommitInfo>> {
    ensure_repo(repo)?;
    let format_arg = format!(
        "--pretty=format:%H{sep}%h{sep}%s{sep}%an{sep}%aI",
        sep = FIELD_SEP
    );
    let limit_arg = limit.to_string();
    let output = run_git(
        repo,
        &[
            "log",
            "--no-color",
            "--abbrev=7",
            "-n",
            &limit_arg,
            &format_arg,
        ],
    )?;
    Ok(parse_log_output(&output))
}

/// Pure parsing of `git log`'s `--pretty=format` output; malformed records
/// (fewer fields than expected) are skipped rather than causing a panic.
fn parse_log_output(output: &str) -> Vec<CommitInfo> {
    output
        .lines()
        .filter_map(|line| {
            let mut fields = line.split(FIELD_SEP);
            let hash = fields.next()?;
            let short_hash = fields.next()?;
            let subject = fields.next()?;
            let author = fields.next()?;
            let date = fields.next()?;
            Some(CommitInfo {
                hash: hash.to_string(),
                short_hash: short_hash.to_string(),
                subject: subject.to_string(),
                author: author.to_string(),
                date: date.to_string(),
            })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_well_formed_log_records_in_the_order_git_produced_them() {
        let output = format!(
            "aaa{sep}aaaaaaa{sep}second commit{sep}Jane Doe{sep}2021-02-02T00:00:00+00:00\n\
             bbb{sep}bbbbbbb{sep}first commit{sep}Jane Doe{sep}2021-01-01T00:00:00+00:00",
            sep = FIELD_SEP
        );

        let commits = parse_log_output(&output);

        assert_eq!(commits.len(), 2);
        assert_eq!(commits[0].hash, "aaa");
        assert_eq!(commits[0].short_hash, "aaaaaaa");
        assert_eq!(commits[0].subject, "second commit");
        assert_eq!(commits[0].author, "Jane Doe");
        assert_eq!(commits[0].date, "2021-02-02T00:00:00+00:00");
        assert_eq!(commits[1].hash, "bbb");
    }

    #[test]
    fn skips_a_record_with_missing_fields_instead_of_panicking() {
        let output = format!("onlyhash{sep}short", sep = FIELD_SEP);
        assert_eq!(parse_log_output(&output), Vec::new());
    }

    #[test]
    fn returns_no_commits_for_empty_output() {
        assert_eq!(parse_log_output(""), Vec::new());
    }
}

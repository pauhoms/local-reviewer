use std::fs::{self, OpenOptions};
use std::io;
use std::path::Path;

use crate::review::model::{Comment, Review};
use crate::review::{reviews_dir, write_state_file, ReviewError, ReviewResult};

const HEADER: &str = "# Review\n\n## Comments\n\n";
const NOTHING: &str = "No comments.\n";
const SEPARATOR: &str = "\n---\n\n";

/// A thousand exports in one day is a bug going round, not a reviewer at work:
/// better to say so than to spin looking for a name nobody took.
const MAX_PER_DAY: u32 = 1000;

/// The wording `src/comments/label.ts` gives an anchor, so a comment reads the
/// same in the panel and in the file handed to the AI.
fn line_range_label(from: u32, to: u32) -> String {
    let first = from.min(to);
    let last = from.max(to);
    if first == last {
        format!("Line {first}")
    } else {
        format!("Lines {first}-{last}")
    }
}

fn block(comment: &Comment, text: &str) -> String {
    format!(
        "### {}\n\n{}\n\n{text}\n",
        comment.path,
        line_range_label(comment.from, comment.to)
    )
}

/// Where a comment sits in the document. A path the tree does not carry any
/// more is still work the reviewer did, so it is not dropped: it goes after
/// every path the tree does carry, and those among themselves alphabetically.
fn place<'a>(order: &[String], comment: &'a Comment) -> (usize, &'a str, u32) {
    let rank = order
        .iter()
        .position(|path| *path == comment.path)
        .unwrap_or(order.len());
    let orphan = if rank == order.len() {
        comment.path.as_str()
    } else {
        ""
    };
    (rank, orphan, comment.from.min(comment.to))
}

pub fn render(review: &Review, order: &[String]) -> String {
    // The text travels verbatim but for its two ends: the AI reading this has
    // to apply the comment, and mangling the snippet the reviewer pasted would
    // be worse than a heading that renders odd. A body holding a lone `---` line
    // does put more separators in the document than the format has — deliberate:
    // `### <path>` still delimits every block without ambiguity, so the document
    // is odd to read and never wrong to parse. Escaping it is not a fix.
    let mut written: Vec<(&Comment, &str)> = review
        .comments
        .iter()
        .map(|comment| (comment, comment.text.trim()))
        .filter(|(_, text)| !text.is_empty())
        .collect();
    // Stable, so two comments starting on the same line keep the order they
    // were written in.
    written.sort_by_key(|(comment, _)| place(order, comment));

    let blocks: Vec<String> = written
        .into_iter()
        .map(|(comment, text)| block(comment, text))
        .collect();
    if blocks.is_empty() {
        return format!("{HEADER}{NOTHING}");
    }
    format!("{HEADER}{}", blocks.join(SEPARATOR))
}

fn file_name(day: &str, nth: u32) -> String {
    if nth <= 1 {
        format!("review-{day}.md")
    } else {
        format!("review-{day}-{nth}.md")
    }
}

/// Answers the path the Markdown landed on, which is the first name of the day
/// nobody had taken.
fn export_into(dir: &Path, day: &str, review: &Review, order: &[String]) -> ReviewResult<String> {
    let body = render(review, order);
    let io_error = |name: &str, source: io::Error| ReviewError::Io {
        path: dir.join(name).to_string_lossy().into_owned(),
        source,
    };
    fs::create_dir_all(dir).map_err(|source| io_error(&file_name(day, 1), source))?;

    for nth in 1..=MAX_PER_DAY {
        let name = file_name(day, nth);
        let target = dir.join(&name);
        // The name is taken by creating it, not by asking whether it is free:
        // two exports at once both get the same answer to the question, and the
        // rename that follows would write over the file of the other. `O_EXCL`
        // does not follow links either, so a name pointing nowhere is still a
        // name somebody wrote.
        match OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&target)
        {
            Ok(_) => {}
            Err(source) if source.kind() == io::ErrorKind::AlreadyExists => continue,
            Err(source) => return Err(io_error(&name, source)),
        }
        write_state_file(dir, &name, &body)?;
        return Ok(target.to_string_lossy().into_owned());
    }
    Err(ReviewError::Io {
        path: dir
            .join(file_name(day, MAX_PER_DAY))
            .to_string_lossy()
            .into_owned(),
        source: io::Error::new(
            io::ErrorKind::AlreadyExists,
            format!("{MAX_PER_DAY} reviews have already been exported today"),
        ),
    })
}

/// The day the reviewer is having, which is the local one: a review exported at
/// half past midnight belongs to the night it was written in, not to UTC.
fn today() -> String {
    chrono::Local::now().format("%Y-%m-%d").to_string()
}

pub fn export(review: &Review, order: &[String]) -> ReviewResult<String> {
    export_into(&reviews_dir()?, &today(), review, order)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::git::{Scope, Side};
    use crate::review::model::{Comment, DiffView};
    use std::sync::{Arc, Barrier};
    use tempfile::TempDir;

    const DAY: &str = "2026-07-26";

    fn review(comments: Vec<Comment>) -> Review {
        Review {
            scope: Scope::Worktree {
                repo: "/home/dev/local-reviewer".to_string(),
            },
            comments,
            view: DiffView::Unified,
        }
    }

    fn note(path: &str, from: u32, to: u32, text: &str) -> Comment {
        Comment {
            id: format!("{path}:{from}-{to}"),
            path: path.to_string(),
            side: Side::New,
            from,
            to,
            text: text.to_string(),
        }
    }

    fn order(paths: &[&str]) -> Vec<String> {
        paths.iter().map(|path| (*path).to_string()).collect()
    }

    #[test]
    fn a_review_with_nothing_written_on_it_says_so() {
        assert_eq!(
            render(&review(Vec::new()), &[]),
            "# Review\n\n## Comments\n\nNo comments.\n"
        );
    }

    #[test]
    fn one_comment_is_a_heading_an_anchor_and_its_text() {
        assert_eq!(
            render(&review(vec![note("a.ts", 4, 4, "algo")]), &order(&["a.ts"])),
            "# Review\n\n## Comments\n\n### a.ts\n\nLine 4\n\nalgo\n"
        );
    }

    #[test]
    fn the_order_given_wins_over_the_order_the_comments_were_written_in() {
        // Neither the alphabet nor the review: `b.ts` is second in both and
        // first in the order, which is the only one the document follows.
        let review = review(vec![note("a.ts", 9, 9, "en a"), note("b.ts", 1, 1, "en b")]);

        assert_eq!(
            render(&review, &order(&["b.ts", "a.ts"])),
            "# Review\n\n## Comments\n\n### b.ts\n\nLine 1\n\nen b\n\
             \n---\n\n### a.ts\n\nLine 9\n\nen a\n"
        );
    }

    #[test]
    fn inside_a_file_the_lowest_of_the_two_ends_places_the_comment() {
        let review = review(vec![
            note("a.ts", 30, 40, "la segunda"),
            note("a.ts", 90, 20, "la primera"),
        ]);

        assert_eq!(
            render(&review, &order(&["a.ts"])),
            "# Review\n\n## Comments\n\n### a.ts\n\nLines 20-90\n\nla primera\n\
             \n---\n\n### a.ts\n\nLines 30-40\n\nla segunda\n"
        );
    }

    #[test]
    fn a_path_outside_the_order_lands_after_the_ones_inside_it() {
        let review = review(vec![
            note("z.ts", 1, 1, "fuera, la última"),
            note("b.ts", 1, 1, "dentro"),
            note("c.ts", 1, 1, "fuera, la primera"),
        ]);

        let rendered = render(&review, &order(&["b.ts"]));

        let headings: Vec<&str> = rendered.lines().filter(|l| l.starts_with("### ")).collect();
        assert_eq!(headings, vec!["### b.ts", "### c.ts", "### z.ts"]);
    }

    #[test]
    fn only_the_two_ends_of_a_text_are_trimmed() {
        let review = review(vec![note("a.ts", 1, 1, "\t uno \n\n\t  dos\t \n ")]);

        assert_eq!(
            render(&review, &order(&["a.ts"])),
            "# Review\n\n## Comments\n\n### a.ts\n\nLine 1\n\nuno \n\n\t  dos\n"
        );
    }

    #[test]
    fn a_comment_with_nothing_but_blank_space_is_not_a_comment() {
        let review = review(vec![
            note("a.ts", 1, 1, " \n\t "),
            note("a.ts", 2, 2, "esta sí"),
        ]);

        assert_eq!(
            render(&review, &order(&["a.ts"])),
            "# Review\n\n## Comments\n\n### a.ts\n\nLine 2\n\nesta sí\n"
        );
    }

    #[test]
    fn a_review_of_nothing_but_blank_comments_says_there_are_none() {
        let review = review(vec![note("a.ts", 1, 1, ""), note("b.ts", 2, 2, "\n")]);

        assert_eq!(
            render(&review, &order(&["a.ts", "b.ts"])),
            "# Review\n\n## Comments\n\nNo comments.\n"
        );
    }

    #[test]
    fn the_first_file_of_the_day_carries_no_number_and_the_rest_no_padding() {
        assert_eq!(file_name("2026-07-26", 1), "review-2026-07-26.md");
        assert_eq!(file_name("2026-07-26", 2), "review-2026-07-26-2.md");
        assert_eq!(file_name("2026-07-26", 12), "review-2026-07-26-12.md");
    }

    #[test]
    fn what_lands_on_disk_is_what_render_answers() {
        let dir = TempDir::new().expect("temp dir");
        let review = review(vec![note("a.ts", 1, 1, "la nota")]);

        let path = export_into(dir.path(), DAY, &review, &order(&["a.ts"])).expect("export");

        assert_eq!(
            path,
            dir.path().join("review-2026-07-26.md").to_string_lossy()
        );
        assert_eq!(
            fs::read_to_string(&path).expect("read"),
            render(&review, &order(&["a.ts"]))
        );
    }

    #[test]
    fn a_name_already_taken_sends_the_export_to_the_next_one() {
        let dir = TempDir::new().expect("temp dir");
        fs::write(dir.path().join("review-2026-07-26.md"), "de antes").expect("plant");

        let path = export_into(dir.path(), DAY, &review(Vec::new()), &[]).expect("export");

        assert!(path.ends_with("review-2026-07-26-2.md"), "got {path}");
        assert_eq!(
            fs::read_to_string(dir.path().join("review-2026-07-26.md")).expect("read"),
            "de antes"
        );
    }

    /// A name pointing nowhere is still a name somebody wrote: renaming over it
    /// would swallow the link and write outside the reviews directory.
    #[test]
    fn a_dangling_link_holds_its_name_like_any_other_file() {
        let dir = TempDir::new().expect("temp dir");
        std::os::unix::fs::symlink(
            dir.path().join("no-existe"),
            dir.path().join("review-2026-07-26.md"),
        )
        .expect("plant a dangling link");

        let path = export_into(dir.path(), DAY, &review(Vec::new()), &[]).expect("export");

        assert!(path.ends_with("review-2026-07-26-2.md"), "got {path}");
        assert!(
            !dir.path().join("no-existe").exists(),
            "the link was followed"
        );
    }

    /// `export_review` blocks, and a key held down fires it again long before
    /// the first call has answered: two exports at once are two names, or one
    /// of them writes over the other's file.
    #[test]
    fn two_exports_at_the_same_time_land_on_two_different_names() {
        for round in 0..20 {
            let dir = TempDir::new().expect("temp dir");
            let start = Arc::new(Barrier::new(2));

            let hands: Vec<_> = (0..2)
                .map(|hand| {
                    let start = Arc::clone(&start);
                    let dir = dir.path().to_path_buf();
                    std::thread::spawn(move || {
                        let review = review(vec![note("a.ts", 1, 1, &format!("la mano {hand}"))]);
                        start.wait();
                        export_into(&dir, DAY, &review, &order(&["a.ts"])).expect("export")
                    })
                })
                .collect();
            let mut landed: Vec<String> = hands
                .into_iter()
                .map(|hand| hand.join().expect("the export thread"))
                .collect();
            landed.sort();

            assert_ne!(landed[0], landed[1], "round {round}: {landed:?}");
            let written: Vec<String> = landed
                .iter()
                .map(|path| fs::read_to_string(path).expect("read an export"))
                .collect();
            assert!(written[0].contains("la mano "), "round {round}");
            assert_ne!(written[0], written[1], "round {round}: one export was lost");
        }
    }

    #[test]
    fn a_day_whose_names_are_all_taken_is_reported_and_not_looped_over() {
        let dir = TempDir::new().expect("temp dir");
        for nth in 1..=MAX_PER_DAY {
            fs::write(dir.path().join(file_name(DAY, nth)), "").expect("plant");
        }

        let err = export_into(dir.path(), DAY, &review(Vec::new()), &[]).expect_err("no name left");

        assert!(matches!(err, ReviewError::Io { .. }), "got {err:?}");
        assert!(err.to_string().contains(".md"), "got {err}");
    }
}

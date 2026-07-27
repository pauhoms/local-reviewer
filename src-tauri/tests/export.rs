//! TS-40 / TS-41 / TS-43 — the exported Markdown: the interface of this tool
//! with the AI. The format never changes, so it is asserted whole, character
//! for character, and never by fragments.
//!
//! What this file assumes of `src-tauri/src/export.rs` (the API the phase
//! fixes):
//!
//! ```ignore
//! pub fn render(review: &Review, order: &[String]) -> String;
//! pub fn export(review: &Review, order: &[String]) -> ReviewResult<String>;
//! ```
//!
//! `order` is the list of paths in the order of the tree. Decisions the phase
//! document leaves open and this file closes (see the report):
//!
//!   * the document ends with exactly one `\n`;
//!   * the text of a comment is written verbatim, only trimmed at both ends;
//!   * a comment that is blank after trimming is left out, and a review with
//!     nothing left to write falls back to `Sin comentarios.`;
//!   * a path missing from `order` is exported last, in alphabetical order —
//!     never dropped, because a comment on a file that left the diff is still
//!     work the reviewer did;
//!   * two comments starting on the same line keep the order of the review;
//!   * `YYYY-MM-DD` is the **local** date, the day the reviewer is having.
//!
//! Nothing here may touch `~/.codex/reviews/`: every test that writes points
//! the reviews directory at a `TempDir` through `REVIEWV4_REVIEWS_DIR`.

use std::fs;
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Mutex;

use reviewv4_lib::export::{export, render};
use reviewv4_lib::git::{Scope, Side};
use reviewv4_lib::review::model::{Comment, DiffView, Review};
use reviewv4_lib::review::ReviewError;
use serde::Deserialize;
use tempfile::TempDir;

const REVIEWS_DIR_ENV: &str = "REVIEWV4_REVIEWS_DIR";

const PHP: &str = "src/UserService.php";
const TS: &str = "src/Order.ts";

/// The reviews directory travels in the environment, which is process-wide:
/// tests that point it somewhere else must not overlap.
static ENV_LOCK: Mutex<()> = Mutex::new(());

/// Clears the variable even when the body panics: leaving it pointing at a
/// dropped `TempDir` would turn one real failure into a cascade of confusing
/// ones across the rest of the binary.
struct ReviewsDirVar;

impl Drop for ReviewsDirVar {
    fn drop(&mut self) {
        std::env::remove_var(REVIEWS_DIR_ENV);
    }
}

fn with_reviews_dir<T>(body: impl FnOnce(&Path) -> T) -> T {
    // Declaration order matters: dropping runs in reverse, so `_restore` clears
    // the variable while `_guard` still holds the lock.
    let _guard = ENV_LOCK
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let dir = TempDir::new().expect("create temp reviews dir");
    std::env::set_var(REVIEWS_DIR_ENV, dir.path());
    let _restore = ReviewsDirVar;
    body(dir.path())
}

fn worktree() -> Scope {
    Scope::Worktree {
        repo: "/home/dev/reviewv4".to_string(),
    }
}

fn comment(path: &str, side: Side, from: u32, to: u32, text: &str) -> Comment {
    Comment {
        id: format!("{path}:{from}-{to}:{}", text.len()),
        path: path.to_string(),
        side,
        from,
        to,
        text: text.to_string(),
    }
}

fn new_comment(path: &str, from: u32, to: u32, text: &str) -> Comment {
    comment(path, Side::New, from, to, text)
}

fn review(comments: Vec<Comment>) -> Review {
    Review {
        scope: worktree(),
        comments,
        view: DiffView::Unified,
    }
}

fn order(paths: &[&str]) -> Vec<String> {
    paths.iter().map(|path| (*path).to_string()).collect()
}

fn file_names(dir: &Path) -> Vec<String> {
    let mut names: Vec<String> = fs::read_dir(dir)
        .unwrap_or_else(|e| panic!("read {dir:?}: {e}"))
        .map(|entry| {
            entry
                .expect("dir entry")
                .file_name()
                .to_string_lossy()
                .into_owned()
        })
        .collect();
    names.sort();
    names
}

/// The local date, the one the reviewer would write on a sheet of paper. Read
/// from the system rather than computed here so the expectation cannot drift
/// with the same bug as the implementation.
fn today() -> String {
    let output = Command::new("date")
        .arg("+%Y-%m-%d")
        .output()
        .expect("ask the system for today's local date");
    let day = String::from_utf8_lossy(&output.stdout).trim().to_string();
    assert!(
        day.len() == 10 && day.as_bytes()[4] == b'-' && day.as_bytes()[7] == b'-',
        "the fixture itself is broken: `date` answered {day:?}"
    );
    day
}

fn review_name(day: &str, nth: u32) -> String {
    if nth <= 1 {
        format!("review-{day}.md")
    } else {
        format!("review-{day}-{nth}.md")
    }
}

/// Asserts the export landed on the `nth` name of today. Two readings of the
/// clock are accepted so a run straddling midnight fails for a real reason.
fn assert_named_today(path: &str, before: &str, after: &str, nth: u32) {
    let path = PathBuf::from(path);
    assert!(
        path.is_absolute(),
        "Copy Path hands this to Codex, so it has to be absolute: {path:?}"
    );
    let name = path
        .file_name()
        .expect("the export path names a file")
        .to_string_lossy()
        .into_owned();
    let allowed = [review_name(before, nth), review_name(after, nth)];
    assert!(
        allowed.contains(&name),
        "expected one of {allowed:?}, got {name:?}"
    );
}

// ---------------------------------------------------------------------------
// TS-40 — the shape of the document
// ---------------------------------------------------------------------------

/// Copied from `phases/phase-8.md`. This is the contract; if the produced text
/// differs by one character, the tool has changed its interface with the AI.
const SPEC_DOCUMENT: &str = "\
# Review

## Comentarios

### src/UserService.php

Líneas 35-48

El método tiene demasiadas responsabilidades.

Separar validación de persistencia.

---

### src/UserService.php

Líneas 102-110

Evitar duplicación del bloque try/catch.

---

### src/Order.ts

Líneas 15-26

El nombre de la función no refleja realmente lo que hace.
";

const EMPTY_DOCUMENT: &str = "\
# Review

## Comentarios

Sin comentarios.
";

#[test]
fn ts40_renders_the_document_of_the_phase_character_for_character() {
    // Deliberately out of order: neither the order of the review nor the
    // alphabet is the order of the document.
    let review = review(vec![
        new_comment(
            TS,
            15,
            26,
            "El nombre de la función no refleja realmente lo que hace.",
        ),
        new_comment(PHP, 102, 110, "Evitar duplicación del bloque try/catch."),
        new_comment(
            PHP,
            35,
            48,
            "El método tiene demasiadas responsabilidades.\n\nSeparar validación de persistencia.",
        ),
    ]);

    assert_eq!(render(&review, &order(&[PHP, TS])), SPEC_DOCUMENT);
}

#[derive(Deserialize)]
struct LabelCase {
    from: u32,
    to: u32,
    label: String,
}

/// The wording of an anchor lives twice, in `src/comments/label.ts` and here,
/// so the panel and the Markdown read the same. The shared fixture is what
/// keeps the two copies honest; `tests/toolbar/export.test.tsx` pins the other
/// half against the very same file.
#[test]
fn ts40_the_wording_of_a_range_is_the_one_the_panel_shows() {
    let raw = fs::read_to_string(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../tests/fixtures/line-range-labels.json"
    ))
    .expect("read the shared label fixture");
    let cases: Vec<LabelCase> = serde_json::from_str(&raw).expect("decode the label fixture");
    assert!(cases.len() >= 9, "the fixture lost cases: {}", cases.len());

    for case in cases {
        let review = review(vec![new_comment(PHP, case.from, case.to, "una nota")]);

        assert_eq!(
            render(&review, &order(&[PHP])),
            format!(
                "# Review\n\n## Comentarios\n\n### {PHP}\n\n{}\n\nuna nota\n",
                case.label
            ),
            "the anchor ({}, {}) is not worded the way the panel words it",
            case.from,
            case.to
        );
    }
}

#[test]
fn ts40_the_separator_goes_between_comments_and_never_after_the_last() {
    let one = review(vec![new_comment(PHP, 1, 1, "sola")]);
    let rendered = render(&one, &order(&[PHP]));
    assert_eq!(
        rendered,
        "# Review\n\n## Comentarios\n\n### src/UserService.php\n\nLínea 1\n\nsola\n"
    );
    assert!(
        !rendered.contains("---"),
        "one comment needs no separator: {rendered}"
    );

    let three = review(vec![
        new_comment(PHP, 1, 1, "una"),
        new_comment(PHP, 2, 2, "dos"),
        new_comment(PHP, 3, 3, "tres"),
    ]);
    let rendered = render(&three, &order(&[PHP]));
    assert_eq!(rendered.matches("\n---\n").count(), 2, "got {rendered}");
    assert!(rendered.ends_with("tres\n"), "got {rendered}");
}

#[test]
fn ts40_the_files_follow_the_order_of_the_tree_and_not_the_alphabet() {
    let review = review(vec![
        new_comment(TS, 15, 26, "en Order"),
        new_comment(PHP, 35, 48, "en UserService"),
    ]);

    let tree_first = render(&review, &order(&[PHP, TS]));
    let tree_last = render(&review, &order(&[TS, PHP]));

    assert_eq!(
        tree_first,
        "# Review\n\n## Comentarios\n\n### src/UserService.php\n\nLíneas 35-48\n\nen UserService\n\
         \n---\n\n### src/Order.ts\n\nLíneas 15-26\n\nen Order\n"
    );
    assert_eq!(
        tree_last,
        "# Review\n\n## Comentarios\n\n### src/Order.ts\n\nLíneas 15-26\n\nen Order\n\
         \n---\n\n### src/UserService.php\n\nLíneas 35-48\n\nen UserService\n"
    );
}

#[test]
fn ts40_inside_a_file_the_comments_follow_their_first_line() {
    let review = review(vec![
        new_comment(PHP, 102, 110, "la cuarta"),
        new_comment(PHP, 12, 12, "la primera"),
        // Written backwards: the line it starts on is 40, not 60, so it goes
        // before the one on 50 — sorting by the raw `from` would swap them.
        new_comment(PHP, 60, 40, "la segunda"),
        new_comment(PHP, 50, 50, "la tercera"),
    ]);

    assert_eq!(
        render(&review, &order(&[PHP])),
        "# Review\n\n## Comentarios\n\n\
         ### src/UserService.php\n\nLínea 12\n\nla primera\n\
         \n---\n\n### src/UserService.php\n\nLíneas 40-60\n\nla segunda\n\
         \n---\n\n### src/UserService.php\n\nLínea 50\n\nla tercera\n\
         \n---\n\n### src/UserService.php\n\nLíneas 102-110\n\nla cuarta\n"
    );
}

#[test]
fn ts40_the_numbers_are_the_ones_of_the_side_the_comment_hangs_from() {
    // The old side is the file *before* the change: 36 there and 36 here are
    // two different lines, and the document says nothing about which is which.
    let review = review(vec![
        comment(PHP, Side::New, 36, 36, "la línea que queda"),
        comment(PHP, Side::Old, 12, 13, "el bloque que se va"),
    ]);

    let rendered = render(&review, &order(&[PHP]));

    assert_eq!(
        rendered,
        "# Review\n\n## Comentarios\n\n\
         ### src/UserService.php\n\nLíneas 12-13\n\nel bloque que se va\n\
         \n---\n\n### src/UserService.php\n\nLínea 36\n\nla línea que queda\n"
    );
    for mark in ["old", "new", "(viejo)", "(nuevo)", "antiguo"] {
        assert!(
            !rendered.contains(mark),
            "the format carries no side mark, and this one shows {mark:?}: {rendered}"
        );
    }
}

#[test]
fn ts40_two_comments_on_the_same_range_keep_the_order_of_the_review() {
    let review = review(vec![
        new_comment(PHP, 35, 48, "primera lectura"),
        new_comment(PHP, 35, 48, "segunda lectura"),
    ]);

    assert_eq!(
        render(&review, &order(&[PHP])),
        "# Review\n\n## Comentarios\n\n\
         ### src/UserService.php\n\nLíneas 35-48\n\nprimera lectura\n\
         \n---\n\n### src/UserService.php\n\nLíneas 35-48\n\nsegunda lectura\n"
    );
}

#[test]
fn ts40_a_file_missing_from_the_order_is_written_last_and_never_dropped() {
    // `src/Borrado.php` is a comment from a review of code that has since been
    // rewritten: it is not in the tree any more, and it is still work.
    let review = review(vec![
        new_comment("src/Zeta.ts", 1, 1, "el segundo huérfano"),
        new_comment(PHP, 35, 48, "en el árbol"),
        new_comment("src/Borrado.php", 4, 4, "el primer huérfano"),
    ]);

    assert_eq!(
        render(&review, &order(&[PHP])),
        "# Review\n\n## Comentarios\n\n\
         ### src/UserService.php\n\nLíneas 35-48\n\nen el árbol\n\
         \n---\n\n### src/Borrado.php\n\nLínea 4\n\nel primer huérfano\n\
         \n---\n\n### src/Zeta.ts\n\nLínea 1\n\nel segundo huérfano\n"
    );
}

#[test]
fn ts40_an_empty_order_still_exports_every_comment() {
    let review = review(vec![
        new_comment("src/b.ts", 2, 2, "la b"),
        new_comment("src/a.ts", 1, 1, "la a"),
    ]);

    assert_eq!(
        render(&review, &[]),
        "# Review\n\n## Comentarios\n\n\
         ### src/a.ts\n\nLínea 1\n\nla a\n\
         \n---\n\n### src/b.ts\n\nLínea 2\n\nla b\n"
    );
}

#[test]
fn ts40_a_file_of_the_order_with_no_comments_gets_no_heading() {
    let review = review(vec![new_comment(PHP, 35, 35, "la única")]);

    let rendered = render(&review, &order(&["src/Otro.ts", PHP, "src/Tercero.ts"]));

    assert_eq!(
        rendered,
        "# Review\n\n## Comentarios\n\n### src/UserService.php\n\nLínea 35\n\nla única\n"
    );
    assert!(!rendered.contains("Otro.ts"), "got {rendered}");
    assert!(!rendered.contains("Tercero.ts"), "got {rendered}");
}

#[test]
fn ts40_a_path_with_spaces_accents_and_quotes_travels_verbatim() {
    let path = "informes finales/año 2026/resumen \"final\".md";
    let review = review(vec![new_comment(path, 3, 4, "ojo con el nombre")]);

    assert_eq!(
        render(&review, &order(&[path])),
        "# Review\n\n## Comentarios\n\n\
         ### informes finales/año 2026/resumen \"final\".md\n\n\
         Líneas 3-4\n\nojo con el nombre\n"
    );
}

/// The Markdown is read by an AI that has to apply the comment: mangling the
/// snippet the reviewer pasted would be worse than a heading that renders odd.
#[test]
fn ts40_the_text_of_a_comment_travels_verbatim_hashes_and_dashes_included() {
    let text = "# No es un título\n\n---\n\nUsa `--flag` y no `#[allow]`.\n    sangrado";
    let review = review(vec![new_comment(PHP, 7, 7, text)]);

    assert_eq!(
        render(&review, &order(&[PHP])),
        format!("# Review\n\n## Comentarios\n\n### {PHP}\n\nLínea 7\n\n{text}\n")
    );
}

#[test]
fn ts40_the_blank_space_around_a_text_is_trimmed_and_the_inside_is_not() {
    let review = review(vec![new_comment(
        PHP,
        7,
        7,
        "\n\n  primera línea\n\n  segunda línea  \n\n  ",
    )]);

    assert_eq!(
        render(&review, &order(&[PHP])),
        format!(
            "# Review\n\n## Comentarios\n\n### {PHP}\n\nLínea 7\n\n\
             primera línea\n\n  segunda línea\n"
        )
    );
}

#[test]
fn ts40_a_comment_that_is_blank_after_trimming_is_left_out() {
    let review = review(vec![
        new_comment(PHP, 1, 1, "   \n\t\n "),
        new_comment(PHP, 9, 9, "esta sí"),
        new_comment(PHP, 20, 20, ""),
    ]);

    assert_eq!(
        render(&review, &order(&[PHP])),
        format!("# Review\n\n## Comentarios\n\n### {PHP}\n\nLínea 9\n\nesta sí\n")
    );
}

#[test]
fn ts40_neither_the_scope_nor_the_view_of_the_review_reaches_the_markdown() {
    let comments = vec![new_comment(PHP, 35, 48, "la misma nota")];
    let worktree = Review {
        scope: worktree(),
        comments: comments.clone(),
        view: DiffView::Unified,
    };
    let a_commit = Review {
        scope: Scope::Commit {
            repo: "/home/dev/otro".to_string(),
            sha: "a1b2c3".to_string(),
        },
        comments,
        view: DiffView::Split,
    };

    let rendered = render(&worktree, &order(&[PHP]));
    assert_eq!(rendered, render(&a_commit, &order(&[PHP])));
    for leak in ["worktree", "a1b2c3", "/home/dev", "split", "unified"] {
        assert!(
            !rendered.contains(leak),
            "the format has no room for {leak:?}: {rendered}"
        );
    }
}

#[test]
fn ts40_two_hundred_comments_keep_one_heading_each_and_a_separator_between() {
    let comments: Vec<Comment> = (0..200)
        .map(|index| new_comment(PHP, index + 1, index + 1, &format!("nota {index}")))
        .collect();

    let rendered = render(&review(comments), &order(&[PHP]));

    assert_eq!(rendered.matches(&format!("### {PHP}\n")).count(), 200);
    assert_eq!(rendered.matches("\n---\n").count(), 199);
    assert!(rendered.starts_with("# Review\n\n## Comentarios\n\n### "));
    let tail: String = rendered
        .chars()
        .skip(rendered.chars().count() - 40)
        .collect();
    assert!(
        rendered.ends_with("Línea 200\n\nnota 199\n"),
        "the document does not end on the last comment, it ends on {tail:?}"
    );
}

// ---------------------------------------------------------------------------
// TS-41 — where it lands and what it never overwrites
// ---------------------------------------------------------------------------

#[test]
fn ts41_writes_todays_markdown_in_the_reviews_dir_and_answers_its_absolute_path() {
    with_reviews_dir(|dir| {
        let review = review(vec![new_comment(PHP, 35, 48, "la nota del día")]);
        let before = today();

        let path = export(&review, &order(&[PHP])).expect("export");

        let after = today();
        assert_named_today(&path, &before, &after, 1);
        assert_eq!(
            PathBuf::from(&path).parent(),
            Some(dir),
            "the Markdown goes in the reviews dir itself, next to .state/"
        );
        assert_eq!(
            fs::read_to_string(&path).expect("read the exported Markdown"),
            render(&review, &order(&[PHP])),
            "the file holds exactly what render returns"
        );
    });
}

#[test]
fn ts41_creates_the_reviews_directory_when_it_is_missing() {
    with_reviews_dir(|dir| {
        let nested = dir.join("aún").join("no").join("existe");
        std::env::set_var(REVIEWS_DIR_ENV, &nested);
        assert!(!nested.exists());

        let path = export(
            &review(vec![new_comment(PHP, 1, 1, "nota")]),
            &order(&[PHP]),
        )
        .expect("export must create the reviews directory");

        assert_eq!(PathBuf::from(&path).parent(), Some(nested.as_path()));
        assert!(PathBuf::from(&path).is_file(), "nothing at {path}");
    });
}

#[test]
fn ts41_a_second_and_a_third_export_the_same_day_write_2_and_3() {
    with_reviews_dir(|dir| {
        let before = today();

        let first = export(
            &review(vec![new_comment(PHP, 1, 1, "la primera")]),
            &order(&[PHP]),
        )
        .expect("first export");
        let second = export(
            &review(vec![new_comment(PHP, 2, 2, "la segunda")]),
            &order(&[PHP]),
        )
        .expect("second export");
        let third = export(
            &review(vec![new_comment(PHP, 3, 3, "la tercera")]),
            &order(&[PHP]),
        )
        .expect("third export");

        let after = today();
        assert_named_today(&first, &before, &after, 1);
        assert_named_today(&second, &before, &after, 2);
        assert_named_today(&third, &before, &after, 3);

        assert!(
            fs::read_to_string(&first)
                .expect("read the first")
                .contains("la primera"),
            "the first export must survive the ones after it"
        );
        assert!(fs::read_to_string(&second)
            .expect("read the second")
            .contains("la segunda"));
        assert!(fs::read_to_string(&third)
            .expect("read the third")
            .contains("la tercera"));

        assert_eq!(
            file_names(dir).len(),
            3,
            "three exports are three files, no more: {:?}",
            file_names(dir)
        );
    });
}

#[test]
fn ts41_the_suffix_keeps_counting_past_nine_without_padding() {
    with_reviews_dir(|dir| {
        let before = today();

        for round in 1..=12u32 {
            let path = export(
                &review(vec![new_comment(
                    PHP,
                    round,
                    round,
                    &format!("vuelta {round}"),
                )]),
                &order(&[PHP]),
            )
            .unwrap_or_else(|e| panic!("export {round}: {e}"));
            assert_named_today(&path, &before, &today(), round);
        }

        let names = file_names(dir);
        assert_eq!(names.len(), 12, "got {names:?}");
        assert!(
            names.iter().any(|name| name.ends_with("-12.md")),
            "the twelfth export is -12, not -1-2 nor -012: {names:?}"
        );
    });
}

#[test]
fn ts41_an_existing_2_with_no_base_does_not_stop_the_base_from_being_written() {
    with_reviews_dir(|dir| {
        let day = today();
        let planted = dir.join(review_name(&day, 2));
        fs::write(&planted, "de otra sesión\n").expect("plant a -2");

        let path = export(
            &review(vec![new_comment(PHP, 1, 1, "la de ahora")]),
            &order(&[PHP]),
        )
        .expect("export");

        assert_eq!(
            PathBuf::from(&path)
                .file_name()
                .map(|n| n.to_string_lossy().into_owned()),
            Some(review_name(&day, 1)),
            "the base name was free, so that is the one to take"
        );
        assert_eq!(
            fs::read_to_string(&planted).expect("read the planted -2"),
            "de otra sesión\n",
            "a file the export did not write must not be touched"
        );
    });
}

#[test]
fn ts41_a_markdown_already_there_is_never_overwritten() {
    with_reviews_dir(|dir| {
        let day = today();
        let base = dir.join(review_name(&day, 1));
        let planted = "# Review\n\nesto lo escribió otra exportación\n";
        fs::write(&base, planted).expect("plant today's export");

        let path = export(
            &review(vec![new_comment(PHP, 1, 1, "la nueva")]),
            &order(&[PHP]),
        )
        .expect("export");

        assert_ne!(PathBuf::from(&path), base);
        assert_eq!(
            fs::read_to_string(&base).expect("read the planted export"),
            planted,
            "the export must never overwrite a review already written"
        );
        assert!(fs::read_to_string(&path)
            .expect("read the new export")
            .contains("la nueva"));
    });
}

#[test]
fn ts41_leaves_no_temporary_file_behind_and_does_not_touch_the_state_dir() {
    with_reviews_dir(|dir| {
        let state = dir.join(".state");
        fs::create_dir_all(&state).expect("create the state dir");
        fs::write(state.join("worktree-x.json"), "{\"comments\": []}").expect("plant state");

        let path = export(
            &review(vec![new_comment(PHP, 1, 1, "nota")]),
            &order(&[PHP]),
        )
        .expect("export");
        let name = PathBuf::from(&path)
            .file_name()
            .expect("a file name")
            .to_string_lossy()
            .into_owned();

        assert_eq!(
            file_names(dir),
            vec![".state".to_string(), name],
            "the temporary file must be renamed over the target, never left behind"
        );
        assert_eq!(
            file_names(&state),
            vec!["worktree-x.json".to_string()],
            "the export writes the Markdown and nothing else"
        );
        assert_eq!(
            fs::read_to_string(state.join("worktree-x.json")).expect("read the state"),
            "{\"comments\": []}"
        );
    });
}

#[test]
fn ts41_a_reviews_dir_that_is_a_file_fails_loudly_and_writes_nothing() {
    with_reviews_dir(|dir| {
        let blocked = dir.join("no-soy-un-directorio");
        fs::write(&blocked, "un fichero cualquiera").expect("write file");
        std::env::set_var(REVIEWS_DIR_ENV, &blocked);

        let err = export(
            &review(vec![new_comment(PHP, 1, 1, "nota")]),
            &order(&[PHP]),
        )
        .expect_err("a reviews dir that is a file cannot be written to");

        assert!(matches!(err, ReviewError::Io { .. }), "got {err:?}");
        assert!(
            err.to_string().contains(".md"),
            "the message must name the file it could not write: {err}"
        );
        assert_eq!(
            fs::read_to_string(&blocked).expect("read the blocking file"),
            "un fichero cualquiera",
            "a failed export must not have written anywhere"
        );
    });
}

#[test]
fn ts41_a_reviews_dir_that_cannot_be_written_to_fails_loudly() {
    if unsafe { libc::geteuid() } == 0 {
        eprintln!("skipped: running as root, a read-only directory proves nothing");
        return;
    }

    with_reviews_dir(|dir| {
        let locked = dir.join("cerrado");
        fs::create_dir(&locked).expect("create the dir");
        fs::set_permissions(&locked, fs::Permissions::from_mode(0o555)).expect("make it read-only");
        std::env::set_var(REVIEWS_DIR_ENV, &locked);

        let err = export(
            &review(vec![new_comment(PHP, 1, 1, "nota")]),
            &order(&[PHP]),
        )
        .expect_err("an export that cannot be written must be reported, not swallowed");
        assert!(matches!(err, ReviewError::Io { .. }), "got {err:?}");

        fs::set_permissions(&locked, fs::Permissions::from_mode(0o755))
            .expect("give the dir its permissions back");
        assert_eq!(file_names(&locked), Vec::<String>::new());
    });
}

// ---------------------------------------------------------------------------
// TS-43 — a review with nothing written on it
// ---------------------------------------------------------------------------

#[test]
fn ts43_a_review_with_no_comments_still_renders_a_valid_document() {
    assert_eq!(
        render(&review(Vec::new()), &order(&[PHP, TS])),
        EMPTY_DOCUMENT
    );
}

#[test]
fn ts43_the_empty_document_is_what_lands_on_disk() {
    with_reviews_dir(|_dir| {
        let before = today();

        let path = export(&review(Vec::new()), &order(&[PHP])).expect("export an empty review");

        assert_named_today(&path, &before, &today(), 1);
        assert_eq!(
            fs::read_to_string(&path).expect("read the exported Markdown"),
            EMPTY_DOCUMENT
        );
    });
}

#[test]
fn ts43_a_review_whose_only_comments_are_blank_renders_the_empty_document() {
    let review = review(vec![
        new_comment(PHP, 1, 1, ""),
        new_comment(PHP, 2, 2, "   \n  "),
    ]);

    assert_eq!(render(&review, &order(&[PHP])), EMPTY_DOCUMENT);
}

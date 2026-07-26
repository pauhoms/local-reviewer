use super::{FileDiff, FileStatus, Hunk, Line, LineKind};

/// Parses a `git diff --no-color --find-renames` payload into `FileDiff`s.
/// Pure and total: malformed sections are skipped rather than causing a panic.
pub fn parse_unified_diff(diff: &str) -> Vec<FileDiff> {
    let lines: Vec<&str> = diff.lines().collect();
    let mut files = Vec::new();
    let mut i = 0;

    while i < lines.len() {
        let Some(header) = lines[i].strip_prefix("diff --git ") else {
            i += 1;
            continue;
        };
        let header_path = path_from_diff_git_header(header);
        i += 1;

        let mut old_path: Option<String> = None;
        let mut new_path: Option<String> = None;
        let mut rename_from: Option<String> = None;
        let mut rename_to: Option<String> = None;
        let mut is_new_file = false;
        let mut is_deleted_file = false;

        while i < lines.len() && !lines[i].starts_with("diff --git ") && !lines[i].starts_with("@@")
        {
            let line = lines[i];
            if let Some(rest) = line.strip_prefix("--- ") {
                old_path = parse_diff_path(rest, "a/");
            } else if let Some(rest) = line.strip_prefix("+++ ") {
                new_path = parse_diff_path(rest, "b/");
            } else if let Some(rest) = line.strip_prefix("rename from ") {
                rename_from = parse_diff_path(rest, "");
            } else if let Some(rest) = line.strip_prefix("rename to ") {
                rename_to = parse_diff_path(rest, "");
            } else if line.starts_with("new file mode") {
                is_new_file = true;
            } else if line.starts_with("deleted file mode") {
                is_deleted_file = true;
            }
            i += 1;
        }

        // Binary contents and pure mode changes carry no `---`/`+++` lines, so
        // the `diff --git` header is the only place their path appears.
        let named = |candidate: Option<String>| {
            candidate
                .or_else(|| header_path.clone())
                .unwrap_or_default()
        };
        let (path, file_old_path, status) = match (&rename_from, &rename_to) {
            (Some(from), Some(to)) => (to.clone(), Some(from.clone()), FileStatus::Renamed),
            _ if is_new_file => (named(new_path.clone()), None, FileStatus::Added),
            _ if is_deleted_file => (named(old_path.clone()), None, FileStatus::Deleted),
            _ => (
                named(new_path.clone().or_else(|| old_path.clone())),
                None,
                FileStatus::Modified,
            ),
        };

        let mut hunks = Vec::new();
        let mut additions = 0u32;
        let mut deletions = 0u32;
        while i < lines.len() && lines[i].starts_with("@@") {
            let Some((hunk, consumed)) = parse_hunk(&lines[i..]) else {
                break;
            };
            additions += hunk
                .lines
                .iter()
                .filter(|l| l.kind == LineKind::Add)
                .count() as u32;
            deletions += hunk
                .lines
                .iter()
                .filter(|l| l.kind == LineKind::Del)
                .count() as u32;
            hunks.push(hunk);
            i += consumed;
        }

        files.push(FileDiff {
            path,
            old_path: file_old_path,
            status,
            additions,
            deletions,
            hunks,
        });
    }

    files
}

fn parse_diff_path(raw: &str, prefix: &str) -> Option<String> {
    // git appends a TAB after a path that contains a space, behind the closing
    // quote of a quoted path included (`--- "a/we\"ird file.txt"\t`): cutting a
    // quoted path at its last quote is what keeps the escapes decodable.
    let raw = if raw.starts_with('"') {
        raw.rfind('"').map_or(raw, |end| &raw[..=end])
    } else {
        raw.trim_end_matches('\t')
    };
    if raw == "/dev/null" {
        return None;
    }
    let path = unquote_path(raw).unwrap_or_else(|| raw.to_string());
    Some(path.strip_prefix(prefix).unwrap_or(&path).to_string())
}

/// Reads the path out of `a/X b/X`, the tail of a `diff --git` header. Only a
/// split where both sides name the same path is accepted, which is both what
/// makes it unambiguous when the path contains spaces and exactly the case
/// where this fallback is needed (a rename states its paths explicitly).
fn path_from_diff_git_header(header: &str) -> Option<String> {
    header.match_indices(' ').find_map(|(i, _)| {
        let old = parse_diff_path(&header[..i], "a/")?;
        let new = parse_diff_path(&header[i + 1..], "b/")?;
        (old == new).then_some(new)
    })
}

/// Undoes the C-style quoting git applies to paths it considers unusual
/// (`"a/ca\303\261\303\263n.txt"`). Unquoted input comes back verbatim;
/// `None` means the quoting is malformed and the caller should not trust it.
fn unquote_path(raw: &str) -> Option<String> {
    let Some(body) = raw.strip_prefix('"').and_then(|r| r.strip_suffix('"')) else {
        return Some(raw.to_string());
    };

    let mut bytes: Vec<u8> = Vec::with_capacity(body.len());
    let mut chars = body.chars();
    while let Some(c) = chars.next() {
        if c != '\\' {
            let mut buf = [0u8; 4];
            bytes.extend_from_slice(c.encode_utf8(&mut buf).as_bytes());
            continue;
        }
        match chars.next()? {
            'a' => bytes.push(0x07),
            'b' => bytes.push(0x08),
            't' => bytes.push(b'\t'),
            'n' => bytes.push(b'\n'),
            'v' => bytes.push(0x0b),
            'f' => bytes.push(0x0c),
            'r' => bytes.push(b'\r'),
            '"' => bytes.push(b'"'),
            '\\' => bytes.push(b'\\'),
            first @ '0'..='7' => {
                let mut value = first.to_digit(8)?;
                for _ in 0..2 {
                    value = value * 8 + chars.next().and_then(|d| d.to_digit(8))?;
                }
                bytes.push(u8::try_from(value).ok()?);
            }
            _ => return None,
        }
    }

    String::from_utf8(bytes).ok()
}

/// Parses one hunk starting at `lines[0]` (its `@@ … @@` header). Returns the
/// hunk and how many lines of `lines` it consumed.
fn parse_hunk(lines: &[&str]) -> Option<(Hunk, usize)> {
    let header = *lines.first()?;
    let (old_start, old_lines, new_start, new_lines) = parse_hunk_header(header)?;

    let mut hunk_lines = Vec::new();
    let mut old_no = old_start;
    let mut new_no = new_start;
    let mut consumed = 1;

    for line in &lines[1..] {
        if line.starts_with("@@") || line.starts_with("diff --git ") {
            break;
        }
        // `\ No newline at end of file` annotates the line above it and may sit
        // in the middle of a hunk: consuming it keeps the rest of the hunk.
        if line.starts_with("\\ ") {
            consumed += 1;
            continue;
        }
        let Some((kind, content)) = classify_line(line) else {
            break;
        };
        let (line_old_no, line_new_no) = match kind {
            LineKind::Context => {
                let numbers = (Some(old_no), Some(new_no));
                old_no += 1;
                new_no += 1;
                numbers
            }
            LineKind::Del => {
                let numbers = (Some(old_no), None);
                old_no += 1;
                numbers
            }
            LineKind::Add => {
                let numbers = (None, Some(new_no));
                new_no += 1;
                numbers
            }
        };
        hunk_lines.push(Line {
            kind,
            old_no: line_old_no,
            new_no: line_new_no,
            content: content.to_string(),
        });
        consumed += 1;
    }

    Some((
        Hunk {
            header: header.to_string(),
            old_start,
            old_lines,
            new_start,
            new_lines,
            lines: hunk_lines,
        },
        consumed,
    ))
}

/// Splits a `@@ -old[,count] +new[,count] @@ tail` header into its four
/// numbers. The tail (e.g. an enclosing function name) is not extracted here
/// because `Hunk.header` keeps the whole line verbatim.
fn parse_hunk_header(line: &str) -> Option<(u32, u32, u32, u32)> {
    let rest = line.strip_prefix("@@ ")?;
    let end = rest.find(" @@")?;
    let ranges = &rest[..end];
    let mut parts = ranges.split_whitespace();
    let old = parts.next()?.strip_prefix('-')?;
    let new = parts.next()?.strip_prefix('+')?;
    let (old_start, old_lines) = parse_range(old)?;
    let (new_start, new_lines) = parse_range(new)?;
    Some((old_start, old_lines, new_start, new_lines))
}

/// A range is either `start` (implicit count of 1) or `start,count`.
fn parse_range(raw: &str) -> Option<(u32, u32)> {
    match raw.split_once(',') {
        Some((start, count)) => Some((start.parse().ok()?, count.parse().ok()?)),
        None => Some((raw.parse().ok()?, 1)),
    }
}

/// A wholly empty line is an empty context line whose leading space git was
/// told to drop (`diff.suppressBlankEmpty`): treating it as unparseable would
/// end the hunk and lose every line below it.
fn classify_line(line: &str) -> Option<(LineKind, &str)> {
    if line.is_empty() {
        return Some((LineKind::Context, line));
    }
    if let Some(content) = line.strip_prefix('+') {
        Some((LineKind::Add, content))
    } else if let Some(content) = line.strip_prefix('-') {
        Some((LineKind::Del, content))
    } else {
        line.strip_prefix(' ')
            .map(|content| (LineKind::Context, content))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_explicit_hunk_header_counts() {
        let header = parse_hunk_header("@@ -12,3 +12,4 @@ fn scope()").expect("valid header");
        assert_eq!(header, (12, 3, 12, 4));
    }

    #[test]
    fn parses_implicit_single_line_hunk_header() {
        let header = parse_hunk_header("@@ -7 +7,2 @@").expect("valid header");
        assert_eq!(header, (7, 1, 7, 2));
    }

    #[test]
    fn rejects_a_line_that_is_not_a_hunk_header() {
        assert!(parse_hunk_header("not a header").is_none());
    }

    #[test]
    fn classifies_add_del_and_context_markers_including_empty_content() {
        assert_eq!(classify_line("+added"), Some((LineKind::Add, "added")));
        assert_eq!(classify_line("-removed"), Some((LineKind::Del, "removed")));
        assert_eq!(classify_line(" kept"), Some((LineKind::Context, "kept")));
        assert_eq!(classify_line("+"), Some((LineKind::Add, "")));
        assert_eq!(classify_line(" "), Some((LineKind::Context, "")));
    }

    /// `diff.suppressBlankEmpty` strips the marker of a blank context line; a
    /// parser that stopped there would silently drop the rest of the hunk.
    #[test]
    fn classifies_a_markerless_blank_line_as_empty_context() {
        assert_eq!(classify_line(""), Some((LineKind::Context, "")));
    }

    #[test]
    fn drops_the_tab_git_appends_behind_the_closing_quote_of_a_path() {
        assert_eq!(
            parse_diff_path("\"a/we\\\"ird file.txt\"\t", "a/"),
            Some("we\"ird file.txt".to_string())
        );
    }

    #[test]
    fn leaves_an_unquoted_path_untouched() {
        assert_eq!(unquote_path("src/app.ts"), Some("src/app.ts".to_string()));
    }

    #[test]
    fn decodes_octal_escapes_of_a_quoted_path_back_into_utf8() {
        assert_eq!(
            unquote_path("\"ca\\303\\261\\303\\263n.txt\""),
            Some("cañón.txt".to_string())
        );
    }

    #[test]
    fn decodes_the_single_character_escapes_of_a_quoted_path() {
        assert_eq!(
            unquote_path("\"we\\\"ird\\\\n\\t.txt\""),
            Some("we\"ird\\n\t.txt".to_string())
        );
    }

    #[test]
    fn rejects_a_quoted_path_with_a_truncated_escape() {
        assert_eq!(unquote_path("\"broken\\30\""), None);
    }

    #[test]
    fn ignores_preamble_lines_before_the_first_file_header() {
        let diff = "\
warning: something noisy
diff --git a/f.txt b/f.txt
index 1111111..2222222 100644
--- a/f.txt
+++ b/f.txt
@@ -1 +1 @@
-old
+new
";
        let files = parse_unified_diff(diff);
        assert_eq!(files.len(), 1);
        assert_eq!(files[0].path, "f.txt");
        assert_eq!(files[0].status, FileStatus::Modified);
    }
}

mod helpers;

use local_reviewer_lib::git::parse::parse_unified_diff;
use local_reviewer_lib::git::{FileDiff, FileStatus, LineKind};

/// Four files in one `git diff` payload: a two-hunk modification, an added
/// file, a deleted file and a rename that also changed content.
const MIXED_DIFF: &str = "\
diff --git a/src/UserService.php b/src/UserService.php
index 1a2b3c4..5d6e7f8 100644
--- a/src/UserService.php
+++ b/src/UserService.php
@@ -30,7 +30,10 @@ class UserService
 class UserService
 {
   public function save(User $u) {
-    $this->repo->persist($u);
+    if (!$u->email) {
+      throw new BadRequest('email');
+    }
+    $this->repo->save($u);
   }
\x20
   private function validate(User $u) {
@@ -98,4 +101,5 @@ class UserService
   private function map(array $r) {
     return new User($r);
   }
+
 }
diff --git a/src/Order.ts b/src/Order.ts
new file mode 100644
index 0000000..b77b4eb
--- /dev/null
+++ b/src/Order.ts
@@ -0,0 +1,3 @@
+export interface Order {
+  id: string;
+}
diff --git a/src/legacy.ts b/src/legacy.ts
deleted file mode 100644
index 814f4a4..0000000
--- a/src/legacy.ts
+++ /dev/null
@@ -1,2 +0,0 @@
-export const legacy = true;
-export default legacy;
diff --git a/src/old/Util.ts b/src/util/Util.ts
similarity index 81%
rename from src/old/Util.ts
rename to src/util/Util.ts
index d0a50b3..d496e63 100644
--- a/src/old/Util.ts
+++ b/src/util/Util.ts
@@ -1,3 +1,5 @@
 export function clamp(n: number, lo: number, hi: number): number {
   return Math.min(hi, Math.max(lo, n));
 }
+
+export const ZERO = 0;
";

const PURE_RENAME_DIFF: &str = "\
diff --git a/docs/a.md b/docs/b.md
similarity index 100%
rename from docs/a.md
rename to docs/b.md
";

/// Unified diff omits the count when a side spans exactly one line.
const IMPLICIT_COUNT_DIFF: &str = "\
diff --git a/one.txt b/one.txt
index 1111111..2222222 100644
--- a/one.txt
+++ b/one.txt
@@ -5 +5,2 @@ fn main()
-only
+first
+second
";

fn file<'a>(files: &'a [FileDiff], path: &str) -> &'a FileDiff {
    files
        .iter()
        .find(|f| f.path == path)
        .unwrap_or_else(|| panic!("no FileDiff for {path}; got {:?}", paths(files)))
}

fn paths(files: &[FileDiff]) -> Vec<&str> {
    files.iter().map(|f| f.path.as_str()).collect()
}

#[test]
fn ts01_parses_every_file_of_a_multi_file_diff_in_order() {
    let files = parse_unified_diff(MIXED_DIFF);

    assert_eq!(
        paths(&files),
        vec![
            "src/UserService.php",
            "src/Order.ts",
            "src/legacy.ts",
            "src/util/Util.ts",
        ]
    );
}

#[test]
fn ts01_parses_multiple_hunks_with_headers_and_ranges() {
    let files = parse_unified_diff(MIXED_DIFF);
    let service = file(&files, "src/UserService.php");

    assert_eq!(service.status, FileStatus::Modified);
    assert_eq!(service.old_path, None);
    assert_eq!(service.additions, 5);
    assert_eq!(service.deletions, 1);
    assert_eq!(service.hunks.len(), 2);

    let first = &service.hunks[0];
    assert_eq!(first.header, "@@ -30,7 +30,10 @@ class UserService");
    assert_eq!(first.old_start, 30);
    assert_eq!(first.old_lines, 7);
    assert_eq!(first.new_start, 30);
    assert_eq!(first.new_lines, 10);

    let second = &service.hunks[1];
    assert_eq!(second.header, "@@ -98,4 +101,5 @@ class UserService");
    assert_eq!(second.old_start, 98);
    assert_eq!(second.old_lines, 4);
    assert_eq!(second.new_start, 101);
    assert_eq!(second.new_lines, 5);
}

#[test]
fn ts01_numbers_and_classifies_every_line_of_a_hunk() {
    let files = parse_unified_diff(MIXED_DIFF);
    let hunk = &file(&files, "src/UserService.php").hunks[0];

    let actual: Vec<(LineKind, Option<u32>, Option<u32>, &str)> = hunk
        .lines
        .iter()
        .map(|l| (l.kind, l.old_no, l.new_no, l.content.as_str()))
        .collect();

    assert_eq!(
        actual,
        vec![
            (LineKind::Context, Some(30), Some(30), "class UserService"),
            (LineKind::Context, Some(31), Some(31), "{"),
            (
                LineKind::Context,
                Some(32),
                Some(32),
                "  public function save(User $u) {"
            ),
            (
                LineKind::Del,
                Some(33),
                None,
                "    $this->repo->persist($u);"
            ),
            (LineKind::Add, None, Some(33), "    if (!$u->email) {"),
            (
                LineKind::Add,
                None,
                Some(34),
                "      throw new BadRequest('email');"
            ),
            (LineKind::Add, None, Some(35), "    }"),
            (LineKind::Add, None, Some(36), "    $this->repo->save($u);"),
            (LineKind::Context, Some(34), Some(37), "  }"),
            (LineKind::Context, Some(35), Some(38), ""),
            (
                LineKind::Context,
                Some(36),
                Some(39),
                "  private function validate(User $u) {"
            ),
        ]
    );
}

#[test]
fn ts01_keeps_numbering_across_hunks_and_keeps_empty_added_lines() {
    let files = parse_unified_diff(MIXED_DIFF);
    let hunk = &file(&files, "src/UserService.php").hunks[1];

    let actual: Vec<(LineKind, Option<u32>, Option<u32>, &str)> = hunk
        .lines
        .iter()
        .map(|l| (l.kind, l.old_no, l.new_no, l.content.as_str()))
        .collect();

    assert_eq!(
        actual,
        vec![
            (
                LineKind::Context,
                Some(98),
                Some(101),
                "  private function map(array $r) {"
            ),
            (
                LineKind::Context,
                Some(99),
                Some(102),
                "    return new User($r);"
            ),
            (LineKind::Context, Some(100), Some(103), "  }"),
            (LineKind::Add, None, Some(104), ""),
            (LineKind::Context, Some(101), Some(105), "}"),
        ]
    );
}

#[test]
fn ts01_detects_an_added_file_with_all_lines_as_add() {
    let files = parse_unified_diff(MIXED_DIFF);
    let added = file(&files, "src/Order.ts");

    assert_eq!(added.status, FileStatus::Added);
    assert_eq!(added.old_path, None);
    assert_eq!(added.additions, 3);
    assert_eq!(added.deletions, 0);
    assert_eq!(added.hunks.len(), 1);

    let hunk = &added.hunks[0];
    assert_eq!(hunk.header, "@@ -0,0 +1,3 @@");
    assert_eq!(hunk.old_start, 0);
    assert_eq!(hunk.old_lines, 0);
    assert_eq!(hunk.new_start, 1);
    assert_eq!(hunk.new_lines, 3);

    let actual: Vec<(LineKind, Option<u32>, Option<u32>, &str)> = hunk
        .lines
        .iter()
        .map(|l| (l.kind, l.old_no, l.new_no, l.content.as_str()))
        .collect();
    assert_eq!(
        actual,
        vec![
            (LineKind::Add, None, Some(1), "export interface Order {"),
            (LineKind::Add, None, Some(2), "  id: string;"),
            (LineKind::Add, None, Some(3), "}"),
        ]
    );
}

#[test]
fn ts01_detects_a_deleted_file_with_all_lines_as_del() {
    let files = parse_unified_diff(MIXED_DIFF);
    let deleted = file(&files, "src/legacy.ts");

    assert_eq!(deleted.status, FileStatus::Deleted);
    assert_eq!(deleted.old_path, None);
    assert_eq!(deleted.additions, 0);
    assert_eq!(deleted.deletions, 2);
    assert_eq!(deleted.hunks.len(), 1);

    let hunk = &deleted.hunks[0];
    assert_eq!(hunk.header, "@@ -1,2 +0,0 @@");
    assert_eq!(hunk.old_start, 1);
    assert_eq!(hunk.old_lines, 2);
    assert_eq!(hunk.new_start, 0);
    assert_eq!(hunk.new_lines, 0);

    let actual: Vec<(LineKind, Option<u32>, Option<u32>, &str)> = hunk
        .lines
        .iter()
        .map(|l| (l.kind, l.old_no, l.new_no, l.content.as_str()))
        .collect();
    assert_eq!(
        actual,
        vec![
            (LineKind::Del, Some(1), None, "export const legacy = true;"),
            (LineKind::Del, Some(2), None, "export default legacy;"),
        ]
    );
}

#[test]
fn ts01_detects_a_rename_with_old_and_new_path() {
    let files = parse_unified_diff(MIXED_DIFF);
    let renamed = file(&files, "src/util/Util.ts");

    assert_eq!(renamed.status, FileStatus::Renamed);
    assert_eq!(renamed.old_path.as_deref(), Some("src/old/Util.ts"));
    assert_eq!(renamed.additions, 2);
    assert_eq!(renamed.deletions, 0);
    assert_eq!(renamed.hunks.len(), 1);

    let actual: Vec<(LineKind, Option<u32>, Option<u32>, &str)> = renamed.hunks[0]
        .lines
        .iter()
        .map(|l| (l.kind, l.old_no, l.new_no, l.content.as_str()))
        .collect();
    assert_eq!(
        actual,
        vec![
            (
                LineKind::Context,
                Some(1),
                Some(1),
                "export function clamp(n: number, lo: number, hi: number): number {"
            ),
            (
                LineKind::Context,
                Some(2),
                Some(2),
                "  return Math.min(hi, Math.max(lo, n));"
            ),
            (LineKind::Context, Some(3), Some(3), "}"),
            (LineKind::Add, None, Some(4), ""),
            (LineKind::Add, None, Some(5), "export const ZERO = 0;"),
        ]
    );
}

#[test]
fn ts01_parses_a_pure_rename_without_hunks() {
    let files = parse_unified_diff(PURE_RENAME_DIFF);

    assert_eq!(files.len(), 1);
    let renamed = &files[0];
    assert_eq!(renamed.path, "docs/b.md");
    assert_eq!(renamed.old_path.as_deref(), Some("docs/a.md"));
    assert_eq!(renamed.status, FileStatus::Renamed);
    assert_eq!(renamed.additions, 0);
    assert_eq!(renamed.deletions, 0);
    assert!(renamed.hunks.is_empty(), "hunks: {:?}", renamed.hunks);
}

#[test]
fn ts01_parses_hunk_headers_with_an_implicit_single_line_count() {
    let files = parse_unified_diff(IMPLICIT_COUNT_DIFF);

    assert_eq!(files.len(), 1);
    let hunk = &files[0].hunks[0];
    assert_eq!(hunk.header, "@@ -5 +5,2 @@ fn main()");
    assert_eq!(hunk.old_start, 5);
    assert_eq!(hunk.old_lines, 1);
    assert_eq!(hunk.new_start, 5);
    assert_eq!(hunk.new_lines, 2);

    let actual: Vec<(LineKind, Option<u32>, Option<u32>, &str)> = hunk
        .lines
        .iter()
        .map(|l| (l.kind, l.old_no, l.new_no, l.content.as_str()))
        .collect();
    assert_eq!(
        actual,
        vec![
            (LineKind::Del, Some(5), None, "only"),
            (LineKind::Add, None, Some(5), "first"),
            (LineKind::Add, None, Some(6), "second"),
        ]
    );
}

#[test]
fn ts01_returns_no_files_for_an_empty_diff() {
    assert_eq!(parse_unified_diff(""), Vec::new());
}

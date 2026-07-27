/**
 * TS-35 — `diff/split-rows.ts`: the pure half of the split view. A `FileDiff`
 * becomes rows that hold, at most, one line per side; the deletions of a change
 * are paired with its additions, the shorter side is filled with gaps and a
 * context line takes the same row on both sides.
 *
 * The contract assumed here (see the phase report):
 *   - a hunk header is a row of its own, `header` set and both sides `null`;
 *   - a content row has `header === undefined` and at least one side;
 *   - a hunk with no lines leaves no header behind, like `buildDiffRows` does.
 */

import { describe, expect, it } from "vitest";
import { splitRows } from "@/diff/split-rows";
import type { SplitRow } from "@/diff/split-rows";
import type { FileDiff, Hunk, Line } from "@/ipc/types";

function context(oldNo: number, newNo: number, content = `ctx ${oldNo}/${newNo}`): Line {
  return { kind: "context", oldNo, newNo, content };
}

function add(newNo: number, content = `add ${newNo}`): Line {
  return { kind: "add", oldNo: null, newNo, content };
}

function del(oldNo: number, content = `del ${oldNo}`): Line {
  return { kind: "del", oldNo, newNo: null, content };
}

function hunk(header: string, lines: Line[]): Hunk {
  return { header, oldStart: 1, oldLines: lines.length, newStart: 1, newLines: lines.length, lines };
}

function file(hunks: Hunk[]): FileDiff {
  return { path: "src/a.ts", oldPath: null, status: "M", additions: 0, deletions: 0, hunks };
}

/** One line of a column: its kind and the number that column shows, or a gap. */
function cellOf(line: Line | null, side: "old" | "new"): string {
  if (line === null) return "·";
  const number = side === "old" ? line.oldNo : line.newNo;
  return `${line.kind} ${number ?? "sin número"}`;
}

function shape(rows: readonly SplitRow[]): string[] {
  return rows.map((row) =>
    row.header === undefined
      ? `${cellOf(row.old, "old")} | ${cellOf(row.new, "new")}`
      : `header ${row.header}`,
  );
}

function contentRows(rows: readonly SplitRow[]): SplitRow[] {
  return rows.filter((row) => row.header === undefined);
}

function numbers(rows: readonly SplitRow[], side: "old" | "new"): Array<number | null> {
  return contentRows(rows).flatMap((row) => {
    const line = side === "old" ? row.old : row.new;
    return line === null ? [] : [side === "old" ? line.oldNo : line.newNo];
  });
}

const REWRITE = file([
  hunk("@@ -10,4 +10,5 @@ fn save()", [
    context(10, 10),
    del(11),
    del(12),
    add(11),
    add(12),
    add(13),
    context(13, 14),
  ]),
]);

/**
 * The rewrite of the phase mockup: git puts the additions before the deletion
 * it replaces, so the run is interleaved and the file numbers, the row indexes
 * and the line indexes are all different from one another.
 *
 *   idx  kind     old  new
 *    0   context   33   33
 *    1   context   34   34
 *    2   add        ·   35
 *    3   add        ·   36
 *    4   add        ·   37
 *    5   del       35    ·
 *    6   del       36    ·
 *    7   add        ·   38
 *    8   context   37   39
 */
const MOCKUP = file([
  hunk("@@ -33,5 +33,7 @@ class UserService", [
    context(33, 33),
    context(34, 34),
    add(35),
    add(36),
    add(37),
    del(35),
    del(36),
    add(38),
    context(37, 39),
  ]),
]);

describe("a hunk pairs its deletions with its additions, row by row", () => {
  it("TS-35: puts the first deletion next to the first addition and so on", () => {
    expect(shape(splitRows(REWRITE))).toEqual([
      "header @@ -10,4 +10,5 @@ fn save()",
      "context 10 | context 10",
      "del 11 | add 11",
      "del 12 | add 12",
      "· | add 13",
      "context 13 | context 14",
    ]);
  });

  it("TS-35: fills the short side with gaps when the deletions outnumber the additions", () => {
    const shrunk = file([
      hunk("@@ -1,4 +1,2 @@", [del(1), del(2), del(3), add(1), context(4, 2)]),
    ]);

    expect(shape(splitRows(shrunk))).toEqual([
      "header @@ -1,4 +1,2 @@",
      "del 1 | add 1",
      "del 2 | ·",
      "del 3 | ·",
      "context 4 | context 2",
    ]);
  });

  it("TS-35: gives a deletion with nothing to pair a row of its own, and an addition too", () => {
    const removed = file([hunk("@@ -1,2 +1,1 @@", [context(1, 1), del(2)])]);
    const inserted = file([hunk("@@ -1,1 +1,2 @@", [context(1, 1), add(2)])]);

    expect(shape(splitRows(removed))).toEqual([
      "header @@ -1,2 +1,1 @@",
      "context 1 | context 1",
      "del 2 | ·",
    ]);
    expect(shape(splitRows(inserted))).toEqual([
      "header @@ -1,1 +1,2 @@",
      "context 1 | context 1",
      "· | add 2",
    ]);
  });

  it("TS-35: pairs inside each run, so a context line between two changes keeps its place", () => {
    const twoRuns = file([
      hunk("@@ -1,5 +1,4 @@", [del(1), add(1), context(2, 2), del(3), del(4), add(3)]),
    ]);

    expect(shape(splitRows(twoRuns))).toEqual([
      "header @@ -1,5 +1,4 @@",
      "del 1 | add 1",
      "context 2 | context 2",
      "del 3 | add 3",
      "del 4 | ·",
    ]);
  });

  it("TS-35: takes a hunk that opens and one that closes on a change", () => {
    const edges = file([
      hunk("@@ -1,3 +1,3 @@", [add(1), context(1, 2), del(2)]),
    ]);

    expect(shape(splitRows(edges))).toEqual([
      "header @@ -1,3 +1,3 @@",
      "· | add 1",
      "context 1 | context 2",
      "del 2 | ·",
    ]);
  });

  it("TS-35: carries the very lines of the file, body and all", () => {
    const rows = contentRows(splitRows(REWRITE));

    expect(rows[1].old?.content).toBe("del 11");
    expect(rows[1].new?.content).toBe("add 11");
    expect(rows[0].old?.content).toBe("ctx 10/10");
    expect(rows[0].new?.content).toBe("ctx 10/10");
    expect(rows[3].old).toBeNull();
    expect(rows[3].new?.content).toBe("add 13");
  });
});

describe("a file changed on one side only leaves the other column empty", () => {
  it("TS-35: a file of nothing but additions has no old line at all", () => {
    const created = file([hunk("@@ -0,0 +1,3 @@", [add(1), add(2), add(3)])]);

    const rows = splitRows(created);
    expect(shape(rows)).toEqual([
      "header @@ -0,0 +1,3 @@",
      "· | add 1",
      "· | add 2",
      "· | add 3",
    ]);
    expect(contentRows(rows).every((row) => row.old === null)).toBe(true);
    expect(numbers(rows, "old")).toEqual([]);
  });

  it("TS-35: a file of nothing but deletions has no new line at all", () => {
    const removed = file([hunk("@@ -1,2 +0,0 @@", [del(1), del(2)])]);

    const rows = splitRows(removed);
    expect(shape(rows)).toEqual(["header @@ -1,2 +0,0 @@", "del 1 | ·", "del 2 | ·"]);
    expect(contentRows(rows).every((row) => row.new === null)).toBe(true);
    expect(numbers(rows, "new")).toEqual([]);
  });
});

describe("the headers of the hunks are rows of their own", () => {
  it("TS-35: puts each header before the rows of its hunk, one per hunk", () => {
    const twoHunks = file([
      hunk("@@ uno @@", [del(1), add(1)]),
      hunk("@@ dos @@", [context(9, 9), add(10)]),
    ]);

    const rows = splitRows(twoHunks);
    expect(shape(rows)).toEqual([
      "header @@ uno @@",
      "del 1 | add 1",
      "header @@ dos @@",
      "context 9 | context 9",
      "· | add 10",
    ]);
    for (const row of rows.filter((candidate) => candidate.header !== undefined)) {
      expect(row.old).toBeNull();
      expect(row.new).toBeNull();
    }
  });

  it("TS-35: drops a hunk with no lines instead of leaving a lone header", () => {
    const withEmpty = file([hunk("@@ vacío @@", []), hunk("@@ uno @@", [add(1)])]);

    expect(shape(splitRows(withEmpty))).toEqual(["header @@ uno @@", "· | add 1"]);
  });

  it("TS-35: answers no rows for a file with no hunks, like a binary one", () => {
    expect(splitRows(file([]))).toEqual([]);
  });

  it("TS-35: a file of a single line is a single row", () => {
    expect(shape(splitRows(file([hunk("@@ -0,0 +1,1 @@", [add(1)])])))).toEqual([
      "header @@ -0,0 +1,1 @@",
      "· | add 1",
    ]);
  });
});

/**
 * The mockup of the phase draws the gaps of an interleaved run above the pair
 * and the plain reading of "they are paired in order" puts them below, so where
 * the lone deletion of a run lands is left open. What is not open: no line may
 * be lost, duplicated or reordered, no row may be empty on both sides, and the
 * run may not take more rows than its longer side.
 */
describe("whatever the pairing, no line is lost and no row is wasted", () => {
  it("TS-35: keeps every old and every new line once, in the order of the file", () => {
    const rows = splitRows(MOCKUP);

    expect(numbers(rows, "old")).toEqual([33, 34, 35, 36, 37]);
    expect(numbers(rows, "new")).toEqual([33, 34, 35, 36, 37, 38, 39]);
  });

  it("TS-35: spends one row per pair, so the run is as long as its longer side", () => {
    // Two contexts, a run of two deletions against four additions, one context.
    expect(contentRows(splitRows(MOCKUP))).toHaveLength(2 + 4 + 1);
    expect(splitRows(MOCKUP)).toHaveLength(1 + 7);
  });

  it("TS-35: never leaves a row empty on both sides", () => {
    for (const row of contentRows(splitRows(MOCKUP))) {
      expect(row.old === null && row.new === null).toBe(false);
    }
  });

  it("TS-35: a row holds either the same context line twice or a deletion against an addition", () => {
    for (const row of contentRows(splitRows(MOCKUP))) {
      if (row.old === null || row.new === null) continue;
      if (row.old.kind === "context") {
        expect(row.new.kind).toBe("context");
        expect(row.new.content).toBe(row.old.content);
        expect(row.old.oldNo).not.toBeNull();
        expect(row.new.newNo).not.toBeNull();
        continue;
      }
      expect([row.old.kind, row.new.kind]).toEqual(["del", "add"]);
    }
  });

  it("TS-35: never shows a line on the column it does not belong to", () => {
    for (const row of contentRows(splitRows(MOCKUP))) {
      if (row.old !== null) expect(row.old.oldNo).not.toBeNull();
      if (row.new !== null) expect(row.new.newNo).not.toBeNull();
    }
  });
});

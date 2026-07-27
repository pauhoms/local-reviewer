/**
 * The half of `diff/split-rows.ts` the panel needs on top of the rows: which
 * row each item sits on, which line index each cell carries, and how a cursor
 * travels between the two views without changing line.
 */

import { describe, expect, it } from "vitest";
import { itemOfLine, lineOfItem, splitAnchor, splitLayout } from "@/diff/split-rows";
import type { SplitLayout } from "@/diff/split-rows";
import type { FileDiff, Hunk, Line } from "@/ipc/types";

function context(oldNo: number, newNo: number): Line {
  return { kind: "context", oldNo, newNo, content: `ctx ${oldNo}/${newNo}` };
}

function add(newNo: number): Line {
  return { kind: "add", oldNo: null, newNo, content: `add ${newNo}` };
}

function del(oldNo: number): Line {
  return { kind: "del", oldNo, newNo: null, content: `del ${oldNo}` };
}

function hunk(header: string, lines: Line[]): Hunk {
  return { header, oldStart: 1, oldLines: lines.length, newStart: 1, newLines: lines.length, lines };
}

function file(hunks: Hunk[]): FileDiff {
  return { path: "src/a.ts", oldPath: null, status: "M", additions: 0, deletions: 0, hunks };
}

/**
 * Line index, item index and row index are three different numbers here: the
 * run interleaves its additions and its deletions and there are two hunks. Git
 * writes every `-` of a block before its `+`, so this order is not one it
 * emits; the layout may not lean on that order either.
 *
 *   line  kind     old  new    item  row
 *     0   context   33   33      0    1
 *     1   context   34   34      1    2
 *     2   add        ·   35      2    3   paired with line 5
 *     3   add        ·   36      3    4   paired with line 6
 *     4   add        ·   37      4    5
 *     5   del       35    ·      2    3
 *     6   del       36    ·      3    4
 *     7   add        ·   38      5    6
 *     8   context   37   39      6    7
 *     9   context   98  100      7    9
 *    10   add        ·  101      8   10
 *    11   context   99  102      9   11
 */
const MOCKUP = file([
  hunk("@@ -33,5 +33,7 @@", [
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
  hunk("@@ -98,3 +100,4 @@", [context(98, 100), add(101), context(99, 102)]),
]);

const LAYOUT: SplitLayout = splitLayout(MOCKUP);

function cellIndexes(layout: SplitLayout, side: "old" | "new"): Array<number | null> {
  return layout.itemRows.map((row) => {
    const entry = layout.rows[row];
    if (entry.kind === "header") throw new Error(`la fila ${row} es una cabecera, no un item`);
    return (side === "old" ? entry.old : entry.new)?.index ?? null;
  });
}

describe("the layout says where every item and every line of the file lands", () => {
  it("puts each item on the row it is rendered at, headers included in the count", () => {
    expect(LAYOUT.itemRows).toEqual([1, 2, 3, 4, 5, 6, 7, 9, 10, 11]);
    expect(LAYOUT.rows).toHaveLength(12);
  });

  it("numbers each cell with the line index the unified view walks", () => {
    expect(cellIndexes(LAYOUT, "old")).toEqual([0, 1, 5, 6, null, null, 8, 9, null, 11]);
    expect(cellIndexes(LAYOUT, "new")).toEqual([0, 1, 2, 3, 4, 7, 8, 9, 10, 11]);
  });

  it("numbers the items in the order the cursor walks them", () => {
    const items = LAYOUT.rows.flatMap((row) => (row.kind === "row" ? [row.item] : []));

    expect(items).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it("answers nothing at all for a file with no hunks", () => {
    expect(splitLayout(file([]))).toEqual({ rows: [], itemRows: [] });
    expect(splitLayout(null)).toEqual({ rows: [], itemRows: [] });
  });
});

describe("a cursor coming from the unified view keeps its line", () => {
  it("takes a deletion to the old side, where the line lives", () => {
    expect(itemOfLine(LAYOUT, 6, "new")).toEqual({ item: 3, side: "old" });
  });

  it("takes an addition to the new side", () => {
    expect(itemOfLine(LAYOUT, 7, "old")).toEqual({ item: 5, side: "new" });
  });

  it("leaves the side alone on a context line, which both columns hold", () => {
    expect(itemOfLine(LAYOUT, 8, "old")).toEqual({ item: 6, side: "old" });
    expect(itemOfLine(LAYOUT, 8, "new")).toEqual({ item: 6, side: "new" });
  });

  it("falls back to the first item for a line the file does not have", () => {
    expect(itemOfLine(LAYOUT, 99, "new")).toEqual({ item: 0, side: "new" });
    expect(itemOfLine(LAYOUT, -1, "new")).toEqual({ item: 0, side: "new" });
  });
});

describe("a cursor going back to the unified view keeps its line too", () => {
  it("answers the line of the active side", () => {
    expect(lineOfItem(LAYOUT, 3, "old")).toBe(6);
    expect(lineOfItem(LAYOUT, 3, "new")).toBe(3);
  });

  it("answers the line of the other side when the active one is a gap", () => {
    expect(lineOfItem(LAYOUT, 4, "old")).toBe(4);
    expect(lineOfItem(LAYOUT, 8, "old")).toBe(10);
  });

  it("answers the first line for an item nobody has", () => {
    expect(lineOfItem(LAYOUT, 99, "new")).toBe(0);
    expect(lineOfItem(LAYOUT, -1, "new")).toBe(0);
  });

  it("comes back to the same item from a gap, on the column the line really lives on", () => {
    // Item 4 is a gap on the old side: the way out borrows the line of the new
    // one, and the way back in follows that line to the column that holds it.
    const line = lineOfItem(LAYOUT, 4, "old");

    expect(itemOfLine(LAYOUT, line, "old")).toEqual({ item: 4, side: "new" });
  });
});

describe("a range of items anchors to the lines the active side really has", () => {
  it("takes the lowest and the highest number of the active side", () => {
    expect(splitAnchor(LAYOUT, "new", 0, 2)).toEqual({ side: "new", from: 33, to: 35 });
    expect(splitAnchor(LAYOUT, "old", 0, 3)).toEqual({ side: "old", from: 33, to: 36 });
  });

  it("skips the gaps the active side has inside the range", () => {
    expect(splitAnchor(LAYOUT, "old", 2, 5)).toEqual({ side: "old", from: 35, to: 36 });
  });

  it("reads the range in either order", () => {
    expect(splitAnchor(LAYOUT, "old", 5, 2)).toEqual(splitAnchor(LAYOUT, "old", 2, 5));
  });

  it("answers nothing when the active side is a gap all the way through", () => {
    expect(splitAnchor(LAYOUT, "old", 4, 5)).toBeNull();
    expect(splitAnchor(splitLayout(file([])), "new", 0, 0)).toBeNull();
  });

  it("stops at the last item however far the range reaches", () => {
    expect(splitAnchor(LAYOUT, "new", 8, 400)).toEqual({ side: "new", from: 101, to: 102 });
  });
});

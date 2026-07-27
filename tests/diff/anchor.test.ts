import { describe, expect, it } from "vitest";
import { anchorFor, diffLines, rowOfLine } from "@/diff/anchor";
import type { FileDiff, Line } from "@/ipc/types";

function context(oldNo: number, newNo: number): Line {
  return { kind: "context", oldNo, newNo, content: "igual" };
}

function add(newNo: number): Line {
  return { kind: "add", oldNo: null, newNo, content: "nuevo" };
}

function del(oldNo: number): Line {
  return { kind: "del", oldNo, newNo: null, content: "viejo" };
}

/** idx 0..5: context(33,33) add(35) del(35) del(36) add(38) context(37,39) */
const LINES: Line[] = [context(33, 33), add(35), del(35), del(36), add(38), context(37, 39)];

function fileWith(...hunks: Line[][]): FileDiff {
  return {
    path: "src/a.php",
    oldPath: null,
    status: "M",
    additions: 0,
    deletions: 0,
    hunks: hunks.map((lines, index) => ({
      header: `@@ hunk ${index} @@`,
      oldStart: 1,
      oldLines: lines.length,
      newStart: 1,
      newLines: lines.length,
      lines,
    })),
  };
}

describe("anchorFor", () => {
  it("takes the new side and its numbers when the range is all additions", () => {
    expect(anchorFor(LINES, 1, 1)).toEqual({ side: "new", from: 35, to: 35 });
  });

  it("takes the old side when the range is nothing but deletions", () => {
    expect(anchorFor(LINES, 2, 3)).toEqual({ side: "old", from: 35, to: 36 });
  });

  it("takes the new side and only its new numbers when the range is mixed", () => {
    expect(anchorFor(LINES, 1, 4)).toEqual({ side: "new", from: 35, to: 38 });
  });

  it("anchors a context line by its new number, not its old one", () => {
    expect(anchorFor(LINES, 5, 5)).toEqual({ side: "new", from: 39, to: 39 });
  });

  it("reads a range given backwards the same way", () => {
    expect(anchorFor(LINES, 3, 2)).toEqual({ side: "old", from: 35, to: 36 });
  });

  it("clamps a range that runs past the end of the file", () => {
    expect(anchorFor(LINES, 4, 99)).toEqual({ side: "new", from: 38, to: 39 });
  });

  it("answers nothing when the range falls outside the file altogether", () => {
    expect(anchorFor(LINES, 12, 20)).toBeNull();
    expect(anchorFor([], 0, 0)).toBeNull();
  });

  it("answers nothing for a range of lines that carry no number at all", () => {
    const nameless: Line[] = [{ kind: "add", oldNo: null, newNo: null, content: "rara" }];

    expect(anchorFor(nameless, 0, 0)).toBeNull();
  });
});

describe("rowOfLine", () => {
  it("finds the row of a line of the new side", () => {
    expect(rowOfLine(LINES, "new", 38)).toBe(4);
  });

  it("tells the deleted line 35 apart from the added line 35", () => {
    expect(rowOfLine(LINES, "old", 35)).toBe(2);
    expect(rowOfLine(LINES, "new", 35)).toBe(1);
  });

  it("falls back to the first row when the line is not in the diff", () => {
    expect(rowOfLine(LINES, "new", 900)).toBe(0);
    expect(rowOfLine([], "old", 1)).toBe(0);
  });
});

describe("diffLines", () => {
  it("flattens the hunks into the very order the panel walks", () => {
    const file = fileWith([context(1, 1), add(2)], [del(9)]);

    expect(diffLines(file).map((line) => line.kind)).toEqual(["context", "add", "del"]);
  });

  it("answers no lines for a file that is not in the changes", () => {
    expect(diffLines(null)).toEqual([]);
  });
});

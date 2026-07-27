import { describe, expect, it } from "vitest";
import { buildDiffRows, countDiffLines, lineBody } from "@/diff/rows";
import type { FileDiff, Hunk, Line } from "@/ipc/types";

function add(newNo: number, content: string): Line {
  return { kind: "add", oldNo: null, newNo, content };
}

function hunk(header: string, lines: Line[]): Hunk {
  return { header, oldStart: 1, oldLines: lines.length, newStart: 1, newLines: lines.length, lines };
}

function file(hunks: Hunk[]): FileDiff {
  return { path: "src/a.ts", oldPath: null, status: "M", additions: 0, deletions: 0, hunks };
}

const TWO_HUNKS = file([
  hunk("@@ uno @@", [add(1, "a"), add(2, "b")]),
  hunk("@@ dos @@", [add(3, "c")]),
]);

describe("the rows of a file are its headers and its lines, in order", () => {
  it("puts each header right before the lines of its hunk", () => {
    const { rows } = buildDiffRows(TWO_HUNKS);

    expect(rows.map((row) => (row.kind === "header" ? row.header : `línea ${row.index}`))).toEqual([
      "@@ uno @@",
      "línea 0",
      "línea 1",
      "@@ dos @@",
      "línea 2",
    ]);
  });

  it("numbers the lines across hunks, not inside each one", () => {
    const { rows } = buildDiffRows(TWO_HUNKS);
    const lines = rows.flatMap((row) => (row.kind === "line" ? [row] : []));

    expect(lines.map((row) => row.index)).toEqual([0, 1, 2]);
    expect(lines.map((row) => row.line.content)).toEqual(["a", "b", "c"]);
  });

  it("says at which row each line sits, so the scroll can find it", () => {
    const { lineRows } = buildDiffRows(TWO_HUNKS);

    expect(lineRows).toEqual([1, 2, 4]);
  });

  it("drops a hunk that carries no lines instead of leaving a lone header", () => {
    const { rows, lineRows } = buildDiffRows(file([hunk("@@ vacío @@", []), hunk("@@ uno @@", [add(1, "a")])]));

    expect(rows.map((row) => row.kind)).toEqual(["header", "line"]);
    expect(rows[0]).toEqual({ kind: "header", header: "@@ uno @@" });
    expect(lineRows).toEqual([1]);
  });

  it("answers an empty list for a file with no hunks and for no file at all", () => {
    expect(buildDiffRows(file([])).rows).toEqual([]);
    expect(buildDiffRows(null).rows).toEqual([]);
    expect(buildDiffRows(null).lineRows).toEqual([]);
  });
});

describe("counting the lines never walks them twice", () => {
  it("adds up the lines of every hunk", () => {
    expect(countDiffLines(TWO_HUNKS)).toBe(3);
    expect(countDiffLines(file([]))).toBe(0);
    expect(countDiffLines(null)).toBe(0);
  });
});

describe("the body on show is the one of the diff line", () => {
  it("drops the carriage return a CRLF repo leaves behind", () => {
    expect(lineBody("fin con retorno\r")).toBe("fin con retorno");
    expect(lineBody("\r")).toBe("");
  });

  it("keeps tabs, blanks and anything else the line carries", () => {
    expect(lineBody("\tcon tabulador")).toBe("\tcon tabulador");
    expect(lineBody("")).toBe("");
    expect(lineBody("señal 🚀  ")).toBe("señal 🚀  ");
  });
});

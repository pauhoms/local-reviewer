import { describe, expect, it } from "vitest";
import { lineAtRow, lineWindow, mountedRows, scrollRowFor } from "@/diff/window";

function windowOf(total: number, pageSize: number, cursor: number, offset: number): [number, number] {
  const { first, last } = lineWindow({ total, pageSize, cursor, offset });
  return [first, last];
}

describe("the window on show is a page of lines", () => {
  it("shows a whole page when the file is longer", () => {
    expect(windowOf(200, 20, 0, 0)).toEqual([0, 19]);
    expect(windowOf(200, 20, 30, 30)).toEqual([30, 49]);
  });

  it("shows the whole file when it is shorter than a page", () => {
    expect(windowOf(3, 20, 0, 0)).toEqual([0, 2]);
    expect(windowOf(1, 20, 0, 0)).toEqual([0, 0]);
  });

  it("never scrolls past the last page", () => {
    expect(windowOf(200, 20, 199, 500)).toEqual([180, 199]);
  });
});

describe("the window follows the cursor in both directions", () => {
  it("pulls the window up when the cursor is above it", () => {
    expect(windowOf(200, 20, 5, 100)).toEqual([5, 24]);
  });

  it("pushes the window down when the cursor is below it", () => {
    expect(windowOf(200, 20, 40, 0)).toEqual([21, 40]);
  });

  it("leaves the window alone while the cursor is inside it", () => {
    expect(windowOf(200, 20, 35, 30)).toEqual([30, 49]);
  });
});

describe("the window holds together on degenerate input", () => {
  it("answers a single row for a file with no lines", () => {
    expect(windowOf(0, 20, 0, 0)).toEqual([0, 0]);
  });

  it("shows at least one line when there is no page to speak of", () => {
    expect(windowOf(200, 0, 7, 0)).toEqual([7, 7]);
    expect(windowOf(200, -3, 7, 0)).toEqual([7, 7]);
  });

  it("keeps a cursor out of range inside the file", () => {
    expect(windowOf(10, 20, 99, 0)).toEqual([0, 9]);
    expect(windowOf(200, 20, -4, 50)).toEqual([0, 19]);
  });
});

describe("the scroll shows the header of the hunk it opens on", () => {
  const lineRows = [1, 2, 3, 5, 6, 7];

  it("goes up to the header when the first line on show opens a hunk", () => {
    expect(scrollRowFor(lineRows, 0)).toBe(0);
    expect(scrollRowFor(lineRows, 3)).toBe(4);
  });

  it("stops at the line itself when no header sits above it", () => {
    expect(scrollRowFor(lineRows, 1)).toBe(2);
    expect(scrollRowFor(lineRows, 5)).toBe(7);
  });

  it("answers the top of the list when there is no such line", () => {
    expect(scrollRowFor(lineRows, 99)).toBe(0);
    expect(scrollRowFor([], 0)).toBe(0);
  });
});

describe("a scroll lands on a row and has to name a line", () => {
  const lineRows = [1, 2, 3, 5, 6, 7];

  it("answers the line sitting on that row", () => {
    expect(lineAtRow(lineRows, 2)).toBe(1);
    expect(lineAtRow(lineRows, 7)).toBe(5);
  });

  it("answers the first line below a row that holds a hunk header", () => {
    expect(lineAtRow(lineRows, 0)).toBe(0);
    expect(lineAtRow(lineRows, 4)).toBe(3);
  });

  it("stays inside the file when the row is out of it", () => {
    expect(lineAtRow(lineRows, -5)).toBe(0);
    expect(lineAtRow(lineRows, 99)).toBe(5);
    expect(lineAtRow([], 3)).toBe(0);
  });
});

describe("the rows mounted are the ones on show plus a margin", () => {
  const lineRows = [1, 2, 3, 5, 6, 7];
  const rowCount = 8;

  it("adds the margin on both sides in row space", () => {
    expect(mountedRows(lineRows, rowCount, { first: 3, last: 4 }, 1)).toEqual({ start: 4, end: 7 });
  });

  it("clamps the margin to the ends of the list", () => {
    expect(mountedRows(lineRows, rowCount, { first: 0, last: 5 }, 4)).toEqual({ start: 0, end: 7 });
  });

  it("mounts nothing when there is nothing to mount", () => {
    expect(mountedRows([], 0, { first: 0, last: 0 }, 5)).toEqual({ start: 0, end: -1 });
  });

  it("falls back to the ends when the window names lines that are not there", () => {
    expect(mountedRows(lineRows, rowCount, { first: 9, last: 12 }, 0)).toEqual({ start: 0, end: 7 });
  });
});

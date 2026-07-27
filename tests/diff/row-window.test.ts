import { describe, expect, it } from "vitest";
import { diffPage, linesInWindow, rowWindow } from "@/diff/window";

/** Three hunks of three lines: 0 header, 1-3 lines, 4 header, 5-7 lines, 8 header, 9-11 lines. */
const LINE_ROWS = [1, 2, 3, 5, 6, 7, 9, 10, 11];
const ROW_COUNT = 12;

function windowOf(pageSize: number, cursor: number, offset: number): [number, number] {
  const { first, last } = rowWindow(LINE_ROWS, { rowCount: ROW_COUNT, pageSize, cursor, offset });
  return [first, last];
}

describe("the window on show is a page of rows, headers included", () => {
  it("spends part of the page on the header above the first line", () => {
    expect(windowOf(4, 0, 0)).toEqual([0, 3]);
    expect(linesInWindow(LINE_ROWS, { first: 0, last: 3 })).toEqual({ first: 0, last: 2 });
  });

  it("stops on the row of the cursor when it walks past the bottom", () => {
    expect(windowOf(4, 5, 0)).toEqual([4, 7]);
    expect(windowOf(4, 8, 0)).toEqual([8, 11]);
  });

  it("leaves the window alone while the row of the cursor is inside it", () => {
    expect(windowOf(4, 4, 4)).toEqual([4, 7]);
  });

  it("holds a page of one row on the cursor itself", () => {
    expect(windowOf(1, 6, 0)).toEqual([9, 9]);
  });

  it("answers a single row for a file with no lines", () => {
    expect(rowWindow([], { rowCount: 0, pageSize: 4, cursor: 0, offset: 0 })).toEqual({
      first: 0,
      last: 0,
    });
  });
});

describe("the window opens on the header of the hunk it comes down on", () => {
  it("takes the header in when the cursor is the first line of its hunk", () => {
    expect(windowOf(4, 3, 8)).toEqual([4, 7]);
  });

  it("leaves the header out when taking it in would drop the cursor", () => {
    expect(windowOf(1, 3, 8)).toEqual([5, 5]);
  });
});

describe("the lines on show are the ones whose row is inside the window", () => {
  it("names the first and the last line the window holds whole", () => {
    expect(linesInWindow(LINE_ROWS, { first: 3, last: 6 })).toEqual({ first: 2, last: 4 });
  });

  it("stops above a header sitting on the last row", () => {
    expect(linesInWindow(LINE_ROWS, { first: 5, last: 8 })).toEqual({ first: 3, last: 5 });
  });

  it("answers the first line for a file with no lines at all", () => {
    expect(linesInWindow([], { first: 0, last: 4 })).toEqual({ first: 0, last: 0 });
  });
});

/**
 * One page, asked for once: the panel paints it and the keyboard halves it, and
 * the two must be counting the same thing or Ctrl+d lands off the screen.
 */
describe("the page holds the rows on show and the items inside them", () => {
  function pageOf(pageSize: number, cursor: number, offset: number) {
    return diffPage(LINE_ROWS, { rowCount: ROW_COUNT, pageSize, cursor, offset });
  }

  it("counts the items of the window, headers taking their share of the rows", () => {
    const page = pageOf(4, 0, 0);

    expect(page.visible).toEqual({ first: 0, last: 3 });
    expect(page.items).toEqual({ first: 0, last: 2 });
    expect(page.itemCount).toBe(3);
  });

  it("counts the two headers a longer window swallows on the way down", () => {
    const page = pageOf(6, 4, 4);

    expect(page.visible).toEqual({ first: 4, last: 9 });
    expect(page.itemCount).toBe(4);
  });

  it("holds one item at the very least, however little there is to show", () => {
    expect(diffPage([], { rowCount: 0, pageSize: 4, cursor: 0, offset: 0 }).itemCount).toBe(1);
    expect(pageOf(1, 6, 0).itemCount).toBe(1);
  });
});

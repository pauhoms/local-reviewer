/** Rows a page holds while the viewport has no size to measure. */
export const DEFAULT_PAGE_SIZE = 20;

/** Rows kept mounted above and below the window. */
export const OVERSCAN = 5;

export interface WindowInput {
  total: number;
  /** Items the viewport fits, as last measured. */
  pageSize: number;
  cursor: number;
  /** First item the scroll was left on. */
  offset: number;
}

/** A run of consecutive indexes, both ends included. */
export interface IndexWindow {
  first: number;
  last: number;
}

export interface RowRange {
  start: number;
  /** Inclusive; `-1` when there is nothing to mount. */
  end: number;
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(Math.max(value, low), high);
}

/** A page of consecutive items holding the cursor, in whatever unit it is fed. */
export function lineWindow({ total, pageSize, cursor, offset }: WindowInput): IndexWindow {
  const page = Math.max(1, Math.floor(pageSize));
  const lastLine = Math.max(0, total - 1);
  const head = clamp(cursor, 0, lastLine);

  let first = clamp(offset, 0, Math.max(0, total - page));
  if (head < first) first = head;
  else if (head > first + page - 1) first = head - page + 1;

  first = clamp(first, 0, lastLine);
  return { first, last: Math.max(first, Math.min(lastLine, first + page - 1)) };
}

/** Where to scroll to show a line: a hunk header above it belongs with it. */
export function scrollRowFor(lineRows: readonly number[], first: number): number {
  const row = lineRows[first];
  if (row === undefined) return 0;
  const above = first > 0 ? lineRows[first - 1] + 1 : 0;
  return above < row ? above : row;
}

/** The line a scroll stopped on: hunk headers take a row without being a line. */
export function lineAtRow(lineRows: readonly number[], row: number): number {
  const found = lineRows.findIndex((at) => at >= row);
  if (found >= 0) return found;
  return Math.max(0, lineRows.length - 1);
}

export interface RowWindowInput {
  rowCount: number;
  /** Rows the viewport fits, as last measured. */
  pageSize: number;
  /** Diff line the cursor is on. */
  cursor: number;
  /** First row the scroll was left on. */
  offset: number;
}

/**
 * The rows on show. The row is the unit of virtualization — a hunk header takes
 * one without being a line — so only a window measured in rows fits the viewport
 * that was measured in rows, and only then does the cursor stay above the fold.
 */
export function rowWindow(
  lineRows: readonly number[],
  { rowCount, pageSize, cursor, offset }: RowWindowInput,
): IndexWindow {
  const cursorRow = lineRows[clamp(cursor, 0, lineRows.length - 1)] ?? 0;
  const view = lineWindow({ total: rowCount, pageSize, cursor: cursorRow, offset });

  // A hunk header belongs with the line under it: a window coming down on that
  // line takes the header in, unless the row it gives up is the cursor's own.
  const opened = scrollRowFor(lineRows, lineAtRow(lineRows, view.first));
  if (opened < view.first && cursorRow < view.last) return { first: opened, last: view.last - 1 };
  return view;
}

/** The lines a window of rows holds whole. */
export function linesInWindow(
  lineRows: readonly number[],
  { first, last }: IndexWindow,
): IndexWindow {
  const firstLine = lineAtRow(lineRows, first);
  let lastLine = firstLine;
  while (lastLine + 1 < lineRows.length && lineRows[lastLine + 1] <= last) lastLine += 1;
  return { first: firstLine, last: lastLine };
}

export interface DiffPage {
  /** Rows the viewport shows, both ends included. */
  visible: IndexWindow;
  /** Items those rows hold whole. */
  items: IndexWindow;
  /** How many, never zero: half of it is what Ctrl+d walks. */
  itemCount: number;
}

/**
 * The page on show, asked for once. The panel paints it and the keyboard halves
 * it, so both read it from here: a page counted twice is a page counted two
 * ways, and then Ctrl+d lands somewhere the reader cannot see.
 */
export function diffPage(lineRows: readonly number[], input: RowWindowInput): DiffPage {
  const visible = rowWindow(lineRows, input);
  const items = linesInWindow(lineRows, visible);
  return {
    visible,
    items,
    itemCount: lineRows.length === 0 ? 1 : items.last - items.first + 1,
  };
}

/**
 * A margin of rows above and below keeps a slow scroll from showing the gap
 * before React fills it.
 */
export function mountedRows(
  lineRows: readonly number[],
  rowCount: number,
  { first, last }: IndexWindow,
  overscan: number,
): RowRange {
  if (rowCount <= 0) return { start: 0, end: -1 };
  const lastRow = rowCount - 1;
  const top = lineRows[first] ?? 0;
  const bottom = lineRows[last] ?? lastRow;
  return {
    start: clamp(top - overscan, 0, lastRow),
    end: clamp(bottom + overscan, 0, lastRow),
  };
}

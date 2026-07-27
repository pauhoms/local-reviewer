import type { FileDiff, Line, Side } from "@/ipc/types";
import type { Anchor } from "./anchor";

/** A row of the split view: at most one line per column, or a hunk header. */
export interface SplitRow {
  old: Line | null;
  new: Line | null;
  header?: string;
}

/** A line of one column, with the index the unified view knows it by. */
export interface SplitLine {
  line: Line;
  index: number;
}

export type SplitLayoutRow =
  | { kind: "header"; header: string }
  | { kind: "row"; item: number; old: SplitLine | null; new: SplitLine | null };

export interface SplitLayout {
  rows: SplitLayoutRow[];
  /** Row each item sits on: the cursor walks items, the viewport scrolls rows. */
  itemRows: number[];
}

const NO_ROWS: SplitLayout = { rows: [], itemRows: [] };

/**
 * Kept per file: every key press asks how many rows the split has, and a diff
 * of a hundred thousand lines is not something to pair again on each of them.
 */
const built = new WeakMap<FileDiff, SplitLayout>();

/**
 * The rows of the split view, paired run by run. A context line closes the run
 * it follows and takes the same row on both columns; inside a run the deletions
 * meet the additions in order and the shorter column ends in gaps.
 */
export function splitLayout(file: FileDiff | null): SplitLayout {
  if (!file) return NO_ROWS;
  const known = built.get(file);
  if (known) return known;
  const layout = pairUp(file);
  built.set(file, layout);
  return layout;
}

function pairUp(file: FileDiff): SplitLayout {
  const rows: SplitLayoutRow[] = [];
  const itemRows: number[] = [];

  let index = 0;
  for (const hunk of file.hunks) {
    if (hunk.lines.length === 0) continue;
    rows.push({ kind: "header", header: hunk.header });

    let dels: SplitLine[] = [];
    let adds: SplitLine[] = [];

    const push = (old: SplitLine | null, added: SplitLine | null): void => {
      itemRows.push(rows.length);
      rows.push({ kind: "row", item: itemRows.length - 1, old, new: added });
    };
    const flush = (): void => {
      const paired = Math.max(dels.length, adds.length);
      for (let at = 0; at < paired; at += 1) push(dels[at] ?? null, adds[at] ?? null);
      dels = [];
      adds = [];
    };

    for (const line of hunk.lines) {
      const cell: SplitLine = { line, index };
      index += 1;
      if (line.kind === "context") {
        flush();
        push(cell, cell);
        continue;
      }
      if (line.kind === "del") dels.push(cell);
      else adds.push(cell);
    }
    flush();
  }
  return { rows, itemRows };
}

/**
 * The same pairing in its plain shape: one line per column and nothing else.
 * The panel walks `splitLayout`, which carries besides the indexes it needs to
 * place a cursor; this is the projection the pairing is described and checked
 * against, without the bookkeeping.
 */
export function splitRows(file: FileDiff): SplitRow[] {
  return splitLayout(file).rows.map((row) =>
    row.kind === "header"
      ? { old: null, new: null, header: row.header }
      : { old: row.old?.line ?? null, new: row.new?.line ?? null },
  );
}

/**
 * Where a cursor coming from the unified view lands. A line that only one column
 * holds drags the active side with it: leaving the cursor on the other one would
 * comment a line nobody chose.
 */
export function itemOfLine(
  layout: SplitLayout,
  index: number,
  side: Side,
): { item: number; side: Side } {
  for (const row of layout.rows) {
    if (row.kind === "header") continue;
    const onOld = row.old?.index === index;
    const onNew = row.new?.index === index;
    if (!onOld && !onNew) continue;
    if (onOld && onNew) return { item: row.item, side };
    return { item: row.item, side: onOld ? "old" : "new" };
  }
  return { item: 0, side };
}

/** The line a cursor going back to the unified view keeps: the active side wins. */
export function lineOfItem(layout: SplitLayout, item: number, side: Side): number {
  const row = layout.rows[layout.itemRows[item] ?? -1];
  if (row === undefined || row.kind === "header") return 0;
  const own = side === "old" ? row.old : row.new;
  const other = side === "old" ? row.new : row.old;
  return (own ?? other)?.index ?? 0;
}

/** What a range of items anchors to on one column, gaps left out. */
export function splitAnchor(
  layout: SplitLayout,
  side: Side,
  from: number,
  to: number,
): Anchor | null {
  const first = Math.max(0, Math.min(from, to));
  const last = Math.min(layout.itemRows.length - 1, Math.max(from, to));
  let lowest: number | null = null;
  let highest: number | null = null;

  for (let item = first; item <= last; item += 1) {
    const row = layout.rows[layout.itemRows[item]];
    if (row === undefined || row.kind === "header") continue;
    const cell = side === "old" ? row.old : row.new;
    if (cell === null) continue;
    const number = side === "old" ? cell.line.oldNo : cell.line.newNo;
    if (number === null) continue;
    if (lowest === null || number < lowest) lowest = number;
    if (highest === null || number > highest) highest = number;
  }

  if (lowest === null || highest === null) return null;
  return { side, from: lowest, to: highest };
}

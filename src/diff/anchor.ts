import type { FileDiff, Line, Side } from "@/ipc/types";

export interface Anchor {
  side: Side;
  from: number;
  to: number;
}

/** The lines of a file in the order the diff panel walks them, hunks apart. */
export function diffLines(file: FileDiff | null): Line[] {
  if (!file) return [];
  return file.hunks.flatMap((hunk) => hunk.lines);
}

/**
 * Which side a selection of rows anchors to, and with which numbers. A range
 * holding any line of the new side belongs to the new side with *its* numbers;
 * one that is nothing but deletions belongs to the old side. The row indexes
 * never travel: a comment is anchored to line numbers, which is what survives
 * reopening the review.
 */
export function anchorFor(lines: readonly Line[], from: number, to: number): Anchor | null {
  const first = Math.max(0, Math.min(from, to));
  const last = Math.min(lines.length - 1, Math.max(from, to));
  const range = lines.slice(first, last + 1);
  if (range.length === 0) return null;

  const side: Side = range.some((line) => line.newNo !== null) ? "new" : "old";
  const numbers = range
    .map((line) => (side === "new" ? line.newNo : line.oldNo))
    .filter((no): no is number => no !== null);
  if (numbers.length === 0) return null;

  // Folded, not spread: a selection of some 126k lines blows the call stack.
  const lowest = numbers.reduce((low, no) => (no < low ? no : low), numbers[0]);
  const highest = numbers.reduce((high, no) => (no > high ? no : high), numbers[0]);
  return { side, from: lowest, to: highest };
}

/** Row the diff panel has to put the cursor on to show an anchored line. */
export function rowOfLine(lines: readonly Line[], side: Side, line: number): number {
  const found = lines.findIndex((row) => (side === "new" ? row.newNo : row.oldNo) === line);
  return found === -1 ? 0 : found;
}

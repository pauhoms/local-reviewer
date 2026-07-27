import type { FileDiff, Line, LineKind } from "@/ipc/types";

const MARKERS: Record<LineKind, string> = {
  add: "+",
  del: "-",
  context: " ",
};

export type DiffRow =
  | { kind: "header"; header: string }
  | { kind: "line"; line: Line; index: number };

export interface DiffRows {
  rows: DiffRow[];
  /** Row where each diff line sits, so the scroll can reach a line by its index. */
  lineRows: number[];
}

/**
 * Kept per file: every key press asks how many rows the diff has, and laying
 * out a hundred thousand lines again on each of them is not worth the memory
 * it saves.
 */
const built = new WeakMap<FileDiff, DiffRows>();

export function buildDiffRows(file: FileDiff | null): DiffRows {
  if (!file) return { rows: [], lineRows: [] };
  const known = built.get(file);
  if (known) return known;
  const laid = layOut(file);
  built.set(file, laid);
  return laid;
}

function layOut(file: FileDiff): DiffRows {
  const rows: DiffRow[] = [];
  const lineRows: number[] = [];

  for (const hunk of file.hunks) {
    if (hunk.lines.length === 0) continue;
    rows.push({ kind: "header", header: hunk.header });
    for (const line of hunk.lines) {
      lineRows.push(rows.length);
      rows.push({ kind: "line", line, index: lineRows.length - 1 });
    }
  }
  return { rows, lineRows };
}

export function countDiffLines(file: FileDiff | null): number {
  if (!file) return 0;
  return file.hunks.reduce((total, hunk) => total + hunk.lines.length, 0);
}

export function lineBody(content: string): string {
  return content.endsWith("\r") ? content.slice(0, -1) : content;
}

export function lineMarker(kind: LineKind): string {
  return MARKERS[kind];
}

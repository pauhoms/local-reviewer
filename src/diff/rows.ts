import type { FileDiff, Line } from "@/ipc/types";

export type DiffRow =
  | { kind: "header"; header: string }
  | { kind: "line"; line: Line; index: number };

export interface DiffRows {
  rows: DiffRow[];
  /** Row where each diff line sits, so the scroll can reach a line by its index. */
  lineRows: number[];
}

export function buildDiffRows(file: FileDiff | null): DiffRows {
  const rows: DiffRow[] = [];
  const lineRows: number[] = [];
  if (!file) return { rows, lineRows };

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

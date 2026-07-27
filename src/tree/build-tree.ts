import type { FileDiff } from "@/ipc/types";
import type { FoldRow } from "@/keys/keymap";

export type TreeNode =
  | { kind: "dir"; name: string; path: string; children: TreeNode[] }
  | { kind: "file"; name: string; path: string; file: FileDiff };

export interface FlatRow {
  node: TreeNode;
  depth: number;
  expanded: boolean;
}

const SEPARATOR = "/";

interface DirDraft {
  dirs: Map<string, DirDraft>;
  files: Array<{ name: string; file: FileDiff }>;
}

function emptyDraft(): DirDraft {
  return { dirs: new Map(), files: [] };
}

function segmentsOf(path: string): string[] {
  const parts = path.split(SEPARATOR).filter((part) => part.length > 0);
  // A path made only of separators still names a file: it gets one root row.
  return parts.length > 0 ? parts : [path];
}

function insert(root: DirDraft, file: FileDiff): void {
  const parts = segmentsOf(file.path);
  let dir = root;
  for (const part of parts.slice(0, -1)) {
    let child = dir.dirs.get(part);
    if (!child) {
      child = emptyDraft();
      dir.dirs.set(part, child);
    }
    dir = child;
  }
  dir.files.push({ name: parts[parts.length - 1], file });
}

function byName(left: { name: string }, right: { name: string }): number {
  return left.name.localeCompare(right.name);
}

function dirNode(name: string, prefix: string, draft: DirDraft): TreeNode {
  let label = name;
  let current = draft;
  // A folder holding nothing but another folder is one row: `src/order`, not two.
  while (current.files.length === 0 && current.dirs.size === 1) {
    const [[onlyName, onlyDraft]] = [...current.dirs];
    label += SEPARATOR + onlyName;
    current = onlyDraft;
  }
  const path = prefix + label;
  return { kind: "dir", name: label, path, children: nodesOf(current, path + SEPARATOR) };
}

function nodesOf(draft: DirDraft, prefix: string): TreeNode[] {
  const dirs = [...draft.dirs]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, child]) => dirNode(name, prefix, child));
  const files: TreeNode[] = draft.files
    .map(({ name, file }): TreeNode => ({ kind: "file", name, path: file.path, file }))
    .sort(byName);
  return [...dirs, ...files];
}

export interface DiffTotals {
  files: number;
  additions: number;
  deletions: number;
}

export function diffTotals(files: readonly FileDiff[]): DiffTotals {
  return files.reduce(
    (totals, file) => ({
      files: totals.files + 1,
      additions: totals.additions + file.additions,
      deletions: totals.deletions + file.deletions,
    }),
    { files: 0, additions: 0, deletions: 0 },
  );
}

export function buildTree(files: FileDiff[]): TreeNode[] {
  const root = emptyDraft();
  for (const file of files) insert(root, file);
  return nodesOf(root, "");
}

function collect(
  nodes: readonly TreeNode[],
  depth: number,
  collapsed: ReadonlySet<string>,
  rows: FlatRow[],
): void {
  for (const node of nodes) {
    if (node.kind === "file") {
      rows.push({ node, depth, expanded: false });
      continue;
    }
    const expanded = !collapsed.has(node.path);
    rows.push({ node, depth, expanded });
    if (expanded) collect(node.children, depth + 1, collapsed, rows);
  }
}

export function flatten(nodes: readonly TreeNode[], collapsed: ReadonlySet<string>): FlatRow[] {
  const rows: FlatRow[] = [];
  collect(nodes, 0, collapsed, rows);
  return rows;
}

export function foldRows(rows: readonly FlatRow[]): FoldRow[] {
  const holders: number[] = [];
  return rows.map((row, index) => {
    const parent = row.depth === 0 ? null : holders[row.depth - 1] ?? null;
    holders[row.depth] = index;
    holders.length = row.depth + 1;
    return { foldable: row.node.kind === "dir", expanded: row.expanded, parent };
  });
}

export type LineKind = "add" | "del" | "context";

export interface Line {
  kind: LineKind;
  oldNo: number | null;
  newNo: number | null;
  /** Line body without the leading `+` / `-` / space marker. */
  content: string;
}

export interface Hunk {
  header: string;
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: Line[];
}

export type FileStatus = "M" | "A" | "D" | "R";

export interface FileDiff {
  path: string;
  oldPath: string | null;
  status: FileStatus;
  additions: number;
  deletions: number;
  hunks: Hunk[];
}

export interface CommitInfo {
  hash: string;
  shortHash: string;
  subject: string;
  author: string;
  date: string;
}

export type Scope =
  | { kind: "worktree"; repo: string }
  | { kind: "commit"; repo: string; sha: string }
  | { kind: "range"; repo: string; from: string; to: string };

export type Side = "old" | "new";

export type DiffView = "unified" | "split";

/** Anchored to (file, side, first line, last line); the numbers are the ones of `side`. */
export interface Comment {
  id: string;
  path: string;
  side: Side;
  from: number;
  to: number;
  text: string;
}

export interface Review {
  scope: Scope;
  comments: Comment[];
  view: DiffView;
}

export interface StartupInfo {
  /** The scope the command line resolved, or `null` when the user must pick one. */
  scope: Scope | null;
  home: string;
}

export interface DirEntryInfo {
  name: string;
  path: string;
  isGitRepo: boolean;
}

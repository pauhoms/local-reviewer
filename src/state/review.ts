import { useSyncExternalStore } from "react";
import type { Comment, DiffView, FileDiff, Review, Scope } from "@/ipc/types";
import { buildTree, flatten } from "@/tree/build-tree";

export type ReviewComment = Comment;

export interface ReviewState {
  /** What the review is about; every panel reads it from here, not from a prop chain. */
  scope: Scope | null;
  files: FileDiff[];
  selectedPath: string | null;
  /** Diff line under the cursor. Here and not in the panel: opening another
   *  file puts it back on the first line, and the key that follows in the same
   *  burst has to read it already moved. */
  diffCursor: number;
  comments: ReviewComment[];
  /** Comment the editor is on, `null` when nobody is writing. */
  editing: string | null;
  /** Folded folder paths. Here and not in the panel: folding answers keys that
   *  may arrive faster than React re-renders, so it has to be readable at once. */
  collapsed: ReadonlySet<string>;
  /** Same reason as `collapsed`, for the entries of panel 3. */
  foldedComments: ReadonlySet<string>;
  view: DiffView;
}

export interface ReviewStore {
  getState: () => ReviewState;
  subscribe: (listener: () => void) => () => void;
  open: (scope: Scope, files: FileDiff[]) => void;
  selectFile: (path: string) => void;
  setDiffCursor: (line: number) => void;
  /** Opening a file and landing on one of its lines is a single move: two would
   *  let the key after it read the cursor of the file that just closed. */
  openAt: (path: string, line: number) => void;
  toggleFold: (path: string, open: boolean) => void;
  toggleCommentFold: (id: string, open: boolean) => void;
  addComment: (comment: ReviewComment) => void;
  startComment: (comment: ReviewComment) => void;
  setCommentText: (id: string, text: string) => void;
  saveEditing: () => void;
  cancelEditing: () => void;
  removeComment: (id: string) => void;
  restoreComments: (comments: readonly ReviewComment[]) => void;
}

export function commentCountsByPath(comments: readonly ReviewComment[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const comment of comments) {
    counts.set(comment.path, (counts.get(comment.path) ?? 0) + 1);
  }
  return counts;
}

/** The file the diff panel is showing, or `null` when the path is not in the changes. */
export function selectedFile(files: readonly FileDiff[], path: string | null): FileDiff | null {
  if (path === null) return null;
  return files.find((file) => file.path === path) ?? null;
}

/** The half of the state that belongs on disk: no cursors, no folds. */
export function persistableReview(state: ReviewState): Review | null {
  if (state.scope === null) return null;
  // The draft is in `comments` from the moment `c` is pressed, so without this
  // the autosave writes a bodiless comment before the first letter is typed —
  // and a crash with the editor open would resurrect it on the next resume.
  const comments = state.comments.filter(
    (comment) => comment.id !== state.editing || comment.text.trim() !== "",
  );
  return { scope: state.scope, comments, view: state.view };
}

const NO_FOLDS: ReadonlySet<string> = new Set();

function emptyState(): ReviewState {
  return {
    scope: null,
    files: [],
    selectedPath: null,
    diffCursor: 0,
    comments: [],
    editing: null,
    collapsed: NO_FOLDS,
    foldedComments: NO_FOLDS,
    view: "unified",
  };
}

/**
 * The tree sorts its rows, so `files[0]` is rarely the row the cursor starts on
 * — and the first row is usually a folder, which has no diff to show at all.
 */
function firstFileOfTree(files: FileDiff[]): string | null {
  for (const row of flatten(buildTree(files), NO_FOLDS)) {
    if (row.node.kind === "file") return row.node.path;
  }
  return null;
}

function withFold(folds: ReadonlySet<string>, key: string, open: boolean): ReadonlySet<string> {
  const next = new Set(folds);
  if (open) next.delete(key);
  else next.add(key);
  return next;
}

export function createReviewStore(): ReviewStore {
  let state = emptyState();
  const listeners = new Set<() => void>();

  function emit(): void {
    for (const listener of listeners) listener();
  }

  function set(next: ReviewState): void {
    state = next;
    emit();
  }

  function drop(id: string): ReviewState {
    return {
      ...state,
      comments: state.comments.filter((comment) => comment.id !== id),
      editing: state.editing === id ? null : state.editing,
    };
  }

  return {
    getState: () => state,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    open: (scope, files) => {
      // Comments belong to the review that is closing, not to the one opening.
      set({ ...emptyState(), scope, files, selectedPath: firstFileOfTree(files) });
    },
    selectFile: (path) => {
      // The line of the file that closes means nothing in the one that opens.
      set({ ...state, selectedPath: path, diffCursor: 0 });
    },
    setDiffCursor: (line) => set({ ...state, diffCursor: line }),
    openAt: (path, line) => set({ ...state, selectedPath: path, diffCursor: line }),
    toggleFold: (path, open) => set({ ...state, collapsed: withFold(state.collapsed, path, open) }),
    toggleCommentFold: (id, open) =>
      set({ ...state, foldedComments: withFold(state.foldedComments, id, open) }),
    addComment: (comment) => set({ ...state, comments: [...state.comments, comment] }),
    startComment: (comment) =>
      set({ ...state, comments: [...state.comments, comment], editing: comment.id }),
    setCommentText: (id, text) => {
      if (!state.comments.some((comment) => comment.id === id)) return;
      set({
        ...state,
        comments: state.comments.map((comment) =>
          comment.id === id ? { ...comment, text } : comment,
        ),
      });
    },
    saveEditing: () => {
      const id = state.editing;
      if (id === null) return;
      // Saving a comment with nothing written in it would put an empty heading
      // in the exported Markdown; it is the same as never having made it.
      const draft = state.comments.find((comment) => comment.id === id);
      set(draft && draft.text.trim() === "" ? drop(id) : { ...state, editing: null });
    },
    cancelEditing: () => {
      if (state.editing === null) return;
      set(drop(state.editing));
    },
    removeComment: (id) => {
      if (!state.comments.some((comment) => comment.id === id)) return;
      set(drop(id));
    },
    restoreComments: (comments) => set({ ...state, comments: [...comments], editing: null }),
  };
}

export const reviewStore = createReviewStore();

export function useReviewState(): ReviewState {
  return useSyncExternalStore(reviewStore.subscribe, reviewStore.getState);
}

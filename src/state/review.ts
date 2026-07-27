import { useSyncExternalStore } from "react";
import type { FileDiff, Scope, Side } from "@/ipc/types";
import { buildTree, flatten } from "@/tree/build-tree";

export interface ReviewComment {
  id: string;
  path: string;
  side: Side;
  from: number;
  to: number;
  text: string;
}

export interface ReviewState {
  /** What the review is about; every panel reads it from here, not from a prop chain. */
  scope: Scope | null;
  files: FileDiff[];
  selectedPath: string | null;
  comments: ReviewComment[];
  /** Folded folder paths. Here and not in the panel: folding answers keys that
   *  may arrive faster than React re-renders, so it has to be readable at once. */
  collapsed: ReadonlySet<string>;
}

export interface ReviewStore {
  getState: () => ReviewState;
  subscribe: (listener: () => void) => () => void;
  open: (scope: Scope, files: FileDiff[]) => void;
  selectFile: (path: string) => void;
  toggleFold: (path: string, open: boolean) => void;
  addComment: (comment: ReviewComment) => void;
  removeComment: (id: string) => void;
}

export function commentCountsByPath(comments: readonly ReviewComment[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const comment of comments) {
    counts.set(comment.path, (counts.get(comment.path) ?? 0) + 1);
  }
  return counts;
}

const NO_FOLDS: ReadonlySet<string> = new Set();

function emptyState(): ReviewState {
  return { scope: null, files: [], selectedPath: null, comments: [], collapsed: NO_FOLDS };
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

export function createReviewStore(): ReviewStore {
  let state = emptyState();
  const listeners = new Set<() => void>();

  function emit(): void {
    for (const listener of listeners) listener();
  }

  return {
    getState: () => state,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    open: (scope, files) => {
      // Comments belong to the review that is closing, not to the one opening.
      state = {
        scope,
        files,
        selectedPath: firstFileOfTree(files),
        comments: [],
        collapsed: NO_FOLDS,
      };
      emit();
    },
    selectFile: (path) => {
      state = { ...state, selectedPath: path };
      emit();
    },
    toggleFold: (path, open) => {
      const collapsed = new Set(state.collapsed);
      if (open) collapsed.delete(path);
      else collapsed.add(path);
      state = { ...state, collapsed };
      emit();
    },
    addComment: (comment) => {
      state = { ...state, comments: [...state.comments, comment] };
      emit();
    },
    removeComment: (id) => {
      const comments = state.comments.filter((comment) => comment.id !== id);
      if (comments.length === state.comments.length) return;
      state = { ...state, comments };
      emit();
    },
  };
}

export const reviewStore = createReviewStore();

export function useReviewState(): ReviewState {
  return useSyncExternalStore(reviewStore.subscribe, reviewStore.getState);
}

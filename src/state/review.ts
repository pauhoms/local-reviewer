import { useSyncExternalStore } from "react";
import type { FileDiff, Scope } from "@/ipc/types";

export interface ReviewState {
  /** What the review is about; every panel reads it from here, not from a prop chain. */
  scope: Scope | null;
  files: FileDiff[];
  selectedPath: string | null;
  /** Filled in by phase 6; kept as `unknown` here since the shape isn't decided yet. */
  comments: unknown[];
}

export interface ReviewStore {
  getState: () => ReviewState;
  subscribe: (listener: () => void) => () => void;
  open: (scope: Scope, files: FileDiff[]) => void;
  selectFile: (path: string) => void;
}

function emptyState(): ReviewState {
  return { scope: null, files: [], selectedPath: null, comments: [] };
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
      state = { ...state, scope, files, selectedPath: files[0]?.path ?? null };
      emit();
    },
    selectFile: (path) => {
      state = { ...state, selectedPath: path };
      emit();
    },
  };
}

export const reviewStore = createReviewStore();

export function useReviewState(): ReviewState {
  return useSyncExternalStore(reviewStore.subscribe, reviewStore.getState);
}

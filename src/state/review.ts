import { useSyncExternalStore } from "react";
import type { FileDiff } from "@/ipc/types";

/** Filled in by phase 6; kept as `unknown` here since the shape isn't decided yet. */
export interface ReviewState {
  files: FileDiff[];
  selectedPath: string | null;
  comments: unknown[];
}

export interface ReviewStore {
  getState: () => ReviewState;
  subscribe: (listener: () => void) => () => void;
  setFiles: (files: FileDiff[]) => void;
  selectFile: (path: string) => void;
}

function emptyState(): ReviewState {
  return { files: [], selectedPath: null, comments: [] };
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
    setFiles: (files) => {
      state = { ...state, files, selectedPath: files[0]?.path ?? null };
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

import { saveReview } from "@/ipc/client";
import type { Review } from "@/ipc/types";
import { persistableReview } from "./review";
import type { ReviewStore } from "./review";

/**
 * Long enough that typing a comment is one write and not one per key, short
 * enough that closing the app right after a keystroke loses nothing.
 */
export const AUTOSAVE_DELAY_MS = 120;

export interface Autosave {
  stop: () => void;
}

export interface AutosaveOptions {
  save?: (review: Review) => Promise<void>;
  delayMs?: number;
}

/**
 * There is no save button: every change to the review reaches the state file by
 * itself. What is already in the store when this starts counts as what the disk
 * holds, so resuming a review does not rewrite it untouched.
 */
export function startAutosave(store: ReviewStore, options: AutosaveOptions = {}): Autosave {
  const { save = saveReview, delayMs = AUTOSAVE_DELAY_MS } = options;

  const snapshotNow = (): { review: Review | null; snapshot: string } => {
    const review = persistableReview(store.getState());
    return { review, snapshot: JSON.stringify(review) };
  };

  let onDisk = snapshotNow().snapshot;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let writing = false;
  let changedWhileWriting = false;
  let stopped = false;

  function schedule(): void {
    if (stopped || timer !== null) return;
    timer = setTimeout(write, delayMs);
  }

  function write(): void {
    timer = null;
    if (stopped) return;
    // Two writes of the same file racing would leave whichever finished last,
    // which is not the same as the latest state: they are serialised instead.
    if (writing) {
      changedWhileWriting = true;
      return;
    }

    const { review, snapshot } = snapshotNow();
    if (review === null || snapshot === onDisk) return;

    writing = true;
    changedWhileWriting = false;
    void Promise.resolve(save(review))
      .then(() => {
        onDisk = snapshot;
      })
      // A write that failed is not the end of the review: the next change tries
      // again, and until then the previous JSON is still on disk.
      .catch(() => undefined)
      .finally(() => {
        writing = false;
        if (changedWhileWriting) schedule();
      });
  }

  const unsubscribe = store.subscribe(() => {
    if (writing) changedWhileWriting = true;
    schedule();
  });

  return {
    stop: () => {
      stopped = true;
      if (timer !== null) clearTimeout(timer);
      timer = null;
      unsubscribe();
    },
  };
}

import type { Selection } from "./types";

/** Anchor and head keep the direction of the gesture; whoever consumes a range wants it ordered. */
export function selectionRange(selection: Selection): { from: number; to: number } {
  return {
    from: Math.min(selection.anchor, selection.head),
    to: Math.max(selection.anchor, selection.head),
  };
}

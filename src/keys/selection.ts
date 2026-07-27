import type { Selection } from "./types";

/** What a list paints as chosen: the whole range, or the cursor when there is none. */
export function isSelected(index: number, cursor: number, range: Selection | null): boolean {
  if (!range) return index === cursor;
  const { from, to } = selectionRange(range);
  return index >= from && index <= to;
}

/** Anchor and head keep the direction of the gesture; whoever consumes a range wants it ordered. */
export function selectionRange(selection: Selection): { from: number; to: number } {
  return {
    from: Math.min(selection.anchor, selection.head),
    to: Math.max(selection.anchor, selection.head),
  };
}

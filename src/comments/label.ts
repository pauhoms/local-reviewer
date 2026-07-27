/** Where a summary stops being a glance and starts being the comment again. */
export const SUMMARY_LIMIT = 72;

/**
 * The wording of an anchor, shared by the panel and the exported Markdown so a
 * comment reads the same on screen and in the file handed to Codex.
 */
export function lineRangeLabel(from: number, to: number): string {
  const first = Math.min(from, to);
  const last = Math.max(from, to);
  return first === last ? `Line ${first}` : `Lines ${first}-${last}`;
}

/** One line of the comment for the list: the rest is in the editor. */
export function summarize(text: string, limit: number = SUMMARY_LIMIT): string {
  const oneLine = text.replace(/\s+/gu, " ").trim();
  const characters = [...oneLine];
  if (characters.length <= limit) return oneLine;
  return `${characters.slice(0, limit).join("").trimEnd()}…`;
}

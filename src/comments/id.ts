let made = 0;

/**
 * Unique inside one run and stable once written. It never leaves the machine
 * that made it, so a counter next to the clock is identity enough — and two
 * comments made in the same millisecond still get different ids.
 */
export function nextCommentId(): string {
  made += 1;
  return `c${Date.now().toString(36)}-${made.toString(36)}`;
}

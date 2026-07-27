/**
 * Cursor rows carry selection state without receiving DOM focus, so the browser
 * does not reveal them automatically when keyboard navigation moves the cursor.
 */
export function revealCursor(container: HTMLElement): boolean {
  const selected = container.querySelector<HTMLElement>('[data-cursor="true"]');
  if (!selected) return false;

  const viewport = container.getBoundingClientRect();
  const row = selected.getBoundingClientRect();
  let delta = 0;
  if (row.top < viewport.top) {
    delta = row.top - viewport.top;
  } else if (row.bottom > viewport.bottom) {
    delta = row.bottom - viewport.bottom;
  }
  if (delta === 0) return false;

  const before = container.scrollTop;
  container.scrollTop += delta;
  return container.scrollTop !== before;
}

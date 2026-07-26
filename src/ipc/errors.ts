/** Tauri rejects with the plain string the command returned; jsdom and the
 *  network layer reject with an `Error`. Both end up in front of the user. */
export function errorMessage(error: unknown): string {
  const raw = typeof error === "string" ? error : error instanceof Error ? error.message : "";
  return raw.trim() === "" ? "error inesperado" : raw;
}

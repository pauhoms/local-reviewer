/**
 * A value the screen asked the backend for. The failure travels with the data
 * it belongs to: a shared notice is wiped by the next operation that succeeds,
 * and the panel would then show "empty" over something it never managed to read.
 */
export type Loadable<T> =
  | { status: "loading" }
  | { status: "ready"; data: T }
  | { status: "failed"; message: string };

export function loadedItems<T>(value: Loadable<T[]>): T[] {
  return value.status === "ready" ? value.data : [];
}

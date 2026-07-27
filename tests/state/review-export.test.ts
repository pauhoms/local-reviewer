import { describe, expect, it } from "vitest";
import type { FileDiff, Scope } from "@/ipc/types";
import { createReviewStore, persistableReview } from "@/state/review";

const SCOPE: Scope = { kind: "worktree", repo: "/home/dev/reviewv4" };
const PATH = "/home/dev/.codex/reviews/review-2026-07-26.md";

const FILE: FileDiff = {
  path: "src/a.ts",
  oldPath: null,
  status: "M",
  additions: 0,
  deletions: 0,
  hunks: [],
};

function opened(): ReturnType<typeof createReviewStore> {
  const store = createReviewStore();
  store.open(SCOPE, [FILE]);
  return store;
}

describe("what the toolbar knows about the export", () => {
  it("before the first export there is no path and nothing to say", () => {
    const store = opened();

    expect(store.getState().exportPath).toBeNull();
    expect(store.getState().toolbarError).toBeNull();
  });

  it("a finished export leaves its path behind", () => {
    const store = opened();

    store.exported(PATH);

    expect(store.getState().exportPath).toBe(PATH);
  });

  it("a second export replaces the path of the first", () => {
    const store = opened();

    store.exported(PATH);
    store.exported(`${PATH}-2`);

    expect(store.getState().exportPath).toBe(`${PATH}-2`);
  });

  it("an export that fails with nothing exported yet says only what went wrong", () => {
    const store = opened();

    store.exportFailed("No se pudo exportar la revisión: disco lleno");

    expect(store.getState().exportPath).toBeNull();
    expect(store.getState().toolbarError).toBe("No se pudo exportar la revisión: disco lleno");
  });

  it("an export that fails after one that worked keeps its path and names it", () => {
    const store = opened();
    store.exported(PATH);

    store.exportFailed("No se pudo exportar la revisión: disco lleno");

    expect(store.getState().exportPath).toBe(PATH);
    expect(store.getState().toolbarError).toContain("disco lleno");
    expect(store.getState().toolbarError).toContain(PATH);
  });

  it("an export that works clears what the last failure said", () => {
    const store = opened();
    store.exportFailed("No se pudo exportar la revisión: disco lleno");

    store.exported(PATH);

    expect(store.getState().toolbarError).toBeNull();
  });

  it("a copy that fails says so and keeps the path that is still on disk", () => {
    const store = opened();
    store.exported(PATH);

    store.copyFailed("No se pudo copiar la ruta");

    expect(store.getState().exportPath).toBe(PATH);
    expect(store.getState().toolbarError).toBe("No se pudo copiar la ruta");
  });

  it("a copy that works says so and takes the last failure off the toolbar", () => {
    const store = opened();
    store.exported(PATH);
    store.copyFailed("No se pudo copiar la ruta: sin portapapeles");

    store.copied();

    expect(store.getState().copied).toBe(true);
    expect(store.getState().toolbarError).toBeNull();
  });

  it("what is in the clipboard is no longer the path once another export lands", () => {
    const store = opened();
    store.exported(PATH);
    store.copied();

    store.exported(`${PATH}-2`);

    expect(store.getState().copied).toBe(false);
  });

  it("a copy that fails takes the sign of the one that worked away", () => {
    const store = opened();
    store.exported(PATH);
    store.copied();

    store.copyFailed("No se pudo copiar la ruta: sin portapapeles");

    expect(store.getState().copied).toBe(false);
  });

  it("opening another review starts with nothing exported", () => {
    const store = opened();
    store.exported(PATH);
    store.copied();

    store.open({ kind: "commit", repo: "/home/dev/otro", sha: "abc" }, []);

    expect(store.getState().exportPath).toBeNull();
    expect(store.getState().toolbarError).toBeNull();
    expect(store.getState().copied).toBe(false);
  });

  it("none of it belongs in the state file", () => {
    const store = opened();
    store.exported(PATH);

    expect(JSON.stringify(persistableReview(store.getState()))).not.toContain("review-2026");
  });

  it("tells whoever is subscribed that the export finished", () => {
    const store = opened();
    let beats = 0;
    store.subscribe(() => {
      beats += 1;
    });

    store.exported(PATH);

    expect(beats).toBe(1);
  });
});

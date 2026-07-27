import { describe, expect, it, vi } from "vitest";
import type { Scope } from "@/ipc/types";
import { createReviewStore, persistableReview } from "@/state/review";
import { sampleFiles } from "../helpers/fixtures";

const SCOPE: Scope = { kind: "worktree", repo: "/home/dev/local-reviewer" };

function opened(): ReturnType<typeof createReviewStore> {
  const store = createReviewStore();
  store.open(SCOPE, sampleFiles);
  return store;
}

describe("the view and the active side live in the store", () => {
  it("opens unified on the new side", () => {
    const state = opened().getState();

    expect(state.view).toBe("unified");
    expect(state.side).toBe("new");
  });

  it("opens on the view the review was saved in", () => {
    const store = createReviewStore();
    store.open(SCOPE, sampleFiles, "split");

    expect(store.getState().view).toBe("split");
    expect(store.getState().side).toBe("new");
  });

  it("changes view, cursor and side in a single move", () => {
    const store = opened();
    const listener = vi.fn();
    store.subscribe(listener);

    store.setView("split", 7, "old");

    const state = store.getState();
    expect([state.view, state.diffCursor, state.side]).toEqual(["split", 7, "old"]);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("changes the side without moving the cursor", () => {
    const store = opened();
    store.setView("split", 7, "new");

    store.setSide("old");

    expect(store.getState().side).toBe("old");
    expect(store.getState().diffCursor).toBe(7);
  });

  it("keeps the view when another file opens, and starts it at the top", () => {
    const store = opened();
    store.setView("split", 7, "old");

    store.selectFile(sampleFiles[2].path);

    expect(store.getState().view).toBe("split");
    expect(store.getState().diffCursor).toBe(0);
  });

  it("jumps to a comment with the side it is anchored to, in one move", () => {
    const store = opened();
    store.setView("split", 0, "new");

    store.openAt(sampleFiles[2].path, 4, "old");

    const state = store.getState();
    expect([state.selectedPath, state.diffCursor, state.side]).toEqual([
      sampleFiles[2].path,
      4,
      "old",
    ]);
  });

  it("puts the view of the moment in what gets persisted", () => {
    const store = opened();
    store.setView("split", 3, "old");

    expect(persistableReview(store.getState())?.view).toBe("split");
  });
});

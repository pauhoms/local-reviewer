import { describe, expect, it, vi } from "vitest";
import type { Scope } from "@/ipc/types";
import { createReviewStore } from "@/state/review";
import { sampleFiles } from "../helpers/fixtures";

const SCOPE: Scope = { kind: "worktree", repo: "/home/dev/reviewv4" };

describe("the line the diff cursor is on lives in the store", () => {
  it("starts on the first line of the file that opens", () => {
    const store = createReviewStore();
    store.open(SCOPE, sampleFiles);

    expect(store.getState().diffCursor).toBe(0);
  });

  it("setDiffCursor moves it and tells the subscribers", () => {
    const store = createReviewStore();
    store.open(SCOPE, sampleFiles);
    const listener = vi.fn();
    store.subscribe(listener);

    store.setDiffCursor(12);

    expect(store.getState().diffCursor).toBe(12);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("opening another file puts the cursor back on its first line, at once", () => {
    const store = createReviewStore();
    store.open(SCOPE, sampleFiles);
    store.setDiffCursor(12);

    store.selectFile(sampleFiles[2].path);

    expect(store.getState().diffCursor).toBe(0);
  });

  it("opening another review puts the cursor back on the first line too", () => {
    const store = createReviewStore();
    store.open(SCOPE, sampleFiles);
    store.setDiffCursor(12);

    store.open(SCOPE, sampleFiles);

    expect(store.getState().diffCursor).toBe(0);
  });
});

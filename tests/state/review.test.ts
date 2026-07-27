import { describe, it, expect, vi } from "vitest";
import type { Scope } from "@/ipc/types";
import { createReviewStore } from "@/state/review";
import { sampleFiles } from "../helpers/fixtures";

const SCOPE: Scope = { kind: "worktree", repo: "/home/dev/reviewv4" };
const OTHER_SCOPE: Scope = { kind: "commit", repo: "/home/dev/reviewv4", sha: "a1b2c3d" };

describe("review store", () => {
  it("starts empty with no scope, no selected file and no comments", () => {
    const store = createReviewStore();
    const state = store.getState();

    expect(state.scope).toBeNull();
    expect(state.files).toEqual([]);
    expect(state.selectedPath).toBeNull();
    expect(state.comments).toEqual([]);
  });

  it("open takes in the scope with its files and selects the first file of the tree", () => {
    const store = createReviewStore();

    store.open(SCOPE, sampleFiles);

    expect(store.getState().scope).toEqual(SCOPE);
    expect(store.getState().files).toEqual(sampleFiles);
    // The tree sorts folders first, so the row the cursor starts on is not
    // necessarily sampleFiles[0]; both must name the same file.
    expect(store.getState().selectedPath).toBe("src/order/Order.ts");
  });

  it("opening another scope replaces the previous one instead of keeping both", () => {
    const store = createReviewStore();
    store.open(SCOPE, sampleFiles);

    store.open(OTHER_SCOPE, []);

    expect(store.getState().scope).toEqual(OTHER_SCOPE);
    expect(store.getState().files).toEqual([]);
    expect(store.getState().selectedPath).toBeNull();
  });

  it("selectFile changes the selected path without touching the files", () => {
    const store = createReviewStore();
    store.open(SCOPE, sampleFiles);

    store.selectFile(sampleFiles[2].path);

    expect(store.getState().selectedPath).toBe(sampleFiles[2].path);
    expect(store.getState().files).toEqual(sampleFiles);
  });

  it("notifies subscribers when the state changes", () => {
    const store = createReviewStore();
    const listener = vi.fn();
    store.subscribe(listener);

    store.open(SCOPE, sampleFiles);

    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("stops notifying a subscriber that unsubscribed", () => {
    const store = createReviewStore();
    const gone = vi.fn();
    const stays = vi.fn();
    const unsubscribe = store.subscribe(gone);
    store.subscribe(stays);

    unsubscribe();
    store.open(SCOPE, sampleFiles);
    store.selectFile(sampleFiles[1].path);

    expect(gone).not.toHaveBeenCalled();
    expect(stays).toHaveBeenCalledTimes(2);
  });
});

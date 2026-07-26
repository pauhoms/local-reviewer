import { describe, it, expect, vi } from "vitest";
import { createReviewStore } from "@/state/review";
import { sampleFiles } from "../helpers/fixtures";

describe("review store", () => {
  it("starts empty with no selected file and no comments", () => {
    const store = createReviewStore();
    const state = store.getState();

    expect(state.files).toEqual([]);
    expect(state.selectedPath).toBeNull();
    expect(state.comments).toEqual([]);
  });

  it("setFiles injects the files and selects the first one", () => {
    const store = createReviewStore();

    store.setFiles(sampleFiles);

    expect(store.getState().files).toEqual(sampleFiles);
    expect(store.getState().selectedPath).toBe(sampleFiles[0].path);
  });

  it("selectFile changes the selected path without touching the files", () => {
    const store = createReviewStore();
    store.setFiles(sampleFiles);

    store.selectFile(sampleFiles[2].path);

    expect(store.getState().selectedPath).toBe(sampleFiles[2].path);
    expect(store.getState().files).toEqual(sampleFiles);
  });

  it("notifies subscribers when the state changes", () => {
    const store = createReviewStore();
    const listener = vi.fn();
    store.subscribe(listener);

    store.setFiles(sampleFiles);

    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("stops notifying a subscriber that unsubscribed", () => {
    const store = createReviewStore();
    const gone = vi.fn();
    const stays = vi.fn();
    const unsubscribe = store.subscribe(gone);
    store.subscribe(stays);

    unsubscribe();
    store.setFiles(sampleFiles);
    store.selectFile(sampleFiles[1].path);

    expect(gone).not.toHaveBeenCalled();
    expect(stays).toHaveBeenCalledTimes(2);
  });
});

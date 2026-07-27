import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Review, Scope } from "@/ipc/types";
import { AUTOSAVE_DELAY_MS, startAutosave } from "@/state/persist";
import { createReviewStore, persistableReview } from "@/state/review";
import type { ReviewComment, ReviewStore } from "@/state/review";
import { sampleFiles } from "../helpers/fixtures";

const SCOPE: Scope = { kind: "worktree", repo: "/home/dev/reviewv4" };

function comment(id: string, text = `nota ${id}`): ReviewComment {
  return { id, path: "src/a.ts", side: "new", from: 1, to: 2, text };
}

/** A save the test decides when to settle, to look inside the in-flight window. */
function deferredSave(): {
  save: (review: Review) => Promise<void>;
  calls: Review[];
  settle: () => Promise<void>;
} {
  const waiting: Array<() => void> = [];
  const calls: Review[] = [];
  return {
    calls,
    save: (review) => {
      calls.push(review);
      return new Promise<void>((resolve) => waiting.push(resolve));
    },
    settle: async () => {
      const pending = waiting.splice(0, waiting.length);
      for (const resolve of pending) resolve();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    },
  };
}

function opened(): ReviewStore {
  const store = createReviewStore();
  store.open(SCOPE, sampleFiles);
  return store;
}

async function tick(): Promise<void> {
  await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS);
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("autosave", () => {
  it("writes the review once a comment is made, with no button to press", async () => {
    const store = opened();
    const save = vi.fn<(review: Review) => Promise<void>>(() => Promise.resolve());
    startAutosave(store, { save });

    store.addComment(comment("c1"));
    await tick();

    expect(save).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0][0]).toEqual({
      scope: SCOPE,
      comments: [comment("c1")],
      view: "unified",
    });
  });

  it("writes nothing at all while the review is only being read", async () => {
    const store = opened();
    const save = vi.fn(() => Promise.resolve());
    startAutosave(store, { save });

    store.setDiffCursor(4);
    store.selectFile(sampleFiles[1].path);
    store.toggleFold("src", false);
    await tick();

    expect(save).not.toHaveBeenCalled();
  });

  it("a burst of keystrokes lands as one write, not one per key", async () => {
    const store = opened();
    const save = vi.fn<(review: Review) => Promise<void>>(() => Promise.resolve());
    startAutosave(store, { save });

    store.startComment(comment("c1", ""));
    for (const text of ["h", "ho", "hol", "hola"]) store.setCommentText("c1", text);
    await tick();

    expect(save).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0][0].comments[0].text).toBe("hola");
  });

  it("a change made mid-write reaches the disk after it", async () => {
    const store = opened();
    const { save, calls, settle } = deferredSave();
    startAutosave(store, { save });

    store.addComment(comment("c1"));
    await tick();
    expect(calls).toHaveLength(1);

    store.addComment(comment("c2"));
    await tick();
    expect(calls).toHaveLength(1);

    await settle();
    await tick();

    expect(calls).toHaveLength(2);
    expect(calls[1].comments.map((item) => item.id)).toEqual(["c1", "c2"]);
  });

  it("two writes never overlap, so the last state is the one that stays", async () => {
    const store = opened();
    const { save, calls, settle } = deferredSave();
    startAutosave(store, { save });

    store.addComment(comment("c1"));
    await tick();
    store.addComment(comment("c2"));
    store.addComment(comment("c3"));
    await tick();

    expect(calls).toHaveLength(1);

    await settle();
    await tick();
    await settle();

    expect(calls).toHaveLength(2);
    expect(calls[1].comments.map((item) => item.id)).toEqual(["c1", "c2", "c3"]);
  });

  it("deleting the last comment is saved as an empty review, not left behind", async () => {
    const store = opened();
    const save = vi.fn<(review: Review) => Promise<void>>(() => Promise.resolve());
    startAutosave(store, { save });
    store.addComment(comment("c1"));
    await tick();

    store.removeComment("c1");
    await tick();

    expect(save).toHaveBeenCalledTimes(2);
    expect(save.mock.calls[1][0].comments).toEqual([]);
  });

  it("takes the review already in the store as what the disk holds", async () => {
    const store = opened();
    store.restoreComments([comment("c1")]);
    const save = vi.fn(() => Promise.resolve());

    startAutosave(store, { save });
    await tick();

    expect(save).not.toHaveBeenCalled();
  });

  it("a save that fails is tried again with the next change", async () => {
    const store = opened();
    const save = vi
      .fn<(review: Review) => Promise<void>>()
      .mockRejectedValueOnce(new Error("disco lleno"))
      .mockResolvedValue(undefined);
    startAutosave(store, { save });

    store.addComment(comment("c1"));
    await tick();
    expect(save).toHaveBeenCalledTimes(1);

    store.addComment(comment("c2"));
    await tick();

    expect(save).toHaveBeenCalledTimes(2);
    expect(save.mock.calls[1][0].comments.map((item) => item.id)).toEqual(["c1", "c2"]);
  });

  it("stops writing once it is stopped", async () => {
    const store = opened();
    const save = vi.fn(() => Promise.resolve());
    const autosave = startAutosave(store, { save });

    store.addComment(comment("c1"));
    autosave.stop();
    await tick();
    store.addComment(comment("c2"));
    await tick();

    expect(save).not.toHaveBeenCalled();
  });

  it("saves nothing while no review is open", async () => {
    const store = createReviewStore();
    const save = vi.fn(() => Promise.resolve());
    startAutosave(store, { save });

    store.addComment(comment("c1"));
    await tick();

    expect(save).not.toHaveBeenCalled();
  });
});

describe("the draft a comment starts as", () => {
  it("stays out of the file until it carries a body", () => {
    const store = createReviewStore();
    store.open(SCOPE, []);
    store.startComment({ id: "d1", path: "a.ts", side: "new", from: 1, to: 1, text: "" });

    expect(persistableReview(store.getState())?.comments).toEqual([]);

    store.setCommentText("d1", "ya dice algo");
    expect(persistableReview(store.getState())?.comments).toHaveLength(1);
  });

  it("keeps a saved comment that was later emptied out of the draft rule", () => {
    const store = createReviewStore();
    store.open(SCOPE, []);
    store.addComment({ id: "k1", path: "a.ts", side: "new", from: 1, to: 1, text: "" });

    expect(persistableReview(store.getState())?.comments).toHaveLength(1);
  });
});

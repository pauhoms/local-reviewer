import { describe, expect, it, vi } from "vitest";
import type { Scope } from "@/ipc/types";
import { commentCountsByPath, createReviewStore } from "@/state/review";
import type { ReviewComment } from "@/state/review";
import { sampleFiles } from "../helpers/fixtures";

const SCOPE: Scope = { kind: "worktree", repo: "/home/dev/local-reviewer" };

function comment(id: string, path: string): ReviewComment {
  return { id, path, side: "new", from: 1, to: 2, text: `nota ${id}` };
}

describe("review store comments", () => {
  it("addComment keeps the comments in the order they were made", () => {
    const store = createReviewStore();

    store.addComment(comment("c1", "a.ts"));
    store.addComment(comment("c2", "b.ts"));

    expect(store.getState().comments.map((item) => item.id)).toEqual(["c1", "c2"]);
  });

  it("removeComment drops only the comment with that id", () => {
    const store = createReviewStore();
    store.addComment(comment("c1", "a.ts"));
    store.addComment(comment("c2", "a.ts"));

    store.removeComment("c1");

    expect(store.getState().comments.map((item) => item.id)).toEqual(["c2"]);
  });

  it("notifies subscribers when a comment arrives and when it goes", () => {
    const store = createReviewStore();
    const listener = vi.fn();
    store.subscribe(listener);

    store.addComment(comment("c1", "a.ts"));
    store.removeComment("c1");

    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("leaves everything alone when the id to remove is not there", () => {
    const store = createReviewStore();
    store.addComment(comment("c1", "a.ts"));
    const before = store.getState();
    const listener = vi.fn();
    store.subscribe(listener);

    store.removeComment("nope");

    expect(store.getState()).toBe(before);
    expect(listener).not.toHaveBeenCalled();
  });

  it("opening another review starts with no comments", () => {
    const store = createReviewStore();
    store.open(SCOPE, sampleFiles);
    store.addComment(comment("c1", sampleFiles[0].path));

    store.open(SCOPE, sampleFiles);

    expect(store.getState().comments).toEqual([]);
  });
});

describe("commentCountsByPath", () => {
  it("counts the comments of every path and leaves the rest out", () => {
    const counts = commentCountsByPath([
      comment("c1", "src/a.ts"),
      comment("c2", "src/b.ts"),
      comment("c3", "src/a.ts"),
    ]);

    expect([...counts]).toEqual([
      ["src/a.ts", 2],
      ["src/b.ts", 1],
    ]);
    expect(counts.get("src/c.ts")).toBeUndefined();
  });

  it("counts nothing when there are no comments", () => {
    expect(commentCountsByPath([]).size).toBe(0);
  });
});

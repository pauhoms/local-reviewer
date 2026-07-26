import { describe, it, expect } from "vitest";
import type { CommitInfo } from "@/ipc/types";
import { orderedRange } from "@/screens/range";

function commit(hash: string): CommitInfo {
  return { hash, shortHash: hash.slice(0, 7), subject: hash, author: "A", date: "2026-01-01" };
}

/** `list_commits` answers newest first, so the oldest sits at the end. */
const COMMITS = [commit("newest"), commit("middle"), commit("oldest")];

describe("the range two marked commits stand for", () => {
  it("runs from the older commit to the newer one", () => {
    expect(orderedRange(COMMITS, "oldest", "newest")).toEqual({
      from: "oldest",
      to: "newest",
    });
  });

  it("runs the same way when they are marked the other way round", () => {
    expect(orderedRange(COMMITS, "newest", "oldest")).toEqual({
      from: "oldest",
      to: "newest",
    });
  });

  it("is nothing at all when a hash is not in the list", () => {
    expect(orderedRange(COMMITS, "newest", "gone")).toBeNull();
    expect(orderedRange(COMMITS, "gone", "newest")).toBeNull();
  });

  it("is nothing at all when both ends are the same commit", () => {
    expect(orderedRange(COMMITS, "middle", "middle")).toBeNull();
  });
});

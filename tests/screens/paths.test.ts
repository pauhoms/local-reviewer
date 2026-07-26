import { describe, it, expect } from "vitest";
import { basename, isUnder, parentPath } from "@/screens/paths";
import { scopeLabel, shortSha } from "@/screens/scope-label";

describe("basename", () => {
  it("keeps the last segment of a path", () => {
    expect(basename("/home/dev/prx/iprox-server")).toBe("iprox-server");
  });

  it("ignores a trailing slash", () => {
    expect(basename("/home/dev/prx/")).toBe("prx");
  });

  it("answers the path itself when there is no segment to take", () => {
    expect(basename("/")).toBe("/");
    expect(basename("")).toBe("");
  });
});

describe("parentPath", () => {
  it("drops the last segment", () => {
    expect(parentPath("/home/dev/prx")).toBe("/home/dev");
    expect(parentPath("/home/dev/prx/")).toBe("/home/dev");
  });

  it("stops at the root", () => {
    expect(parentPath("/home")).toBe("/");
    expect(parentPath("/")).toBeNull();
    expect(parentPath("")).toBeNull();
  });
});

describe("isUnder", () => {
  it("accepts the root itself and anything below it", () => {
    expect(isUnder("/home/dev", "/home/dev")).toBe(true);
    expect(isUnder("/home/dev/prx", "/home/dev")).toBe(true);
  });

  it("rejects what sits above or beside the root", () => {
    expect(isUnder("/home", "/home/dev")).toBe(false);
    expect(isUnder("/home/developer", "/home/dev")).toBe(false);
    expect(isUnder("/tmp", "/home/dev")).toBe(false);
  });

  it("survives a root written with a trailing slash", () => {
    expect(isUnder("/home/dev/prx", "/home/dev/")).toBe(true);
  });
});

describe("the label of a scope", () => {
  it("names the working tree", () => {
    expect(scopeLabel({ kind: "worktree", repo: "/r" })).toBe("worktree");
  });

  it("abbreviates a commit", () => {
    expect(scopeLabel({ kind: "commit", repo: "/r", sha: "a1b2c3d0000000" })).toBe("a1b2c3d");
  });

  it("abbreviates both ends of a range", () => {
    expect(
      scopeLabel({ kind: "range", repo: "/r", from: "789abc10000", to: "a1b2c3d0000" }),
    ).toBe("789abc1..a1b2c3d");
  });

  it("leaves a short reference as the user typed it", () => {
    expect(shortSha("HEAD")).toBe("HEAD");
    expect(shortSha("v1.0")).toBe("v1.0");
  });
});

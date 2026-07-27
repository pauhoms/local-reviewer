import { describe, expect, it } from "vitest";
import type { FileDiff } from "@/ipc/types";
import { buildTree, filePaths } from "@/tree/build-tree";

function file(path: string): FileDiff {
  return { path, oldPath: null, status: "M", additions: 0, deletions: 0, hunks: [] };
}

function pathsOf(...paths: string[]): string[] {
  return filePaths(buildTree(paths.map(file)));
}

describe("filePaths", () => {
  it("answers the files in the order the tree shows them, folders first", () => {
    expect(pathsOf("README.md", "src/UserService.php", "src/order/Order.ts")).toEqual([
      "src/order/Order.ts",
      "src/UserService.php",
      "README.md",
    ]);
  });

  it("leaves the folders out: only a file can hold a comment", () => {
    expect(pathsOf("src/a.ts")).toEqual(["src/a.ts"]);
  });

  it("of no changes at all is no paths", () => {
    expect(pathsOf()).toEqual([]);
  });
});

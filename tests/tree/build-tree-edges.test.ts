import { describe, expect, it } from "vitest";
import type { FileDiff } from "@/ipc/types";
import { buildTree, diffTotals, flatten, foldRows } from "@/tree/build-tree";

function fileDiff(path: string, patch: Partial<FileDiff> = {}): FileDiff {
  return {
    path,
    oldPath: null,
    status: "M",
    additions: 0,
    deletions: 0,
    hunks: [],
    ...patch,
  };
}

function paths(files: FileDiff[], collapsed: ReadonlySet<string> = new Set()): string[] {
  return flatten(buildTree(files), collapsed).map((row) => row.node.path);
}

describe("buildTree on odd input", () => {
  it("keeps both entries when the same path shows up twice", () => {
    const rows = paths([fileDiff("src/a.ts"), fileDiff("src/a.ts")]);

    expect(rows).toEqual(["src", "src/a.ts", "src/a.ts"]);
  });

  it("makes no nameless folder out of empty path segments", () => {
    const rows = paths([fileDiff("src//a.ts"), fileDiff("src/b.ts")]);

    expect(rows).toEqual(["src", "src//a.ts", "src/b.ts"]);
  });

  it("keeps a file whose path is only a separator as a row of its own", () => {
    const rows = paths([fileDiff("/")]);

    expect(rows).toEqual(["/"]);
  });

  it("leaves a file row alone when the collapsed set names it", () => {
    const tree = buildTree([fileDiff("a.ts")]);

    expect(flatten(tree, new Set(["a.ts"]))).toEqual([
      { node: tree[0], depth: 0, expanded: false },
    ]);
  });
});

describe("foldRows", () => {
  it("points every row at the index of the row that holds it", () => {
    const tree = buildTree([
      fileDiff("src/domain/user.php"),
      fileDiff("src/service.php"),
      fileDiff("readme.md"),
    ]);

    expect(foldRows(flatten(tree, new Set()))).toEqual([
      { foldable: true, expanded: true, parent: null },
      { foldable: true, expanded: true, parent: 0 },
      { foldable: false, expanded: false, parent: 1 },
      { foldable: false, expanded: false, parent: 0 },
      { foldable: false, expanded: false, parent: null },
    ]);
  });

  it("points the children of a collapsed chain at the single row that holds them", () => {
    const tree = buildTree([fileDiff("a/b/c/x.ts"), fileDiff("a/b/c/y.ts")]);

    expect(foldRows(flatten(tree, new Set())).map((row) => row.parent)).toEqual([null, 0, 0]);
  });

  it("reads the fold state of the rows it is given", () => {
    const tree = buildTree([fileDiff("src/a.ts"), fileDiff("readme.md")]);

    expect(foldRows(flatten(tree, new Set(["src"])))).toEqual([
      { foldable: true, expanded: false, parent: null },
      { foldable: false, expanded: false, parent: null },
    ]);
  });
});

describe("diffTotals", () => {
  it("counts the files and adds up what they changed", () => {
    const totals = diffTotals([
      fileDiff("a.ts", { additions: 3, deletions: 2 }),
      fileDiff("b/c.ts", { additions: 4, deletions: 1 }),
      fileDiff("b/d.ts", { additions: 0, deletions: 7 }),
    ]);

    expect(totals).toEqual({ files: 3, additions: 7, deletions: 10 });
  });

  it("counts files, not the folder rows they hang from", () => {
    const totals = diffTotals([fileDiff("a/b/c/d.ts", { additions: 1, deletions: 1 })]);

    expect(totals.files).toBe(1);
  });

  it("has nothing to add up for an empty diff", () => {
    expect(diffTotals([])).toEqual({ files: 0, additions: 0, deletions: 0 });
  });
});

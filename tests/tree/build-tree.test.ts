import { describe, expect, it } from "vitest";
import type { FileDiff } from "@/ipc/types";
import { buildTree, flatten } from "@/tree/build-tree";
import type { TreeNode } from "@/tree/build-tree";

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

/** One line per node, folders suffixed with `/` and children indented two spaces. */
function outline(nodes: TreeNode[], depth = 0): string[] {
  return nodes.flatMap((node) =>
    node.kind === "dir"
      ? [`${"  ".repeat(depth)}${node.name}/`, ...outline(node.children, depth + 1)]
      : [`${"  ".repeat(depth)}${node.name}`],
  );
}

function fileNodes(nodes: TreeNode[]): Array<Extract<TreeNode, { kind: "file" }>> {
  return nodes.flatMap((node) => (node.kind === "dir" ? fileNodes(node.children) : [node]));
}

const NESTED = [
  fileDiff("src/zeta.ts"),
  fileDiff("readme.md"),
  fileDiff("src/domain/user.php"),
  fileDiff("docs/guide.md"),
  fileDiff("src/app.ts"),
  fileDiff("src/domain/order.php"),
];

const NESTED_OUTLINE = [
  "docs/",
  "  guide.md",
  "src/",
  "  domain/",
  "    order.php",
  "    user.php",
  "  app.ts",
  "  zeta.ts",
  "readme.md",
];

describe("buildTree", () => {
  it("TS-19: nests the paths into folders, folders before files and alphabetically", () => {
    expect(outline(buildTree(NESTED))).toEqual(NESTED_OUTLINE);
  });

  it("TS-19: gives every node the full path it stands for", () => {
    const roots = buildTree(NESTED);
    const [docs, src, readme] = roots;

    expect(docs).toMatchObject({ kind: "dir", name: "docs", path: "docs" });
    expect(src).toMatchObject({ kind: "dir", name: "src", path: "src" });
    expect(readme).toMatchObject({ kind: "file", name: "readme.md", path: "readme.md" });

    if (src.kind !== "dir") throw new Error("src should be a directory");
    expect(src.children[0]).toMatchObject({
      kind: "dir",
      name: "domain",
      path: "src/domain",
    });
    expect(src.children[1]).toMatchObject({
      kind: "file",
      name: "app.ts",
      path: "src/app.ts",
    });
  });

  it("TS-19: hangs the original FileDiff off its file node", () => {
    const diff = fileDiff("src/app.ts", { status: "A", additions: 7, deletions: 2 });

    const [src] = buildTree([diff]);

    if (src.kind !== "dir") throw new Error("src should be a directory");
    const [app] = src.children;
    if (app.kind !== "file") throw new Error("app.ts should be a file");
    expect(app.file).toBe(diff);
  });

  it("TS-19: collapses a chain of single child folders into one row", () => {
    const tree = buildTree([fileDiff("a/b/c/deep.ts"), fileDiff("a/b/c/other.ts")]);

    expect(outline(tree)).toEqual(["a/b/c/", "  deep.ts", "  other.ts"]);
    expect(tree[0]).toMatchObject({ kind: "dir", name: "a/b/c", path: "a/b/c" });
  });

  it("TS-19: stops collapsing when the chain ends in a single file", () => {
    const tree = buildTree([fileDiff("src/order/Order.ts")]);

    expect(outline(tree)).toEqual(["src/order/", "  Order.ts"]);
  });

  it("TS-19: does not collapse a folder that holds more than one child", () => {
    const tree = buildTree([fileDiff("src/order/a.ts"), fileDiff("src/other/b.ts")]);

    expect(outline(tree)).toEqual(["src/", "  order/", "    a.ts", "  other/", "    b.ts"]);
  });

  it("TS-19: returns nothing for an empty diff", () => {
    expect(buildTree([])).toEqual([]);
    expect(flatten([], new Set())).toEqual([]);
  });

  it("TS-19: keeps a file at the repo root as a single row with no folder", () => {
    const tree = buildTree([fileDiff("README.md")]);

    expect(outline(tree)).toEqual(["README.md"]);
    expect(tree[0]).toMatchObject({ kind: "file", name: "README.md", path: "README.md" });
  });

  it("TS-19: collapses a very deep path into a single folder row", () => {
    const tree = buildTree([fileDiff("a/b/c/d/e/f/g.ts")]);

    expect(outline(tree)).toEqual(["a/b/c/d/e/f/", "  g.ts"]);
    expect(flatten(tree, new Set()).map((row) => row.node.path)).toEqual([
      "a/b/c/d/e/f",
      "a/b/c/d/e/f/g.ts",
    ]);
  });

  it("TS-19: keeps apart two files that share a name in different folders", () => {
    const tree = buildTree([fileDiff("lib/index.ts"), fileDiff("app/index.ts")]);

    expect(outline(tree)).toEqual(["app/", "  index.ts", "lib/", "  index.ts"]);
    expect(fileNodes(tree).map((node) => node.path)).toEqual(["app/index.ts", "lib/index.ts"]);
  });

  it("TS-19: places a renamed file under its new path only", () => {
    const renamed = fileDiff("src/domain/customer.php", {
      status: "R",
      oldPath: "src/legacy/client.php",
      additions: 4,
      deletions: 2,
    });

    const tree = buildTree([renamed, fileDiff("readme.md")]);

    expect(outline(tree)).toEqual(["src/domain/", "  customer.php", "readme.md"]);
    const [customer] = fileNodes(tree);
    expect(customer.path).toBe("src/domain/customer.php");
    expect(customer.file.status).toBe("R");
    expect(customer.file.oldPath).toBe("src/legacy/client.php");
  });

  it("TS-19: sorts accents next to their letter and ignores case, keeping odd names intact", () => {
    const tree = buildTree([
      fileDiff("Zeta.ts"),
      fileDiff("ábaco.ts"),
      fileDiff("beta.ts"),
      fileDiff("mi fichero.ts"),
      fileDiff("informes finales/año 2026/resumen (final).md"),
      fileDiff("Utils/helper.ts"),
    ]);

    expect(outline(tree)).toEqual([
      "informes finales/año 2026/",
      "  resumen (final).md",
      "Utils/",
      "  helper.ts",
      "ábaco.ts",
      "beta.ts",
      "mi fichero.ts",
      "Zeta.ts",
    ]);
  });

  it("TS-19: loses no file when a deleted file and a new folder share a path", () => {
    const files = [fileDiff("src/order", { status: "D" }), fileDiff("src/order/x.ts", { status: "A" })];

    const tree = buildTree(files);

    expect(fileNodes(tree).map((node) => node.path)).toEqual(["src/order/x.ts", "src/order"]);
    expect(outline(tree)).toEqual(["src/", "  order/", "    x.ts", "  order"]);
  });

  it("TS-19: builds a large tree keeping every file and the folder order", () => {
    const files = Array.from({ length: 200 }, (_, index) =>
      fileDiff(`pkg/mod${String(index).padStart(3, "0")}/file.ts`),
    );

    const tree = buildTree(files);
    const rows = flatten(tree, new Set());

    expect(fileNodes(tree)).toHaveLength(200);
    expect(rows).toHaveLength(1 + 200 * 2);
    expect(rows.slice(0, 4).map((row) => row.node.path)).toEqual([
      "pkg",
      "pkg/mod000",
      "pkg/mod000/file.ts",
      "pkg/mod001",
    ]);
    expect(flatten(tree, new Set(["pkg"])).map((row) => row.node.path)).toEqual(["pkg"]);
  });
});

describe("flatten", () => {
  it("TS-19: returns the visible rows in order with their depth", () => {
    const tree = buildTree(NESTED);

    const rows = flatten(tree, new Set());

    expect(rows.map((row) => [row.node.path, row.depth])).toEqual([
      ["docs", 0],
      ["docs/guide.md", 1],
      ["src", 0],
      ["src/domain", 1],
      ["src/domain/order.php", 2],
      ["src/domain/user.php", 2],
      ["src/app.ts", 1],
      ["src/zeta.ts", 1],
      ["readme.md", 0],
    ]);
    expect(rows[0].node).toBe(tree[0]);
  });

  it("TS-19: marks every folder as expanded while nothing is collapsed", () => {
    const rows = flatten(buildTree(NESTED), new Set());

    expect(
      rows.filter((row) => row.node.kind === "dir").map((row) => [row.node.path, row.expanded]),
    ).toEqual([
      ["docs", true],
      ["src", true],
      ["src/domain", true],
    ]);
  });

  it("TS-19: drops the whole subtree of a collapsed folder", () => {
    const rows = flatten(buildTree(NESTED), new Set(["src"]));

    expect(rows.map((row) => row.node.path)).toEqual(["docs", "docs/guide.md", "src", "readme.md"]);
    const src = rows.find((row) => row.node.path === "src");
    expect(src?.expanded).toBe(false);
  });

  it("TS-19: hides only the children of the collapsed folder, not its siblings", () => {
    const rows = flatten(buildTree(NESTED), new Set(["src/domain"]));

    expect(rows.map((row) => row.node.path)).toEqual([
      "docs",
      "docs/guide.md",
      "src",
      "src/domain",
      "src/app.ts",
      "src/zeta.ts",
      "readme.md",
    ]);
  });

  it("TS-19: keys collapsed folders by their full path, not by their name", () => {
    const tree = buildTree([
      fileDiff("a/shared/x.ts"),
      fileDiff("a/shared/y.ts"),
      fileDiff("a/keep.ts"),
      fileDiff("b/shared/z.ts"),
      fileDiff("b/keep.ts"),
    ]);

    const rows = flatten(tree, new Set(["a/shared"]));

    expect(rows.map((row) => row.node.path)).toEqual([
      "a",
      "a/shared",
      "a/keep.ts",
      "b",
      "b/shared",
      "b/shared/z.ts",
      "b/keep.ts",
    ]);
  });

  it("TS-19: ignores a collapsed path that is not in the tree", () => {
    const tree = buildTree(NESTED);

    expect(flatten(tree, new Set(["nope", "src/domain/user.php"]))).toEqual(
      flatten(tree, new Set()),
    );
  });
});

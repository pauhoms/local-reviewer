import { afterEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { UserEvent } from "@testing-library/user-event";
import type { FileDiff, Scope } from "@/ipc/types";
import { panel } from "../keys/helpers";

vi.mock("@/ipc/client", () => import("../helpers/ipc-mock"));

import App from "@/App";
import { configureIpc } from "../helpers/ipc-mock";
import { reviewStore } from "@/state/review";
import type { ReviewComment } from "@/state/review";

const SCOPE: Scope = { kind: "worktree", repo: "/home/dev/reviewv4" };

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

const FILES: FileDiff[] = [
  fileDiff("src/domain/user.php", { status: "M", additions: 12, deletions: 3 }),
  fileDiff("src/service.php", { status: "M", additions: 52, deletions: 4 }),
  fileDiff("src/order/order.ts", { status: "A", additions: 120, deletions: 0 }),
  fileDiff("src/order/legacy.ts", { status: "D", additions: 0, deletions: 78 }),
  fileDiff("tests/unit/panel.test.ts", { status: "M", additions: 9, deletions: 1 }),
  fileDiff("readme.md", { status: "M", additions: 2, deletions: 2 }),
];

const ALL_ROWS = [
  "src",
  "src/domain",
  "src/domain/user.php",
  "src/order",
  "src/order/legacy.ts",
  "src/order/order.ts",
  "src/service.php",
  "tests/unit",
  "tests/unit/panel.test.ts",
  "readme.md",
];

async function renderTree(files: FileDiff[] = FILES): Promise<UserEvent> {
  configureIpc({ startup: { scope: SCOPE, home: "/home/dev" }, diff: files });
  render(<App />);
  await screen.findByRole("region", { name: /^1 ÁRBOL/ });
  return userEvent.setup();
}

function rows(): HTMLElement[] {
  return within(panel("tree")).getAllByRole("option");
}

function rowPaths(): Array<string | null> {
  return rows().map((row) => row.getAttribute("data-path"));
}

function rowAt(path: string): HTMLElement {
  const row = rows().find((candidate) => candidate.getAttribute("data-path") === path);
  if (!row) throw new Error(`no hay fila para ${path}; hay ${rowPaths().join(", ")}`);
  return row;
}

function cursorPath(): string | null {
  const row = rows().find((candidate) => candidate.getAttribute("aria-selected") === "true");
  if (!row) throw new Error("ninguna fila lleva el cursor (aria-selected)");
  return row.getAttribute("data-path");
}

function comment(id: string, path: string, from: number, to: number): ReviewComment {
  return { id, path, side: "new", from, to, text: `nota ${id}` };
}

function seed(...comments: ReviewComment[]): void {
  act(() => {
    for (const item of comments) reviewStore.addComment(item);
  });
}

afterEach(() => {
  act(() => {
    for (const item of reviewStore.getState().comments) reviewStore.removeComment(item.id);
  });
});

describe("the tree shows the changed files", () => {
  it("TS-20: lists folders before files, alphabetically, expanded by default", async () => {
    await renderTree();

    expect(rowPaths()).toEqual(ALL_ROWS);
    expect(rowAt("src")).toHaveAttribute("data-kind", "dir");
    expect(rowAt("tests/unit")).toHaveAttribute("data-kind", "dir");
    expect(rowAt("readme.md")).toHaveAttribute("data-kind", "file");
    expect(rowAt("src/domain/user.php")).toHaveAttribute("data-kind", "file");
  });

  it("TS-20: shows the status letter and the +/− counters of every file", async () => {
    await renderTree();

    expect(rowAt("src/domain/user.php")).toHaveTextContent(/^M\s+user\.php/);
    expect(rowAt("src/domain/user.php")).toHaveTextContent(/\+12\s*[−-]\s*3\b/);

    expect(rowAt("src/order/order.ts")).toHaveTextContent(/^A\s+order\.ts/);
    expect(rowAt("src/order/order.ts")).toHaveTextContent(/\+120\s*[−-]\s*0\b/);

    expect(rowAt("src/order/legacy.ts")).toHaveTextContent(/^D\s+legacy\.ts/);
    expect(rowAt("src/order/legacy.ts")).toHaveTextContent(/\+0\s*[−-]\s*78\b/);
  });

  it("TS-20: shows a renamed file under its new path with the R status", async () => {
    await renderTree([
      fileDiff("src/domain/customer.php", {
        status: "R",
        oldPath: "src/legacy/client.php",
        additions: 4,
        deletions: 2,
      }),
      fileDiff("readme.md", { additions: 1, deletions: 1 }),
    ]);

    expect(rowPaths()).toEqual(["src/domain", "src/domain/customer.php", "readme.md"]);
    expect(rowAt("src/domain/customer.php")).toHaveTextContent(/^R\s+customer\.php/);
    expect(rowAt("src/domain/customer.php")).toHaveTextContent(/\+4\s*[−-]\s*2\b/);
  });

  it("TS-20: renders a single root file with no folder row", async () => {
    await renderTree([fileDiff("readme.md", { status: "A", additions: 30, deletions: 0 })]);

    expect(rowPaths()).toEqual(["readme.md"]);
    expect(rowAt("readme.md")).toHaveTextContent(/^A\s+readme\.md/);
    expect(rowAt("readme.md")).toHaveTextContent(/\+30\s*[−-]\s*0\b/);
  });

  it("TS-20: keeps names with spaces, accents and brackets as they are", async () => {
    await renderTree([
      fileDiff("informes finales/año 2026/resumen (final).md", { additions: 3, deletions: 1 }),
      fileDiff("señal.ts", { additions: 1, deletions: 0 }),
    ]);

    expect(rowPaths()).toEqual([
      "informes finales/año 2026",
      "informes finales/año 2026/resumen (final).md",
      "señal.ts",
    ]);
    expect(rowAt("informes finales/año 2026")).toHaveTextContent("informes finales/año 2026");
    expect(rowAt("informes finales/año 2026/resumen (final).md")).toHaveTextContent(
      /^M\s+resumen \(final\)\.md/,
    );
  });

  it("TS-20: renders a large tree and folds it from the root", async () => {
    const files = Array.from({ length: 200 }, (_, index) =>
      fileDiff(`pkg/mod${String(index).padStart(3, "0")}/file.ts`),
    );
    const user = await renderTree(files);

    expect(rows()).toHaveLength(1 + 200 * 2);
    expect(rowPaths().slice(0, 3)).toEqual(["pkg", "pkg/mod000", "pkg/mod000/file.ts"]);

    await user.keyboard("h");
    expect(rowPaths()).toEqual(["pkg"]);

    await user.keyboard("l");
    expect(rows()).toHaveLength(1 + 200 * 2);
  });
});

describe("the tree folds with h and l", () => {
  it("TS-20: h collapses the folder under the cursor and l expands it back", async () => {
    const user = await renderTree();

    await user.keyboard("jjj");
    expect(cursorPath()).toBe("src/order");

    await user.keyboard("h");
    expect(rowPaths()).toEqual([
      "src",
      "src/domain",
      "src/domain/user.php",
      "src/order",
      "src/service.php",
      "tests/unit",
      "tests/unit/panel.test.ts",
      "readme.md",
    ]);
    expect(rowAt("src/order")).toHaveAttribute("aria-expanded", "false");
    expect(cursorPath()).toBe("src/order");

    await user.keyboard("l");
    expect(rowPaths()).toEqual(ALL_ROWS);
    expect(rowAt("src/order")).toHaveAttribute("aria-expanded", "true");
    expect(cursorPath()).toBe("src/order");
  });

  it("TS-20: collapsing a folder hides its nested folders too", async () => {
    const user = await renderTree();

    await user.keyboard("h");

    expect(rowPaths()).toEqual(["src", "tests/unit", "tests/unit/panel.test.ts", "readme.md"]);
    expect(rowAt("src")).toHaveAttribute("aria-expanded", "false");
  });

  it("TS-20: h on a file moves the cursor to its folder without folding anything", async () => {
    const user = await renderTree();

    await user.keyboard("jj");
    expect(cursorPath()).toBe("src/domain/user.php");

    await user.keyboard("h");

    expect(cursorPath()).toBe("src/domain");
    expect(rowPaths()).toEqual(ALL_ROWS);
  });

  it("TS-20: h on a folder that is already collapsed goes up to its parent", async () => {
    const user = await renderTree();

    await user.keyboard("jh");
    expect(cursorPath()).toBe("src/domain");
    expect(rowAt("src/domain")).toHaveAttribute("aria-expanded", "false");

    await user.keyboard("h");

    expect(cursorPath()).toBe("src");
    expect(rowAt("src/domain")).toHaveAttribute("aria-expanded", "false");
    expect(rowAt("src")).toHaveAttribute("aria-expanded", "true");
  });

  it("TS-20: h on a collapsed top level row leaves the cursor where it is", async () => {
    const user = await renderTree();

    await user.keyboard("hh");

    expect(cursorPath()).toBe("src");
    expect(rowPaths()).toEqual(["src", "tests/unit", "tests/unit/panel.test.ts", "readme.md"]);
  });

  it("TS-20: l on a file changes nothing at all", async () => {
    const user = await renderTree();

    await user.keyboard("jj");
    await user.keyboard("l");

    expect(cursorPath()).toBe("src/domain/user.php");
    expect(rowPaths()).toEqual(ALL_ROWS);
  });

  it("TS-20: l on an expanded folder leaves it expanded", async () => {
    const user = await renderTree();

    await user.keyboard("l");

    expect(cursorPath()).toBe("src");
    expect(rowPaths()).toEqual(ALL_ROWS);
    expect(rowAt("src")).toHaveAttribute("aria-expanded", "true");
  });
});

describe("the tree moves with j and k", () => {
  it("TS-20: j and k walk the visible rows one by one", async () => {
    const user = await renderTree();

    expect(cursorPath()).toBe("src");

    await user.keyboard("jj");
    expect(cursorPath()).toBe("src/domain/user.php");

    await user.keyboard("k");
    expect(cursorPath()).toBe("src/domain");
  });

  it("keeps the row reached with the keyboard inside the tree scroll viewport", async () => {
    const user = await renderTree();
    const list = panel("tree").querySelector<HTMLElement>(".tree-list");
    if (!list) throw new Error("el árbol no tiene lista");

    vi.spyOn(list, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 300, 48));
    vi.spyOn(rowAt("src/domain"), "getBoundingClientRect").mockReturnValue(
      new DOMRect(0, 48, 300, 24),
    );

    await user.keyboard("j");

    expect(cursorPath()).toBe("src/domain");
    expect(list.scrollTop).toBe(24);
  });

  it("TS-20: j and k skip the rows hidden by a collapsed folder", async () => {
    const user = await renderTree();

    await user.keyboard("jjjh");
    expect(cursorPath()).toBe("src/order");

    await user.keyboard("j");
    expect(cursorPath()).toBe("src/service.php");

    await user.keyboard("k");
    expect(cursorPath()).toBe("src/order");
  });

  it("TS-20: j and k stop at the first and the last visible row", async () => {
    const user = await renderTree();

    await user.keyboard("kk");
    expect(cursorPath()).toBe("src");

    await user.keyboard("jjjjjjjjjjjjjjj");
    expect(cursorPath()).toBe("readme.md");

    await user.keyboard("j");
    expect(cursorPath()).toBe("readme.md");
  });

  it("TS-20: the last row follows the folding, so j stops earlier", async () => {
    const user = await renderTree();

    await user.keyboard("h");
    await user.keyboard("jjjjjjjjjj");

    expect(cursorPath()).toBe("readme.md");
    expect(rows()).toHaveLength(4);
  });
});

describe("Enter opens the file in the diff panel", () => {
  it("TS-20: Enter selects the file under the cursor", async () => {
    const user = await renderTree();

    expect(panel("diff")).not.toHaveTextContent("src/service.php");

    await user.keyboard("jjjjjj");
    expect(cursorPath()).toBe("src/service.php");

    await user.keyboard("{Enter}");
    expect(panel("diff")).toHaveTextContent("src/service.php");
  });

  it("TS-20: Enter on a folder does not change the file on show", async () => {
    const user = await renderTree();

    await user.keyboard("jjjjjj{Enter}");
    expect(panel("diff")).toHaveTextContent("src/service.php");

    await user.keyboard("kkkkkk{Enter}");

    expect(cursorPath()).toBe("src");
    expect(panel("diff")).toHaveTextContent("src/service.php");
  });

  it("TS-20: tells apart two files that share a name in different folders", async () => {
    const user = await renderTree([
      fileDiff("lib/index.ts", { status: "M", additions: 4, deletions: 1 }),
      fileDiff("app/index.ts", { status: "A", additions: 9, deletions: 0 }),
    ]);

    expect(rowPaths()).toEqual(["app", "app/index.ts", "lib", "lib/index.ts"]);

    await user.keyboard("jjj{Enter}");

    expect(cursorPath()).toBe("lib/index.ts");
    expect(panel("diff")).toHaveTextContent("lib/index.ts");
  });
});

describe("the tree marks the files that have comments", () => {
  it("TS-21: a file with comments shows how many it has", async () => {
    await renderTree();

    seed(
      comment("c1", "src/service.php", 35, 48),
      comment("c2", "src/service.php", 60, 60),
      comment("c3", "src/order/order.ts", 15, 26),
    );

    expect(rowAt("src/service.php")).toHaveTextContent(/●\s*2/);
    expect(rowAt("src/order/order.ts")).toHaveTextContent(/●\s*1/);
  });

  it("TS-21: a file with no comments carries no mark at all", async () => {
    await renderTree();

    seed(comment("c1", "src/service.php", 35, 48));

    expect(rowAt("src/domain/user.php")).not.toHaveTextContent("●");
    expect(rowAt("src/order/legacy.ts")).not.toHaveTextContent("●");
    expect(panel("tree")).not.toHaveTextContent(/✓|revisad/i);
  });

  it("TS-21: the mark goes away when the last comment of the file goes", async () => {
    await renderTree();
    seed(comment("c1", "src/service.php", 35, 48), comment("c2", "src/service.php", 60, 60));

    act(() => reviewStore.removeComment("c1"));
    expect(rowAt("src/service.php")).toHaveTextContent(/●\s*1/);

    act(() => reviewStore.removeComment("c2"));
    expect(rowAt("src/service.php")).not.toHaveTextContent("●");
  });

  it("TS-21: the mark follows the path, not the file name", async () => {
    await renderTree([
      fileDiff("lib/index.ts", { status: "M", additions: 4, deletions: 1 }),
      fileDiff("app/index.ts", { status: "A", additions: 9, deletions: 0 }),
    ]);

    seed(comment("c1", "lib/index.ts", 2, 2));

    expect(rowAt("lib/index.ts")).toHaveTextContent(/●\s*1/);
    expect(rowAt("app/index.ts")).not.toHaveTextContent("●");
  });
});

describe("the tree survives a trip to the other panels", () => {
  it("TS-22: keeps its folds and its cursor when coming back from panel 2 and 3", async () => {
    const user = await renderTree();

    await user.keyboard("jjjh");
    await user.keyboard("j");
    expect(cursorPath()).toBe("src/service.php");

    await user.keyboard("2jj");
    await user.keyboard("3j");
    await user.keyboard("1");

    expect(cursorPath()).toBe("src/service.php");
    expect(rowAt("src/order")).toHaveAttribute("aria-expanded", "false");
    expect(rowPaths()).toEqual([
      "src",
      "src/domain",
      "src/domain/user.php",
      "src/order",
      "src/service.php",
      "tests/unit",
      "tests/unit/panel.test.ts",
      "readme.md",
    ]);
  });

  it("TS-22: keeps the cursor after opening a file and coming back", async () => {
    const user = await renderTree();

    await user.keyboard("jjjjjj{Enter}");
    expect(cursorPath()).toBe("src/service.php");

    await user.keyboard("2j1");

    expect(cursorPath()).toBe("src/service.php");
    expect(panel("diff")).toHaveTextContent("src/service.php");
  });

  it("TS-22: j keeps moving from where the cursor was left", async () => {
    const user = await renderTree();

    await user.keyboard("jj");
    await user.keyboard("21");
    await user.keyboard("j");

    expect(cursorPath()).toBe("src/order");
  });
});

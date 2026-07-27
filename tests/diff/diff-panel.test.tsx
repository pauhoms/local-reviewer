import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { UserEvent } from "@testing-library/user-event";
import type { FileDiff, Line, Scope, Side } from "@/ipc/types";
import { panel } from "../keys/helpers";
import { resizeViewport, restoreLayout, stubLayout, VIEWPORT_HEIGHT } from "../helpers/diff-layout";

vi.mock("@/ipc/client", () => import("../helpers/ipc-mock"));

import App from "@/App";
import { configureIpc, readBlob } from "../helpers/ipc-mock";
import { reviewStore } from "@/state/review";

const SCOPE: Scope = { kind: "worktree", repo: "/home/dev/local-reviewer" };

const DEFAULT_READ_BLOB = readBlob.getMockImplementation();

function context(oldNo: number, newNo: number, content: string): Line {
  return { kind: "context", oldNo, newNo, content };
}

function add(newNo: number, content: string): Line {
  return { kind: "add", oldNo: null, newNo, content };
}

function del(oldNo: number, content: string): Line {
  return { kind: "del", oldNo, newNo: null, content };
}

const PHP_PATH = "src/UserService.php";

const PHP_NEW = [
  "<?php",
  "",
  "class UserService",
  "{",
  "    public function save(User $u): void {",
  "        $this->validate($u);",
  "        if (!$u->email) {",
  "            throw new BadRequest('email');",
  "        }",
  "        $this->repo->save($u);",
  "    }",
  "",
  "    /* Maps the raw repository row.",
  "     * public function ghost(): void",
  "     */",
  "    private function map(array $row): User {",
  "        return new User($row);",
  "    }",
  "}",
];

const PHP_OLD = [
  "<?php",
  "",
  "class UserService",
  "{",
  "    public function save(User $u): void {",
  "        $this->validate($u);",
  "        $this->repo->persist($u);",
  "    }",
  "",
  "    /* Maps the raw repository row.",
  "     * public function ghost(): void",
  "     * public function legacy(): void",
  "     */",
  "    private function map(array $row): User {",
  "        return new User($row);",
  "    }",
  "}",
];

function oldLine(number: number): string {
  return PHP_OLD[number - 1];
}

function newLine(number: number): string {
  return PHP_NEW[number - 1];
}

const PHP_HEADERS = ["@@ -5,4 +5,7 @@ class UserService", "@@ -11,4 +14,3 @@ class UserService"];

const phpFile: FileDiff = {
  path: PHP_PATH,
  oldPath: null,
  status: "M",
  additions: 4,
  deletions: 2,
  hunks: [
    {
      header: PHP_HEADERS[0],
      oldStart: 5,
      oldLines: 4,
      newStart: 5,
      newLines: 7,
      lines: [
        context(5, 5, newLine(5)),
        context(6, 6, newLine(6)),
        add(7, newLine(7)),
        add(8, newLine(8)),
        add(9, newLine(9)),
        del(7, oldLine(7)),
        add(10, newLine(10)),
        context(8, 11, newLine(11)),
      ],
    },
    {
      header: PHP_HEADERS[1],
      oldStart: 11,
      oldLines: 4,
      newStart: 14,
      newLines: 3,
      lines: [
        context(11, 14, newLine(14)),
        del(12, oldLine(12)),
        context(13, 15, newLine(15)),
        context(14, 16, newLine(16)),
      ],
    },
  ],
};

const PHP_BLOBS: Record<string, string> = {
  [`new:${PHP_PATH}`]: PHP_NEW.join("\n"),
  [`old:${PHP_PATH}`]: PHP_OLD.join("\n"),
};

/** Index of the diff line, kind, old number, new number and body, in order. */
const PHP_TABLE: Array<[string, string, string, string]> = [
  ["context", "5", "5", "    public function save(User $u): void {"],
  ["context", "6", "6", "        $this->validate($u);"],
  ["add", "", "7", "        if (!$u->email) {"],
  ["add", "", "8", "            throw new BadRequest('email');"],
  ["add", "", "9", "        }"],
  ["del", "7", "", "        $this->repo->persist($u);"],
  ["add", "", "10", "        $this->repo->save($u);"],
  ["context", "8", "11", "    }"],
  ["context", "11", "14", "     * public function ghost(): void"],
  ["del", "12", "", "     * public function legacy(): void"],
  ["context", "13", "15", "     */"],
  ["context", "14", "16", "    private function map(array $row): User {"],
];

const COMMENT_LINE = 8;
const DELETED_COMMENT_LINE = 9;
const CODE_LINE = 11;

function generatedTs(path: string, count: number): { file: FileDiff; blobs: Record<string, string> } {
  const rows = Array.from({ length: count }, (_, index) => `const l${index} = ${index};`);
  return {
    file: {
      path,
      oldPath: null,
      status: "A",
      additions: count,
      deletions: 0,
      hunks: [
        {
          header: `@@ -0,0 +1,${count} @@`,
          oldStart: 0,
          oldLines: 0,
          newStart: 1,
          newLines: count,
          lines: rows.map((content, index) => add(index + 1, content)),
        },
      ],
    },
    blobs: { [`new:${path}`]: rows.join("\n") },
  };
}

function diffPanel(): HTMLElement {
  return panel("diff");
}

function viewport(): HTMLElement {
  const node = diffPanel().querySelector<HTMLElement>("[data-diff-viewport]");
  if (!node) throw new Error("panel 2 does not expose [data-diff-viewport]");
  return node;
}

function lineRows(): HTMLElement[] {
  return Array.from(diffPanel().querySelectorAll<HTMLElement>("[data-line-index]"));
}

function mountedIndexes(): number[] {
  return lineRows().map((row) => Number(row.getAttribute("data-line-index")));
}

function rowAt(index: number): HTMLElement {
  const row = lineRows().find((candidate) => Number(candidate.getAttribute("data-line-index")) === index);
  if (!row) throw new Error(`line ${index} is not mounted; found ${mountedIndexes().join(", ")}`);
  return row;
}

function partOf(row: HTMLElement, attribute: string): HTMLElement | null {
  return row.querySelector<HTMLElement>(`[${attribute}]`);
}

function contentEl(row: HTMLElement): HTMLElement {
  const node = partOf(row, "data-line-content");
  if (!node) throw new Error(`line ${row.getAttribute("data-line-index")} has no [data-line-content]`);
  return node;
}

function bodyOf(index: number): string {
  return contentEl(rowAt(index)).textContent ?? "";
}

function numbersOf(index: number): [string, string] {
  const row = rowAt(index);
  return [
    partOf(row, "data-old-no")?.textContent?.trim() ?? "",
    partOf(row, "data-new-no")?.textContent?.trim() ?? "",
  ];
}

function kindOf(index: number): string | null {
  return rowAt(index).getAttribute("data-kind");
}

function markerOf(index: number): string {
  return partOf(rowAt(index), "data-line-marker")?.textContent?.trim() ?? "";
}

function coloursOf(index: number): string[] {
  const content = contentEl(rowAt(index));
  const nodes = [content, ...Array.from(content.querySelectorAll<HTMLElement>("[style]"))];
  return nodes.map((node) => node.style.color).filter((colour) => colour !== "");
}

function cursorIndex(): number {
  const marked = lineRows().filter((row) => row.getAttribute("data-cursor") === "true");
  if (marked.length > 1) {
    const indexes = marked.map((row) => row.getAttribute("data-line-index")).join(", ");
    throw new Error(`${marked.length} lines have the cursor at the same time: ${indexes}`);
  }
  if (marked.length === 0) return -1;
  return Number(marked[0].getAttribute("data-line-index"));
}

function selectedIndexes(): number[] {
  return lineRows()
    .filter((row) => row.getAttribute("aria-selected") === "true")
    .map((row) => Number(row.getAttribute("data-line-index")));
}

function pageSize(): number {
  const value = Number(viewport().getAttribute("data-page-size"));
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`data-page-size is not a row count: ${viewport().getAttribute("data-page-size")}`);
  }
  return value;
}

function visibleWindow(): [number, number] {
  const first = Number(viewport().getAttribute("data-first-visible"));
  const last = Number(viewport().getAttribute("data-last-visible"));
  if (!Number.isInteger(first) || !Number.isInteger(last) || first > last) {
    throw new Error(`the visible window is not a range: ${first}..${last}`);
  }
  return [first, last];
}

function expectCursorVisible(): void {
  const [first, last] = visibleWindow();
  const cursor = cursorIndex();
  expect(cursor).toBeGreaterThanOrEqual(first);
  expect(cursor).toBeLessThanOrEqual(last);
  const mounted = mountedIndexes();
  for (let index = first; index <= last; index += 1) {
    expect(mounted).toContain(index);
  }
}

function editableNodes(): Element[] {
  return Array.from(
    diffPanel().querySelectorAll("input, textarea, select, [contenteditable], [role='textbox']"),
  );
}

/** One task for the whole burst: the shape a key repeat takes, with no render in between. */
function burst(...keys: Array<string | KeyboardEventInit>): void {
  act(() => {
    for (const entry of keys) {
      const init = typeof entry === "string" ? { key: entry } : entry;
      document.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, ...init }));
    }
  });
}

const CTRL_D: KeyboardEventInit = { key: "d", ctrlKey: true };
const CTRL_U: KeyboardEventInit = { key: "u", ctrlKey: true };

async function boot(
  files: FileDiff[],
  blobs: Record<string, string> = {},
): Promise<UserEvent> {
  configureIpc({ startup: { scope: SCOPE, home: "/home/dev" }, diff: files, blobs });
  render(<App />);
  await screen.findByRole("region", { name: /^1 FILES/ });
  const user = userEvent.setup();
  await user.keyboard("2");
  await act(async () => undefined);
  return user;
}

function bootPhp(): Promise<UserEvent> {
  return boot([phpFile], PHP_BLOBS);
}

interface BlobGate {
  release: (path: string, sources: Partial<Record<Side, string>>) => Promise<void>;
  asked: () => string[];
}

/** Holds every `read_blob` answer until the test lets the ones of a file through. */
function gateBlobs(): BlobGate {
  const pending = new Map<string, (source: string) => void>();
  const asked: string[] = [];
  readBlob.mockImplementation((_scope: Scope, path: string, side: Side) => {
    const key = `${side}:${path}`;
    asked.push(key);
    return new Promise<string>((resolve) => pending.set(key, resolve));
  });
  return {
    release: async (path, sources) => {
      const sides: Side[] = ["old", "new"];
      const waiting = sides.filter((side) => pending.has(`${side}:${path}`));
      if (waiting.length === 0) {
        throw new Error(`no request is waiting for the ${path} blob; requested ${asked.join(", ")}`);
      }
      await act(async () => {
        for (const side of waiting) {
          const key = `${side}:${path}`;
          pending.get(key)?.(sources[side] ?? "");
          pending.delete(key);
        }
      });
    },
    asked: () => [...asked],
  };
}

beforeEach(() => {
  stubLayout(VIEWPORT_HEIGHT);
});

afterEach(() => {
  restoreLayout();
  readBlob.mockImplementation(DEFAULT_READ_BLOB ?? (() => Promise.resolve("")));
  act(() => reviewStore.open(SCOPE, []));
});

describe("the diff panel shows the hunks of the selected file", () => {
  it("TS-23: renders every diff line with its old and new numbers", async () => {
    await bootPhp();

    expect(diffPanel()).toHaveTextContent(PHP_PATH);
    expect(mountedIndexes()).toEqual([...PHP_TABLE.keys()]);

    PHP_TABLE.forEach(([, oldNo, newNo, body], index) => {
      expect(numbersOf(index)).toEqual([oldNo, newNo]);
      expect(bodyOf(index)).toBe(body);
    });
  });

  it("TS-23: tells add, del and context apart by kind and by marker", async () => {
    await bootPhp();

    PHP_TABLE.forEach(([kind], index) => {
      expect(kindOf(index)).toBe(kind);
    });

    expect(markerOf(2)).toBe("+");
    expect(markerOf(5)).toMatch(/^[-−]$/);
    expect(markerOf(0)).toBe("");
  });

  it("TS-23: puts the hunk headers as separators before the lines of their hunk", async () => {
    await bootPhp();

    const stream = Array.from(
      viewport().querySelectorAll<HTMLElement>("[data-hunk-header], [data-line-index]"),
    ).map((node) =>
      node.hasAttribute("data-hunk-header")
        ? `header:${node.textContent?.trim()}`
        : `line:${node.getAttribute("data-line-index")}`,
    );

    expect(stream).toEqual([
      `header:${PHP_HEADERS[0]}`,
      ...[0, 1, 2, 3, 4, 5, 6, 7].map((index) => `line:${index}`),
      `header:${PHP_HEADERS[1]}`,
      ...[8, 9, 10, 11].map((index) => `line:${index}`),
    ]);

    for (const header of Array.from(viewport().querySelectorAll("[data-hunk-header]"))) {
      expect(header).toHaveAttribute("role", "separator");
      expect(header).not.toHaveAttribute("data-line-index");
    }
  });

  it("TS-23: offers nothing to type into, in normal or in visual mode", async () => {
    const user = await bootPhp();

    expect(lineRows()).toHaveLength(PHP_TABLE.length);
    expect(editableNodes()).toEqual([]);

    await user.keyboard("jjvj");
    expect(selectedIndexes()).toEqual([2, 3]);
    expect(editableNodes()).toEqual([]);

    await user.keyboard("{Escape}");
    expect(cursorIndex()).toBe(3);
    expect(editableNodes()).toEqual([]);
  });

  it("TS-23: says so when the file carries no hunks at all", async () => {
    const binary: FileDiff = {
      path: "assets/logo.png",
      oldPath: null,
      status: "M",
      additions: 0,
      deletions: 0,
      hunks: [],
    };
    const user = await boot([binary]);

    expect(lineRows()).toEqual([]);
    expect(diffPanel()).toHaveTextContent(/no lines to display/i);

    await user.keyboard("jkv");
    await user.keyboard("{Escape}");
    expect(cursorIndex()).toBe(-1);
    expect(lineRows()).toEqual([]);
  });

  it("TS-23: survives a hunk that carries no lines", async () => {
    const emptyHunk: FileDiff = {
      path: "src/empty.ts",
      oldPath: null,
      status: "M",
      additions: 0,
      deletions: 0,
      hunks: [{ header: "@@ -1,0 +1,0 @@", oldStart: 1, oldLines: 0, newStart: 1, newLines: 0, lines: [] }],
    };
    const user = await boot([emptyHunk]);

    expect(lineRows()).toEqual([]);
    expect(diffPanel()).toHaveTextContent(/no lines to display/i);

    await user.keyboard("{Shift>}G{/Shift}");
    expect(cursorIndex()).toBe(-1);
  });

  it("TS-23: says so when the selected file is not among the changes", async () => {
    await bootPhp();

    act(() => reviewStore.selectFile("src/no/existe.ts"));

    expect(lineRows()).toEqual([]);
    expect(diffPanel()).toHaveTextContent(/not part of these changes/i);
  });

  it("TS-23: keeps empty lines, tabs, non-ASCII text, emoji and very long lines", async () => {
    const body = [
      "# Notas",
      "",
      "\tcon tabulador",
      "señal año 🚀 emoji",
      "x".repeat(2000),
      "fin con retorno\r",
    ];
    const notes: FileDiff = {
      path: "docs/notas.md",
      oldPath: null,
      status: "A",
      additions: body.length,
      deletions: 0,
      hunks: [
        {
          header: `@@ -0,0 +1,${body.length} @@`,
          oldStart: 0,
          oldLines: 0,
          newStart: 1,
          newLines: body.length,
          lines: body.map((content, index) => add(index + 1, content)),
        },
      ],
    };
    await boot([notes]);

    expect(lineRows()).toHaveLength(body.length);
    expect(bodyOf(0)).toBe("# Notas");
    expect(bodyOf(1)).toBe("");
    expect(bodyOf(2)).toBe("\tcon tabulador");
    expect(bodyOf(3)).toBe("señal año 🚀 emoji");
    expect(bodyOf(4)).toHaveLength(2000);
    expect(numbersOf(4)).toEqual(["", "5"]);
    expect(bodyOf(5)).toBe("fin con retorno");
  });

  it("TS-23: renders a file of a single line and keeps both ends on it", async () => {
    const { file, blobs } = generatedTs("src/one.ts", 1);
    const user = await boot([file], blobs);

    expect(mountedIndexes()).toEqual([0]);
    expect(bodyOf(0)).toBe("const l0 = 0;");
    expect(cursorIndex()).toBe(0);

    await user.keyboard("{Shift>}G{/Shift}");
    expect(cursorIndex()).toBe(0);

    await user.keyboard("gg");
    expect(cursorIndex()).toBe(0);
    expect(visibleWindow()).toEqual([0, 0]);
  });
});

describe("the highlight comes from the whole file, not from the line", () => {
  it("TS-24: colours a block comment that opened before the hunk", async () => {
    await bootPhp();

    await waitFor(() => expect(coloursOf(CODE_LINE).length).toBeGreaterThan(1));

    const comment = coloursOf(COMMENT_LINE);
    expect(comment.length).toBeGreaterThan(0);
    expect(new Set(comment).size).toBe(1);
    expect(bodyOf(COMMENT_LINE)).toBe("     * public function ghost(): void");

    const code = new Set(coloursOf(CODE_LINE));
    expect(code.size).toBeGreaterThan(1);
    expect(code).not.toContain(comment[0]);
  });

  it("TS-24: takes the tokens of a deleted line from the old side of the file", async () => {
    await bootPhp();

    await waitFor(() => expect(coloursOf(DELETED_COMMENT_LINE).length).toBeGreaterThan(0));

    expect(bodyOf(DELETED_COMMENT_LINE)).toBe("     * public function legacy(): void");
    expect(new Set(coloursOf(DELETED_COMMENT_LINE)).size).toBe(1);
    expect(coloursOf(DELETED_COMMENT_LINE)[0]).toBe(coloursOf(COMMENT_LINE)[0]);

    expect(readBlob).toHaveBeenCalledWith(SCOPE, PHP_PATH, "old");
    expect(readBlob).toHaveBeenCalledWith(SCOPE, PHP_PATH, "new");
  });

  it("TS-24: colours an added line with the tokens of the new file", async () => {
    await bootPhp();

    await waitFor(() => expect(coloursOf(2).length).toBeGreaterThan(1));

    expect(bodyOf(2)).toBe("        if (!$u->email) {");
    expect(new Set(coloursOf(2)).size).toBeGreaterThan(1);
  });

  it("TS-24: shows the diff while the blob is still in flight and colours it later", async () => {
    const gate = gateBlobs();
    await bootPhp();

    expect(mountedIndexes()).toHaveLength(PHP_TABLE.length);
    expect(bodyOf(COMMENT_LINE)).toBe("     * public function ghost(): void");
    expect(coloursOf(COMMENT_LINE)).toEqual([]);

    await gate.release(PHP_PATH, { new: PHP_NEW.join("\n"), old: PHP_OLD.join("\n") });

    await waitFor(() => expect(coloursOf(COMMENT_LINE).length).toBeGreaterThan(0));
    expect(bodyOf(COMMENT_LINE)).toBe("     * public function ghost(): void");
  });

  it("TS-24: throws away the blob of a file that is no longer on show", async () => {
    const staleFile: FileDiff = {
      path: "a.ts",
      oldPath: null,
      status: "A",
      additions: 2,
      deletions: 0,
      hunks: [
        {
          header: "@@ -0,0 +1,2 @@",
          oldStart: 0,
          oldLines: 0,
          newStart: 1,
          newLines: 2,
          lines: [add(1, "const A_STALE = 1;"), add(2, "const a2 = 2;")],
        },
      ],
    };
    const freshLines = ["<?php", "/* nota", " * public function fake(): void", " */", "class B {}"];
    const freshFile: FileDiff = {
      path: "b.php",
      oldPath: null,
      status: "A",
      additions: 1,
      deletions: 0,
      hunks: [
        {
          header: "@@ -0,0 +3,1 @@",
          oldStart: 0,
          oldLines: 0,
          newStart: 3,
          newLines: 1,
          lines: [add(3, freshLines[2])],
        },
      ],
    };

    const gate = gateBlobs();
    const user = await boot([staleFile, freshFile]);
    expect(bodyOf(0)).toBe("const A_STALE = 1;");

    await user.keyboard("1j{Enter}2");
    expect(bodyOf(0)).toBe(" * public function fake(): void");

    await gate.release("b.php", { new: freshLines.join("\n") });
    await waitFor(() => expect(coloursOf(0).length).toBeGreaterThan(0));

    // The answer for the file that left arrives last: it must change nothing.
    await gate.release("a.ts", { new: ["const A_STALE = 1;", "const a2 = 2;"].join("\n") });

    expect(diffPanel()).not.toHaveTextContent("A_STALE");
    expect(bodyOf(0)).toBe(" * public function fake(): void");
    expect(new Set(coloursOf(0)).size).toBe(1);
  });

  it("TS-24: falls back to plain text when the blob does not cover the diff", async () => {
    await boot([phpFile], { [`new:${PHP_PATH}`]: "<?php\n" });
    await act(async () => undefined);

    expect(bodyOf(COMMENT_LINE)).toBe("     * public function ghost(): void");
    expect(bodyOf(CODE_LINE)).toBe("    private function map(array $row): User {");
    expect(lineRows()).toHaveLength(PHP_TABLE.length);
  });

  it("TS-24: never lets a blob that moved on replace the body of the diff", async () => {
    const drifted = Array.from({ length: 20 }, (_, index) => `línea falsa ${index + 1}`).join("\n");
    await boot([phpFile], { [`new:${PHP_PATH}`]: drifted, [`old:${PHP_PATH}`]: drifted });
    await act(async () => undefined);

    expect(mountedIndexes()).toEqual([...PHP_TABLE.keys()]);
    PHP_TABLE.forEach(([, , , body], index) => {
      expect(bodyOf(index)).toBe(body);
    });
  });

  it("TS-24: keeps the diff readable when read_blob fails", async () => {
    readBlob.mockImplementation(() => Promise.reject(new Error("objeto ilegible")));
    await bootPhp();
    await act(async () => undefined);

    expect(lineRows()).toHaveLength(PHP_TABLE.length);
    expect(bodyOf(0)).toBe("    public function save(User $u): void {");
    expect(coloursOf(0)).toEqual([]);
  });
});

describe("only the supported extensions get colours", () => {
  it("TS-25: a markdown file renders as plain text with no colour at all", async () => {
    const body = ["# Título", "texto **suelto**", "```ts", "const x = 1;", "```"];
    const notes: FileDiff = {
      path: "docs/guia.md",
      oldPath: null,
      status: "A",
      additions: body.length,
      deletions: 0,
      hunks: [
        {
          header: `@@ -0,0 +1,${body.length} @@`,
          oldStart: 0,
          oldLines: 0,
          newStart: 1,
          newLines: body.length,
          lines: body.map((content, index) => add(index + 1, content)),
        },
      ],
    };
    await boot([notes], { "new:docs/guia.md": body.join("\n") });
    await act(async () => undefined);

    expect(mountedIndexes()).toEqual([0, 1, 2, 3, 4]);
    for (const index of [0, 1, 2, 3, 4]) {
      expect(coloursOf(index)).toEqual([]);
      expect(bodyOf(index)).toBe(body[index]);
    }
  });

  it("TS-25: a .ts file does get colours", async () => {
    const { file, blobs } = generatedTs("src/order.ts", 3);
    await boot([file], blobs);

    await waitFor(() => expect(coloursOf(0).length).toBeGreaterThan(1));
    expect(bodyOf(0)).toBe("const l0 = 0;");
  });
});

describe("the cursor walks the diff with the Vim keys", () => {
  const LINES = 200;

  async function bootBig(): Promise<UserEvent> {
    const { file, blobs } = generatedTs("src/big.ts", LINES);
    return boot([file], blobs);
  }

  it("TS-26: j and k move one line and stop at both ends", async () => {
    const user = await bootBig();

    expect(cursorIndex()).toBe(0);

    await user.keyboard("jjj");
    expect(cursorIndex()).toBe(3);
    expect(bodyOf(3)).toBe("const l3 = 3;");

    await user.keyboard("k");
    expect(cursorIndex()).toBe(2);

    await user.keyboard("kkkk");
    expect(cursorIndex()).toBe(0);

    await user.keyboard("{Shift>}G{/Shift}j");
    expect(cursorIndex()).toBe(LINES - 1);
  });

  it("TS-26: gg and G go to the first and the last line", async () => {
    const user = await bootBig();

    await user.keyboard("{Shift>}G{/Shift}");
    expect(cursorIndex()).toBe(LINES - 1);
    expect(bodyOf(LINES - 1)).toBe(`const l${LINES - 1} = ${LINES - 1};`);
    expectCursorVisible();

    await user.keyboard("gg");
    expect(cursorIndex()).toBe(0);
    expect(visibleWindow()[0]).toBe(0);
    expectCursorVisible();
  });

  it("TS-26: Ctrl+d and Ctrl+u move half a page of the viewport", async () => {
    const user = await bootBig();
    const half = Math.floor(pageSize() / 2);
    expect(half).toBeGreaterThan(0);

    await user.keyboard("{Control>}d{/Control}");
    expect(cursorIndex()).toBe(half);
    expectCursorVisible();

    await user.keyboard("{Control>}d{/Control}");
    expect(cursorIndex()).toBe(half * 2);
    expectCursorVisible();

    await user.keyboard("{Control>}u{/Control}");
    expect(cursorIndex()).toBe(half);
    expectCursorVisible();
  });

  it("TS-26: the window on show is a page long and always holds the cursor", async () => {
    const user = await bootBig();
    const size = pageSize();

    const [first, last] = visibleWindow();
    expect(last - first + 1).toBeGreaterThanOrEqual(Math.min(size, LINES));
    expect(last - first + 1).toBeLessThanOrEqual(Math.min(size + 1, LINES));

    for (const keys of ["jjjj", "{Shift>}G{/Shift}", "gg", "{Control>}d{/Control}"]) {
      await user.keyboard(keys);
      expectCursorVisible();
    }
  });

  it("TS-26: half a page follows the viewport when it is resized", async () => {
    const user = await bootBig();
    const before = pageSize();

    act(() => resizeViewport(Math.floor(VIEWPORT_HEIGHT / 2)));

    const after = pageSize();
    expect(after).toBeLessThan(before);
    expect(after).toBeGreaterThan(0);

    await user.keyboard("gg");
    await user.keyboard("{Control>}d{/Control}");

    expect(cursorIndex()).toBe(Math.floor(after / 2));
    expectCursorVisible();
  });

  it("TS-26: a burst of keys lands where the last key says", async () => {
    await bootBig();

    burst("G", "k");
    expect(cursorIndex()).toBe(LINES - 2);
    expectCursorVisible();

    burst("g", "g", "j");
    expect(cursorIndex()).toBe(1);
    expectCursorVisible();

    burst(CTRL_D, CTRL_D, CTRL_U);
    expect(cursorIndex()).toBe(1 + Math.floor(pageSize() / 2));
    expectCursorVisible();
  });

  it("TS-26: opening another file leaves the cursor inside the new file", async () => {
    const small = generatedTs("a.ts", 4);
    const large = generatedTs("b.ts", 60);
    const user = await boot([small.file, large.file], { ...small.blobs, ...large.blobs });

    await user.keyboard("1j{Enter}2");
    expect(diffPanel()).toHaveTextContent("b.ts");

    await user.keyboard("{Shift>}G{/Shift}");
    expect(cursorIndex()).toBe(59);

    // Back to the short file in a single task. Opening it puts the cursor on
    // line 0, and the `j` that follows in the same burst has to be answered
    // against the file already open — landing on line 1, not swallowed.
    burst("1", "k", "Enter", "2", "j");

    expect(diffPanel()).toHaveTextContent("a.ts");
    expect(mountedIndexes()).toEqual([0, 1, 2, 3]);
    expect(cursorIndex()).toBe(1);
    expectCursorVisible();
  });
});

describe("v selects a range of lines", () => {
  it("TS-27: v paints the line under the cursor and j grows the range", async () => {
    const user = await bootPhp();

    await user.keyboard("jj");
    expect(selectedIndexes()).toEqual([2]);

    await user.keyboard("v");
    expect(screen.getByText("VISUAL")).toBeInTheDocument();
    expect(selectedIndexes()).toEqual([2]);

    await user.keyboard("jj");
    expect(selectedIndexes()).toEqual([2, 3, 4]);
    expect(cursorIndex()).toBe(4);
  });

  it("TS-27: k shrinks the range and keeps growing past the anchor", async () => {
    const user = await bootPhp();

    await user.keyboard("jjjv");
    await user.keyboard("jj");
    expect(selectedIndexes()).toEqual([3, 4, 5]);

    await user.keyboard("k");
    expect(selectedIndexes()).toEqual([3, 4]);

    await user.keyboard("kkk");
    expect(selectedIndexes()).toEqual([1, 2, 3]);
    expect(cursorIndex()).toBe(1);
  });

  it("TS-27: Esc drops the range and goes back to normal", async () => {
    const user = await bootPhp();

    await user.keyboard("jvjj");
    expect(selectedIndexes()).toEqual([1, 2, 3]);

    await user.keyboard("{Escape}");

    expect(screen.getByText("NORMAL")).toBeInTheDocument();
    expect(screen.queryByText("VISUAL")).toBeNull();
    expect(selectedIndexes()).toEqual([3]);
    expect(cursorIndex()).toBe(3);
  });

  it("TS-27: a range longer than the window keeps painting the lines on show", async () => {
    const { file, blobs } = generatedTs("src/big.ts", 200);
    const user = await boot([file], blobs);
    const size = pageSize();

    const head = size + 5;
    await user.keyboard("v");
    await user.keyboard("j".repeat(head));

    expect(cursorIndex()).toBe(head);
    expectCursorVisible();

    const [first, last] = visibleWindow();
    expect(last - first + 1).toBeLessThan(head + 1);

    // Whatever the window mounts, the painted lines are the ones inside the range.
    const expected = mountedIndexes().filter((index) => index <= head);
    expect(expected.length).toBeGreaterThan(0);
    expect(selectedIndexes()).toEqual(expected);
  });
});

describe("a diff of thousands of lines stays in a window", () => {
  const LINES = 5000;

  it("TS-28: mounts about a page of lines, never the five thousand", async () => {
    const { file, blobs } = generatedTs("src/huge.ts", LINES);
    await boot([file], blobs);

    const mounted = lineRows().length;
    expect(mounted).toBeGreaterThan(0);
    expect(mounted).toBeLessThan(200);
    expect(mounted).toBeLessThanOrEqual(pageSize() * 3);
  });

  it("TS-28: gg and G still land on the first and the last of the five thousand", async () => {
    const { file, blobs } = generatedTs("src/huge.ts", LINES);
    const user = await boot([file], blobs);

    await user.keyboard("{Shift>}G{/Shift}");
    expect(cursorIndex()).toBe(LINES - 1);
    expect(bodyOf(LINES - 1)).toBe(`const l${LINES - 1} = ${LINES - 1};`);
    expect(numbersOf(LINES - 1)).toEqual(["", String(LINES)]);
    expect(lineRows().length).toBeLessThan(200);
    expectCursorVisible();

    await user.keyboard("gg");
    expect(cursorIndex()).toBe(0);
    expect(bodyOf(0)).toBe("const l0 = 0;");
    expect(lineRows().length).toBeLessThan(200);
    expectCursorVisible();
  });

  it("TS-28: keeps the window bounded when there is no layout to measure", async () => {
    restoreLayout();
    const { file, blobs } = generatedTs("src/huge.ts", LINES);
    const user = await boot([file], blobs);

    expect(lineRows().length).toBeGreaterThan(0);
    expect(lineRows().length).toBeLessThan(200);
    expect(pageSize()).toBeGreaterThan(0);

    await user.keyboard("{Shift>}G{/Shift}");
    expect(cursorIndex()).toBe(LINES - 1);
  });
});

/**
 * TS-36..TS-39 — panel 2 in split view: two aligned columns, an active side,
 * selections and comments anchored to that side, and the chosen view surviving
 * a restart. Everything goes through `<App />` and real keyboard events.
 *
 * The DOM contract these tests assume (invented where the spec is silent, see
 * the phase report):
 *
 *   split row  `<li data-split-row="{n}">` inside panel 2, `n` = index of the
 *              row in `splitRows(file)`; hunk headers keep `[data-hunk-header]`
 *              and span both columns (no `[data-side]` inside them).
 *   cell       `[data-side="old"|"new"]` inside the row, exactly one per side.
 *              A cell holding a line carries `data-line-index` (the same
 *              numbering the unified view uses), `data-kind`, `[data-old-no]` /
 *              `[data-new-no]`, `[data-line-marker]` and `[data-line-content]`,
 *              on the cell itself or on a node inside it. A gap carries none of
 *              those and is still there, so the columns cannot drift apart.
 *   cursor     `data-cursor="true"` inside the cell of the **active side** of
 *              the row the cursor is on, gap or not, and nowhere else.
 *   selection  `aria-selected="true"` only inside cells of the active side.
 *   columns    `[data-column="old"|"new"]` headers reading OLD / NEW, with
 *              `data-active="true"` on the active one (mockup: `◀ active side`).
 *   heading    panel 2's heading says `SPLIT` and `OLD side` / `NEW side`
 *              (mockup: `2 DIFF  src/UserService.php   SPLIT · NEW side`).
 *              In unified it says neither.
 *
 * Keys, from the mockup: `Ctrl+w v` splits, `Ctrl+w o` goes back to unified,
 * `Ctrl+w h` / `h` take the old side, `Ctrl+w l` / `l` the new one.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { UserEvent } from "@testing-library/user-event";
import type { Comment, DiffView, FileDiff, Line, Review, Scope } from "@/ipc/types";
import { panel } from "../keys/helpers";
import { restoreLayout, ROW_HEIGHT, stubLayout, VIEWPORT_HEIGHT } from "../helpers/diff-layout";

vi.mock("@/ipc/client", () => import("../helpers/ipc-mock"));

import App from "@/App";
import { configureIpc, saveReview } from "../helpers/ipc-mock";
import { reviewStore } from "@/state/review";

const SCOPE: Scope = { kind: "worktree", repo: "/home/dev/local-reviewer" };

const SPLIT = "{Control>}w{/Control}v";
const ONLY = "{Control>}w{/Control}o";
const WIN_LEFT = "{Control>}w{/Control}h";
const WIN_RIGHT = "{Control>}w{/Control}l";

const CTRL_W: KeyboardEventInit = { key: "w", ctrlKey: true };

type Side = "old" | "new";

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
const TS_PATH = "web/Order.ts";

/**
 * The rewrite of the phase mockup. Line index, old number and new number are
 * three different numbers on purpose, and the run is interleaved the way git
 * writes it, so a row index cannot be mistaken for a line index.
 *
 *   idx  kind     old  new   body
 *    0   context   33   33   public function save(User $u) {
 *    1   context   34   34   $this->validate($u);
 *    2   add        ·   35   if (!$u->email) {
 *    3   add        ·   36   throw new BadRequest('email');
 *    4   add        ·   37   }
 *    5   del       35    ·   $this->repo->persist($u);
 *    6   del       36    ·   $this->repo->flush();
 *    7   add        ·   38   $this->repo->save($u);
 *    8   context   37   39   }
 *    9   context   98  100   private function map(array $r) {
 *   10   add        ·  101   $r['id'] = (int) $r['id'];
 *   11   context   99  102   return new User($r);
 */
const BODIES: Record<number, string> = {
  0: "  public function save(User $u) {",
  1: "    $this->validate($u);",
  2: "    if (!$u->email) {",
  3: "      throw new BadRequest('email');",
  4: "    }",
  5: "    $this->repo->persist($u);",
  6: "    $this->repo->flush();",
  7: "    $this->repo->save($u);",
  8: "  }",
  9: "  private function map(array $r) {",
  10: "    $r['id'] = (int) $r['id'];",
  11: "    return new User($r);",
};

const phpFile: FileDiff = {
  path: PHP_PATH,
  oldPath: null,
  status: "M",
  additions: 5,
  deletions: 2,
  hunks: [
    {
      header: "@@ -33,5 +33,7 @@ class UserService",
      oldStart: 33,
      oldLines: 5,
      newStart: 33,
      newLines: 7,
      lines: [
        context(33, 33, BODIES[0]),
        context(34, 34, BODIES[1]),
        add(35, BODIES[2]),
        add(36, BODIES[3]),
        add(37, BODIES[4]),
        del(35, BODIES[5]),
        del(36, BODIES[6]),
        add(38, BODIES[7]),
        context(37, 39, BODIES[8]),
      ],
    },
    {
      header: "@@ -98,3 +100,4 @@ class UserService",
      oldStart: 98,
      oldLines: 3,
      newStart: 100,
      newLines: 4,
      lines: [
        context(98, 100, BODIES[9]),
        add(101, BODIES[10]),
        context(99, 102, BODIES[11]),
      ],
    },
  ],
};

/** The other file of the tree: nothing but additions, so its old column is empty. */
const tsFile: FileDiff = {
  path: TS_PATH,
  oldPath: null,
  status: "A",
  additions: 3,
  deletions: 0,
  hunks: [
    {
      header: "@@ -0,0 +1,3 @@",
      oldStart: 0,
      oldLines: 0,
      newStart: 1,
      newLines: 3,
      lines: [
        add(1, "export interface Order {"),
        add(2, "  id: string;"),
        add(3, "}"),
      ],
    },
  ],
};

const FILES: FileDiff[] = [phpFile, tsFile];

/** Many small hunks, both sides changed: rows and lines never agree. */
function bigDiff(path: string, hunks: number): FileDiff {
  return {
    path,
    oldPath: null,
    status: "M",
    additions: hunks * 3,
    deletions: hunks * 2,
    hunks: Array.from({ length: hunks }, (_, h) => {
      const start = h * 100 + 1;
      return {
        header: `@@ -${start},4 +${start},5 @@ bloque ${h}`,
        oldStart: start,
        oldLines: 4,
        newStart: start,
        newLines: 5,
        lines: [
          context(start, start, `h${h} contexto`),
          del(start + 1, `h${h} borrada 1`),
          del(start + 2, `h${h} borrada 2`),
          add(start + 1, `h${h} añadida 1`),
          add(start + 2, `h${h} añadida 2`),
          add(start + 3, `h${h} añadida 3`),
          context(start + 3, start + 4, `h${h} cierre`),
        ],
      };
    }),
  };
}

// --- reaching into the DOM ---------------------------------------------------

function diffPanel(): HTMLElement {
  return panel("diff");
}

function heading(): HTMLElement {
  return within(diffPanel()).getAllByRole("heading")[0];
}

function headingText(): string {
  return heading().textContent ?? "";
}

function viewport(): HTMLElement {
  const node = diffPanel().querySelector<HTMLElement>("[data-diff-viewport]");
  if (!node) throw new Error("panel 2 does not expose [data-diff-viewport]");
  return node;
}

function splitRowNodes(): HTMLElement[] {
  return Array.from(diffPanel().querySelectorAll<HTMLElement>("[data-split-row]"));
}

/** The rows of the unified view: anything inside a split row belongs to the other one. */
function unifiedRowNodes(): HTMLElement[] {
  return Array.from(diffPanel().querySelectorAll<HTMLElement>("[data-line-index]")).filter(
    (node) => node.closest("[data-split-row]") === null && !node.hasAttribute("data-side"),
  );
}

function unifiedCursorIndex(): number {
  const marked = unifiedRowNodes().filter((row) => row.getAttribute("data-cursor") === "true");
  if (marked.length > 1) throw new Error(`${marked.length} lines have the cursor at the same time`);
  if (marked.length === 0) return -1;
  return Number(marked[0].getAttribute("data-line-index"));
}

function unifiedBody(index: number): string {
  const row = unifiedRowNodes().find((node) => node.getAttribute("data-line-index") === String(index));
  if (!row) throw new Error(`line ${index} is not mounted in unified view`);
  return row.querySelector("[data-line-content]")?.textContent ?? "";
}

function cellsOf(row: HTMLElement): HTMLElement[] {
  return Array.from(row.querySelectorAll<HTMLElement>("[data-side]"));
}

function cellOf(row: HTMLElement, side: Side): HTMLElement {
  const found = cellsOf(row).filter((cell) => cell.getAttribute("data-side") === side);
  if (found.length !== 1) {
    throw new Error(
      `row ${row.getAttribute("data-split-row")} has ${found.length} ${side}-side cells`,
    );
  }
  return found[0];
}

/** The column a mark lands on, whether it sits on the cell or inside it. */
function sideCellOf(node: HTMLElement): HTMLElement {
  const cell = node.closest<HTMLElement>("[data-side]");
  if (!cell) throw new Error("a split-diff mark falls outside every [data-side] column");
  return cell;
}

function isGap(cell: HTMLElement): boolean {
  return !cell.hasAttribute("data-line-index") && cell.querySelector("[data-line-index]") === null;
}

function attributeIn(cell: HTMLElement, name: string): string {
  const own = cell.getAttribute(name);
  if (own !== null) return own;
  return cell.querySelector(`[${name}]`)?.getAttribute(name) ?? "";
}

function numberIn(cell: HTMLElement): string {
  const side = cell.getAttribute("data-side");
  const node = cell.querySelector(side === "old" ? "[data-old-no]" : "[data-new-no]");
  return node?.textContent?.trim() ?? "";
}

function bodyIn(cell: HTMLElement): string {
  return cell.querySelector("[data-line-content]")?.textContent ?? "";
}

function markerIn(cell: HTMLElement): string {
  return cell.querySelector("[data-line-marker]")?.textContent?.trim() ?? "";
}

function cursorCell(): HTMLElement {
  const marked = Array.from(
    diffPanel().querySelectorAll<HTMLElement>("[data-split-row] [data-cursor='true']"),
  );
  const cells = [...new Set(marked.map(sideCellOf))];
  if (cells.length !== 1) {
    const where = cells.map((cell) => `${cell.getAttribute("data-side")}@${rowIndexOf(cell)}`);
    throw new Error(`expected one cursor cell, found ${cells.length}: ${where.join(", ")}`);
  }
  return cells[0];
}

function rowNodeOf(cell: HTMLElement): HTMLElement {
  const row = cell.closest<HTMLElement>("[data-split-row]");
  if (!row) throw new Error("a split-diff cell is not inside any row");
  return row;
}

function rowIndexOf(cell: HTMLElement): number {
  return Number(rowNodeOf(cell).getAttribute("data-split-row"));
}

function cursorRow(): number {
  return rowIndexOf(cursorCell());
}

function cursorSide(): string {
  return cursorCell().getAttribute("data-side") ?? "";
}

/** What the heading says the active side is: `SPLIT · NEW side` in the mockup. */
function labelledSide(): string {
  const match = /(OLD|NEW)\s+side/i.exec(headingText());
  if (!match) {
    throw new Error(`the panel 2 header does not say which side is active: "${headingText()}"`);
  }
  return match[1].toLowerCase();
}

function columnHeader(side: Side): HTMLElement {
  const node = diffPanel().querySelector<HTMLElement>(`[data-column="${side}"]`);
  if (!node) throw new Error(`panel 2 has no [data-column="${side}"] column header`);
  return node;
}

function activeColumn(): string {
  const marked = (["old", "new"] as Side[]).filter(
    (side) => columnHeader(side).getAttribute("data-active") === "true",
  );
  if (marked.length !== 1) {
    throw new Error(`expected one active column, found ${marked.length}`);
  }
  return marked[0];
}

/** The three marks of the active side must agree, or `c` anchors where nobody looked. */
function activeSide(): string {
  const side = cursorSide();
  expect(labelledSide()).toBe(side);
  expect(activeColumn()).toBe(side);
  return side;
}

function selectedCells(): HTMLElement[] {
  const marked = Array.from(
    diffPanel().querySelectorAll<HTMLElement>("[data-split-row] [aria-selected='true']"),
  );
  return [...new Set(marked.map(sideCellOf))];
}

// --- comments ----------------------------------------------------------------

function commentEntries(): HTMLElement[] {
  return Array.from(panel("comments").querySelectorAll<HTMLElement>("[data-comment-id]"));
}

function commentSides(): string[] {
  return commentEntries().map((entry) => entry.getAttribute("data-comment-side") ?? "");
}

function commentRanges(): string[] {
  return commentEntries().map(
    (entry) => entry.querySelector("[data-comment-range]")?.textContent?.trim() ?? "",
  );
}

function lastSaved(): Review {
  const calls = saveReview.mock.calls;
  if (calls.length === 0) throw new Error("save_review has not been called yet");
  return calls[calls.length - 1][0];
}

// --- geometry, measured in pixels --------------------------------------------

/** The list is pushed down either by a translateY or by a spacer above it. */
function offsetOf(list: HTMLElement): number {
  const match = /translateY\((-?[\d.]+)px\)/.exec(list.style.transform);
  if (match) return Number(match[1]);
  return (
    Number(list.style.paddingTop.replace("px", "")) || Number(list.style.top.replace("px", "")) || 0
  );
}

/** Where the cursor really sits, in pixels, regardless of what the panel claims. */
function cursorBand(): { top: number; bottom: number } {
  const row = rowNodeOf(cursorCell());
  const rows = Array.from(
    diffPanel().querySelectorAll<HTMLElement>("[data-split-row], [data-hunk-header]"),
  );
  const at = rows.indexOf(row);
  if (at < 0) throw new Error("the cursor row is not mounted");
  const list = row.closest("ul,ol");
  const shift = list instanceof HTMLElement ? offsetOf(list) : 0;
  const top = shift + at * ROW_HEIGHT;
  return { top, bottom: top + ROW_HEIGHT };
}

function expectCursorOnScreen(what: string): void {
  const band = cursorBand();
  const view = viewport();
  const top = view.scrollTop;
  const bottom = top + view.clientHeight;
  expect(
    band.top >= top && band.bottom <= bottom,
    `${what}: el cursor ocupa ${band.top}–${band.bottom}px y la ventana es ${top}–${bottom}px`,
  ).toBe(true);
}

// --- booting and walking ------------------------------------------------------

async function boot(files: FileDiff[] = FILES, reviews: Review[] = []): Promise<UserEvent> {
  configureIpc({ startup: { scope: SCOPE, home: "/home/dev" }, diff: files, reviews });
  render(<App />);
  await screen.findByRole("region", { name: /^1 FILES/ });
  const user = userEvent.setup();
  await user.keyboard("2");
  await act(async () => undefined);
  return user;
}

async function bootSplit(files: FileDiff[] = FILES): Promise<UserEvent> {
  const user = await boot(files);
  await user.keyboard(SPLIT);
  return user;
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

/** Walks down from the top of the file until the cursor row answers `ok`. */
async function walkTo(
  user: UserEvent,
  what: string,
  ok: (row: HTMLElement) => boolean,
  limit = 40,
): Promise<void> {
  await user.keyboard("gg");
  for (let step = 0; step <= limit; step += 1) {
    if (ok(rowNodeOf(cursorCell()))) return;
    await user.keyboard("j");
  }
  throw new Error(`did not reach ${what} in ${limit} presses of j`);
}

function showing(side: Side, number: string): (row: HTMLElement) => boolean {
  return (row) => numberIn(cellOf(row, side)) === number;
}

/** Walks the tree down to a file and opens it, back in panel 2. */
async function openInTree(user: UserEvent, path: string): Promise<void> {
  await user.keyboard("1");
  for (let step = 0; step < 20; step += 1) {
    const rows = Array.from(panel("tree").querySelectorAll<HTMLElement>("[data-path]"));
    const on = rows.find((row) => row.getAttribute("data-cursor") === "true");
    if (on?.getAttribute("data-path") === path) break;
    await user.keyboard("j");
  }
  await user.keyboard("{Enter}2");
  expect(diffPanel()).toHaveTextContent(path);
}

/** Walks the unified view down to a line index. */
async function unifiedTo(user: UserEvent, index: number): Promise<void> {
  await user.keyboard("gg");
  if (index > 0) await user.keyboard("j".repeat(index));
  expect(unifiedCursorIndex()).toBe(index);
}

beforeEach(() => {
  stubLayout(VIEWPORT_HEIGHT);
});

afterEach(() => {
  restoreLayout();
  act(() => reviewStore.open(SCOPE, []));
});

// -----------------------------------------------------------------------------
// TS-36 — Ctrl+w v opens the split, Ctrl+w o closes it, the line is kept
// -----------------------------------------------------------------------------

describe("Ctrl+w v splits the diff into two aligned columns", () => {
  it("TS-36: opens OLD and NEW side by side and Ctrl+w o goes back to unified", async () => {
    const user = await boot();

    expect(splitRowNodes()).toEqual([]);
    expect(unifiedRowNodes()).toHaveLength(12);

    await user.keyboard(SPLIT);

    expect(headingText()).toMatch(/split/i);
    expect(columnHeader("old")).toHaveTextContent(/OLD/);
    expect(columnHeader("new")).toHaveTextContent(/NEW/);
    expect(unifiedRowNodes()).toEqual([]);
    expect(splitRowNodes().length).toBeGreaterThan(0);

    await user.keyboard(ONLY);

    expect(splitRowNodes()).toEqual([]);
    expect(unifiedRowNodes()).toHaveLength(12);
    expect(headingText()).not.toMatch(/split/i);
    expect(headingText()).not.toMatch(/(old|new)\s+side/i);
  });

  it("TS-36: every row carries one cell per side, and the numbers only go down", async () => {
    await bootSplit();

    const olds: number[] = [];
    const news: number[] = [];
    for (const row of splitRowNodes()) {
      if (row.hasAttribute("data-hunk-header")) {
        expect(cellsOf(row)).toEqual([]);
        continue;
      }
      const cells = cellsOf(row);
      expect(cells.map((cell) => cell.getAttribute("data-side"))).toEqual(["old", "new"]);
      const old = cellOf(row, "old");
      const fresh = cellOf(row, "new");
      expect(isGap(old) && isGap(fresh)).toBe(false);
      if (!isGap(old)) olds.push(Number(numberIn(old)));
      if (!isGap(fresh)) news.push(Number(numberIn(fresh)));
    }

    expect(olds).toEqual([33, 34, 35, 36, 37, 98, 99]);
    expect(news).toEqual([33, 34, 35, 36, 37, 38, 39, 100, 101, 102]);
  });

  it("TS-36: shows the deleted line only on the old column and the added one only on the new", async () => {
    const user = await bootSplit();

    await walkTo(user, "la fila de la línea vieja 36", showing("old", "36"));
    const row = rowNodeOf(cursorCell());

    expect(bodyIn(cellOf(row, "old"))).toBe(BODIES[6]);
    expect(attributeIn(cellOf(row, "old"), "data-kind")).toBe("del");
    expect(markerIn(cellOf(row, "old"))).toMatch(/^[-−]$/);
    expect(bodyIn(cellOf(row, "old"))).not.toBe(bodyIn(cellOf(row, "new")));

    const added = splitRowNodes()
      .filter((candidate) => !candidate.hasAttribute("data-hunk-header"))
      .find((candidate) => {
        const cell = cellOf(candidate, "new");
        return !isGap(cell) && numberIn(cell) === "38";
      });
    if (!added) throw new Error("new line 38 is not in any row");
    expect(bodyIn(cellOf(added, "new"))).toBe(BODIES[7]);
    expect(attributeIn(cellOf(added, "new"), "data-kind")).toBe("add");
    expect(markerIn(cellOf(added, "new"))).toBe("+");
  });

  it("TS-36: a file of nothing but additions leaves the whole old column empty", async () => {
    const user = await boot();
    await openInTree(user, TS_PATH);

    await user.keyboard(SPLIT);

    const rows = splitRowNodes().filter((row) => !row.hasAttribute("data-hunk-header"));
    expect(rows).toHaveLength(3);
    expect(rows.map((row) => numberIn(cellOf(row, "new")))).toEqual(["1", "2", "3"]);
    for (const row of rows) {
      expect(isGap(cellOf(row, "old"))).toBe(true);
      expect(bodyIn(cellOf(row, "old"))).toBe("");
    }
  });

  it("TS-36: keeps the same line under the cursor across a context line", async () => {
    const user = await boot();
    // Line 8 sits on row 6 of the split: a cursor that travelled as a number
    // instead of as a line would land two rows further down.
    await unifiedTo(user, 8);

    await user.keyboard(SPLIT);
    expect(bodyIn(cursorCell())).toBe(BODIES[8]);
    expect(numberIn(cursorCell())).toBe("39");

    await user.keyboard(ONLY);
    expect(unifiedCursorIndex()).toBe(8);
    expect(unifiedBody(8)).toBe(BODIES[8]);
  });

  it("TS-36: keeps the same line under the cursor across an added line", async () => {
    const user = await boot();
    await unifiedTo(user, 7);

    await user.keyboard(SPLIT);
    expect(cursorSide()).toBe("new");
    expect(numberIn(cursorCell())).toBe("38");
    expect(bodyIn(cursorCell())).toBe(BODIES[7]);

    await user.keyboard(ONLY);
    expect(unifiedCursorIndex()).toBe(7);
    expect(unifiedBody(7)).toBe(BODIES[7]);
  });

  it("TS-36: keeps the same line under the cursor across a deleted line, which lives on the old side", async () => {
    const user = await boot();
    await unifiedTo(user, 6);
    expect(unifiedBody(6)).toBe(BODIES[6]);

    await user.keyboard(SPLIT);

    // The line only exists on the old column, so that is where the cursor has
    // to be: leaving it on the new one would comment a line nobody chose.
    expect(cursorSide()).toBe("old");
    expect(numberIn(cursorCell())).toBe("36");
    expect(bodyIn(cursorCell())).toBe(BODIES[6]);

    await user.keyboard(ONLY);
    expect(unifiedCursorIndex()).toBe(6);
    expect(unifiedBody(6)).toBe(BODIES[6]);
  });

  it("TS-36: split, unified and split again lands back on the very same row", async () => {
    const user = await bootSplit();
    await walkTo(user, "la fila de la línea nueva 38", showing("new", "38"));
    const row = cursorRow();

    await user.keyboard(ONLY);
    expect(unifiedCursorIndex()).toBe(7);
    expect(unifiedBody(7)).toBe(BODIES[7]);

    await user.keyboard(SPLIT);
    expect(cursorRow()).toBe(row);
    expect(numberIn(cursorCell())).toBe("38");
  });

  it("TS-36: a burst of Ctrl+w v and j walks rows, not the lines of the view it left", async () => {
    const user = await boot();
    await unifiedTo(user, 8);

    // Line 8 is row 6 of the split, so the j of the same task must land on row
    // 7 — the first line of the next hunk. A j answered against the view that
    // was on screen when React last rendered would land a row further down.
    burst(CTRL_W, "v", "j");

    expect(cursorSide()).toBe("new");
    expect(numberIn(cursorCell())).toBe("100");
    expect(bodyIn(cursorCell())).toBe(BODIES[9]);

    // And the whole walk still works from there, six rows to the last one.
    burst("j", "j");
    expect(numberIn(cursorCell())).toBe("102");
    expect(bodyIn(cursorCell())).toBe(BODIES[11]);
  });

  it("TS-36: opening another file keeps the split open, with its own first row", async () => {
    const user = await bootSplit();
    await walkTo(user, "la fila de la línea nueva 38", showing("new", "38"));

    await openInTree(user, TS_PATH);

    expect(headingText()).toMatch(/split/i);
    expect(splitRowNodes().length).toBeGreaterThan(0);
    expect(numberIn(cursorCell())).toBe("1");
  });

  it("TS-36: a file with no hunks says so in split too, and the keys break nothing", async () => {
    const binary: FileDiff = {
      path: "assets/logo.png",
      oldPath: null,
      status: "M",
      additions: 0,
      deletions: 0,
      hunks: [],
    };
    const user = await boot([binary]);

    await user.keyboard(SPLIT);

    expect(splitRowNodes()).toEqual([]);
    expect(diffPanel()).toHaveTextContent(/no lines to display/i);
    expect(headingText()).toMatch(/split/i);

    await user.keyboard("jjkhlv");
    await user.keyboard("{Escape}");
    expect(splitRowNodes()).toEqual([]);
    expect(screen.getByText("NORMAL")).toBeInTheDocument();
  });

  it("TS-36: keeps the cursor on screen while j walks a long split file, measured in pixels", async () => {
    const user = await bootSplit([bigDiff("src/many.ts", 20)]);

    for (let step = 0; step < 40; step += 1) {
      await user.keyboard("j");
      expectCursorOnScreen(`tras ${step + 1} pulsaciones de j`);
    }
  }, 30_000);

  it("TS-36: keeps the cursor on screen on G and on gg, measured in pixels", async () => {
    const user = await bootSplit([bigDiff("src/many.ts", 20)]);

    await user.keyboard("{Shift>}G{/Shift}");
    expectCursorOnScreen("tras G");
    expect(numberIn(cursorCell())).toBe("1905");

    await user.keyboard("gg");
    expectCursorOnScreen("tras gg");
    expect(numberIn(cursorCell())).toBe("1");
  });
});

// -----------------------------------------------------------------------------
// TS-37 — the active side
// -----------------------------------------------------------------------------

describe("the active side is the one h and l choose", () => {
  it("TS-37: opens on the new side and Ctrl+w h / Ctrl+w l move the mark", async () => {
    const user = await boot();
    await unifiedTo(user, 1);
    await user.keyboard(SPLIT);

    expect(activeSide()).toBe("new");
    expect(headingText()).toMatch(/NEW\s+side/i);

    await user.keyboard(WIN_LEFT);
    expect(activeSide()).toBe("old");
    expect(headingText()).toMatch(/OLD\s+side/i);
    expect(columnHeader("old").getAttribute("data-active")).toBe("true");
    expect(columnHeader("new").getAttribute("data-active")).not.toBe("true");

    await user.keyboard(WIN_RIGHT);
    expect(activeSide()).toBe("new");
    expect(columnHeader("new").getAttribute("data-active")).toBe("true");
    expect(columnHeader("old").getAttribute("data-active")).not.toBe("true");
  });

  it("TS-37: a lone h and a lone l do the same as their Ctrl+w version", async () => {
    const user = await boot();
    await unifiedTo(user, 1);
    await user.keyboard(SPLIT);
    const row = cursorRow();

    await user.keyboard("h");
    expect(activeSide()).toBe("old");
    expect(cursorRow()).toBe(row);

    await user.keyboard("l");
    expect(activeSide()).toBe("new");
    expect(cursorRow()).toBe(row);
  });

  it("TS-37: h on the old side leaves everything as it was", async () => {
    const user = await boot();
    await unifiedTo(user, 1);
    await user.keyboard(SPLIT);
    await user.keyboard("h");
    const row = cursorRow();

    await user.keyboard("h");
    await user.keyboard(WIN_LEFT);

    expect(activeSide()).toBe("old");
    expect(cursorRow()).toBe(row);
    expect(numberIn(cursorCell())).toBe("34");
  });

  it("TS-37: j and k move one row and keep the side", async () => {
    const user = await bootSplit();
    await walkTo(user, "la fila de la línea nueva 34", showing("new", "34"));
    await user.keyboard("h");
    const row = cursorRow();
    expect(activeSide()).toBe("old");

    await user.keyboard("j");
    expect(cursorRow()).toBe(row + 1);
    expect(activeSide()).toBe("old");

    await user.keyboard("j");
    expect(cursorRow()).toBe(row + 2);
    expect(activeSide()).toBe("old");

    await user.keyboard("kk");
    expect(cursorRow()).toBe(row);
    expect(activeSide()).toBe("old");
    expect(numberIn(cursorCell())).toBe("34");
  });

  it("TS-37: in the unified view h, l, Ctrl+w h and Ctrl+w l do nothing at all", async () => {
    const user = await boot();
    await unifiedTo(user, 3);

    for (const keys of ["h", "l", WIN_LEFT, WIN_RIGHT]) {
      await user.keyboard(keys);
      expect(unifiedCursorIndex()).toBe(3);
      expect(splitRowNodes()).toEqual([]);
      expect(unifiedRowNodes()).toHaveLength(12);
      expect(headingText()).not.toMatch(/(old|new)\s+side/i);
      expect(screen.getByText("NORMAL")).toBeInTheDocument();
    }

    // Nothing was left behind either: the split opens on the new side, the way
    // it does when no h has ever been pressed. Line 8 is a context line, so it
    // is the state and not the line under the cursor that picks the side.
    await unifiedTo(user, 8);
    await user.keyboard("h");
    await user.keyboard(WIN_LEFT);
    await user.keyboard(SPLIT);
    expect(activeSide()).toBe("new");

    // And they are inert again once the split has been closed.
    await user.keyboard(ONLY);
    await unifiedTo(user, 3);

    for (const keys of ["h", "l", WIN_LEFT, WIN_RIGHT]) {
      await user.keyboard(keys);
      expect(unifiedCursorIndex()).toBe(3);
      expect(splitRowNodes()).toEqual([]);
      expect(headingText()).not.toMatch(/(old|new)\s+side/i);
    }
  });
});

// -----------------------------------------------------------------------------
// TS-38 — v and c work on the active side
// -----------------------------------------------------------------------------

describe("v selects the active side and c anchors the comment to it", () => {
  it("TS-38: the range paints cells of the active side only", async () => {
    const user = await bootSplit();
    await walkTo(user, "la fila de la línea nueva 33", showing("new", "33"));

    await user.keyboard("v");
    await user.keyboard("jj");

    expect(screen.getByText("VISUAL")).toBeInTheDocument();
    expect(selectedCells().map((cell) => cell.getAttribute("data-side"))).toEqual([
      "new",
      "new",
      "new",
    ]);
    expect(selectedCells().map(numberIn)).toEqual(["33", "34", "35"]);
    expect(selectedCells().filter((cell) => cell.getAttribute("data-side") === "old")).toEqual([]);
  });

  it("TS-38: commenting old 36 and new 38 makes two comments told apart by their side", async () => {
    const user = await bootSplit();

    await user.keyboard("h");
    await walkTo(user, "la fila de la línea vieja 36", showing("old", "36"));
    expect(activeSide()).toBe("old");
    await user.keyboard("v");
    await user.keyboard("c");
    await user.keyboard("sobra el flush");
    await user.keyboard("{Control>}{Enter}{/Control}");

    expect(commentSides()).toEqual(["old"]);
    expect(commentRanges()).toEqual(["Line 36"]);

    await user.keyboard("2");
    await user.keyboard("l");
    await walkTo(user, "la fila de la línea nueva 38", showing("new", "38"));
    expect(activeSide()).toBe("new");
    await user.keyboard("v");
    await user.keyboard("c");
    await user.keyboard("este save no valida");
    await user.keyboard("{Control>}{Enter}{/Control}");

    expect(commentSides()).toEqual(["old", "new"]);
    expect(commentRanges()).toEqual(["Line 36", "Line 38"]);
    expect(commentEntries()[0].getAttribute("data-path")).toBe(PHP_PATH);
    expect(commentEntries()[1].getAttribute("data-path")).toBe(PHP_PATH);
  });

  it("TS-38: a range crossing a gap anchors to the lines the active side really has", async () => {
    const user = await bootSplit();
    await user.keyboard("h");
    await walkTo(user, "la primera fila del bloque reescrito", showing("new", "35"));

    // Four rows: the run pairs two deletions against four additions, so the old
    // side has two lines and two gaps, whichever way round they fall.
    await user.keyboard("v");
    await user.keyboard("jjj");
    await user.keyboard("c");
    await user.keyboard("esto ya no hace falta");
    await user.keyboard("{Control>}{Enter}{/Control}");

    expect(commentSides()).toEqual(["old"]);
    expect(commentRanges()).toEqual(["Lines 35-36"]);
  });

  it("TS-38: a burst of Ctrl+w h, v and c anchors to the side the burst chose", async () => {
    const user = await bootSplit();
    await walkTo(user, "la fila de la línea vieja 35", showing("old", "35"));
    expect(activeSide()).toBe("new");

    burst(CTRL_W, "h", "v", "c");

    await user.keyboard("el persist se va");
    await user.keyboard("{Control>}{Enter}{/Control}");

    expect(commentSides()).toEqual(["old"]);
    expect(commentRanges()).toEqual(["Line 35"]);
  });
});

// -----------------------------------------------------------------------------
// TS-39 — the chosen view is part of the review
// -----------------------------------------------------------------------------

describe("the chosen view is saved with the review", () => {
  function storedReview(view: DiffView, comments: Comment[] = []): Review {
    return { scope: SCOPE, comments, view };
  }

  it("TS-39: choosing the split view reaches the state file, and so does going back", async () => {
    const user = await boot();

    await user.keyboard(SPLIT);
    await waitFor(() => expect(lastSaved().view).toBe("split"));
    expect(lastSaved().scope).toEqual(SCOPE);

    await user.keyboard(ONLY);
    await waitFor(() => expect(lastSaved().view).toBe("unified"));
  });

  it("TS-39: reopening the same scope opens in the view that was saved", async () => {
    await boot(FILES, [storedReview("split")]);

    expect(splitRowNodes().length).toBeGreaterThan(0);
    expect(headingText()).toMatch(/split/i);
    expect(unifiedRowNodes()).toEqual([]);

    cleanup();
    act(() => reviewStore.open(SCOPE, []));

    await boot(FILES, [storedReview("unified")]);

    expect(splitRowNodes()).toEqual([]);
    expect(unifiedRowNodes()).toHaveLength(12);
    expect(headingText()).not.toMatch(/(old|new)\s+side/i);
  });

  it("TS-39: resuming a review saved in split brings the split back", async () => {
    const saved: Comment[] = [
      { id: "c1", path: PHP_PATH, side: "old", from: 36, to: 36, text: "sobra el flush" },
    ];
    configureIpc({
      startup: { scope: SCOPE, home: "/home/dev" },
      diff: FILES,
      reviews: [storedReview("split", saved)],
    });
    render(<App />);
    const user = userEvent.setup();
    await screen.findByText(/resume/i);

    await user.keyboard("{Enter}");
    await screen.findByRole("region", { name: /^1 FILES/ });

    expect(splitRowNodes().length).toBeGreaterThan(0);
    expect(headingText()).toMatch(/split/i);
    expect(commentSides()).toEqual(["old"]);
  });
});

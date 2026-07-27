/**
 * Half a page in the split view. `pageSize` changed meaning with the split —
 * lines per page in unified, rows per page here — and half of it is the only
 * movement whose step depends on what the viewport can hold, so it is measured
 * against the rows that really fit and against pixels, not against what the
 * panel says about itself.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { UserEvent } from "@testing-library/user-event";
import type { FileDiff, Scope } from "@/ipc/types";
import { panel } from "../keys/helpers";
import { restoreLayout, ROW_HEIGHT, stubLayout, VIEWPORT_HEIGHT } from "../helpers/diff-layout";

vi.mock("@/ipc/client", () => import("../helpers/ipc-mock"));

import App from "@/App";
import { configureIpc } from "../helpers/ipc-mock";
import { reviewStore } from "@/state/review";

const SCOPE: Scope = { kind: "worktree", repo: "/home/dev/reviewv4" };
const PATH = "src/many.ts";

const SPLIT = "{Control>}w{/Control}v";
const CTRL_D = "{Control>}d{/Control}";
const CTRL_U = "{Control>}u{/Control}";

const CTRL_W_KEY: KeyboardEventInit = { key: "w", ctrlKey: true };
const CTRL_D_KEY: KeyboardEventInit = { key: "d", ctrlKey: true };

/**
 * Two deletions against three additions per hunk: the run leaves a gap, so the
 * rows of the split and the lines of the unified view never agree, and neither
 * do the rows of a hunk and the items the cursor walks.
 */
function bigDiff(hunks: number): FileDiff {
  return {
    path: PATH,
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
          { kind: "context" as const, oldNo: start, newNo: start, content: `h${h} contexto` },
          { kind: "del" as const, oldNo: start + 1, newNo: null, content: `h${h} borrada 1` },
          { kind: "del" as const, oldNo: start + 2, newNo: null, content: `h${h} borrada 2` },
          { kind: "add" as const, oldNo: null, newNo: start + 1, content: `h${h} añadida 1` },
          { kind: "add" as const, oldNo: null, newNo: start + 2, content: `h${h} añadida 2` },
          { kind: "add" as const, oldNo: null, newNo: start + 3, content: `h${h} añadida 3` },
          {
            kind: "context" as const,
            oldNo: start + 3,
            newNo: start + 4,
            content: `h${h} cierre`,
          },
        ],
      };
    }),
  };
}

/**
 * One deletion against one addition per hunk: the split pairs them into a
 * single row, so the same viewport holds noticeably fewer items in split than
 * in unified and half a page is a different number on each view.
 */
function pairedDiff(hunks: number): FileDiff {
  return {
    path: PATH,
    oldPath: null,
    status: "M",
    additions: hunks,
    deletions: hunks,
    hunks: Array.from({ length: hunks }, (_, h) => {
      const start = h * 100 + 1;
      return {
        header: `@@ -${start},1 +${start},1 @@ bloque ${h}`,
        oldStart: start,
        oldLines: 1,
        newStart: start,
        newLines: 1,
        lines: [
          { kind: "del" as const, oldNo: start, newNo: null, content: `h${h} borrada` },
          { kind: "add" as const, oldNo: null, newNo: start, content: `h${h} añadida` },
        ],
      };
    }),
  };
}

function diffPanel(): HTMLElement {
  return panel("diff");
}

function viewport(): HTMLElement {
  const node = diffPanel().querySelector<HTMLElement>("[data-diff-viewport]");
  if (!node) throw new Error("el panel 2 no expone ningún [data-diff-viewport]");
  return node;
}

/** The item the cursor is on, as the heading of the panel counts them: `fila N de M`. */
function cursorItem(): number {
  const text = diffPanel().querySelector("[class~='diff-position']")?.textContent ?? "";
  const match = /fila\s+(\d+)\s+de\s+(\d+)/i.exec(text);
  if (!match) throw new Error(`la cabecera del panel 2 no dice en qué fila está: «${text}»`);
  return Number(match[1]);
}

function rowNodes(): HTMLElement[] {
  return Array.from(diffPanel().querySelectorAll<HTMLElement>("[data-split-row]"));
}

/** The list is pushed down either by a translateY or by a spacer above it. */
function offsetOf(list: HTMLElement): number {
  const match = /translateY\((-?[\d.]+)px\)/.exec(list.style.transform);
  if (match) return Number(match[1]);
  return (
    Number(list.style.paddingTop.replace("px", "")) || Number(list.style.top.replace("px", "")) || 0
  );
}

function bandOf(row: HTMLElement): { top: number; bottom: number } {
  const rows = rowNodes();
  const at = rows.indexOf(row);
  if (at < 0) throw new Error("la fila no está montada");
  const list = row.closest("ul,ol");
  const shift = list instanceof HTMLElement ? offsetOf(list) : 0;
  const top = shift + at * ROW_HEIGHT;
  return { top, bottom: top + ROW_HEIGHT };
}

function onScreen(row: HTMLElement): boolean {
  const band = bandOf(row);
  const view = viewport();
  return band.top >= view.scrollTop && band.bottom <= view.scrollTop + view.clientHeight;
}

function cursorRow(): HTMLElement {
  const marked = diffPanel().querySelector<HTMLElement>("[data-split-row] [data-cursor='true']");
  const row = marked?.closest<HTMLElement>("[data-split-row]");
  if (!row) throw new Error("ninguna fila del diff partido lleva el cursor");
  return row;
}

function expectCursorOnScreen(what: string): void {
  const band = bandOf(cursorRow());
  const view = viewport();
  const top = view.scrollTop;
  const bottom = top + view.clientHeight;
  expect(
    onScreen(cursorRow()),
    `${what}: el cursor ocupa ${band.top}–${band.bottom}px y la ventana es ${top}–${bottom}px`,
  ).toBe(true);
}

/**
 * Items the reader can really see, counted off the pixels: a hunk header takes
 * a row of the window without giving the cursor anywhere to stand.
 */
function itemsOnScreen(): number {
  return rowNodes().filter((row) => !row.hasAttribute("data-hunk-header") && onScreen(row)).length;
}

async function boot(file: FileDiff): Promise<UserEvent> {
  configureIpc({ startup: { scope: SCOPE, home: "/home/dev" }, diff: [file], blobs: {} });
  render(<App />);
  await screen.findByRole("region", { name: /^1 ÁRBOL/ });
  const user = userEvent.setup();
  await user.keyboard("2");
  await act(async () => undefined);
  return user;
}

async function bootSplit(file: FileDiff): Promise<UserEvent> {
  const user = await boot(file);
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

beforeEach(() => {
  stubLayout(VIEWPORT_HEIGHT);
});

afterEach(() => {
  restoreLayout();
  act(() => reviewStore.open(SCOPE, []));
});

describe("Ctrl+d and Ctrl+u move half a page of the split", () => {
  // A file whose hunks pair one deletion with one addition: the split fits far
  // fewer items in the viewport than the unified view does, so a step measured
  // against the wrong view is a different number of rows.
  it("steps as many rows as half of what the viewport really holds", async () => {
    const user = await bootSplit(pairedDiff(40));
    await user.keyboard("gg");

    const fits = itemsOnScreen();
    expect(fits).toBeGreaterThan(2);
    const from = cursorItem();

    await user.keyboard(CTRL_D);
    expect(cursorItem() - from).toBe(Math.floor(fits / 2));

    await user.keyboard(CTRL_U);
    expect(cursorItem()).toBe(from);
  });

  it("keeps the cursor on screen down the whole file and back up, measured in pixels", async () => {
    const user = await bootSplit(bigDiff(20));
    await user.keyboard("gg");

    for (let step = 0; step < 15; step += 1) {
      await user.keyboard(CTRL_D);
      expectCursorOnScreen(`tras ${step + 1} Ctrl+d`);
    }

    for (let step = 0; step < 15; step += 1) {
      await user.keyboard(CTRL_U);
      expectCursorOnScreen(`tras ${step + 1} Ctrl+u`);
    }
    expect(cursorItem()).toBe(1);
  }, 30_000);

  it("stops at the last item instead of walking off the end", async () => {
    const user = await bootSplit(bigDiff(3));
    await user.keyboard("{Shift>}G{/Shift}");
    const last = cursorItem();

    await user.keyboard(CTRL_D);

    expect(cursorItem()).toBe(last);
    expectCursorOnScreen("tras Ctrl+d en el final");
  });
});

describe("the page a burst reads is the one of the view the burst opened", () => {
  it("takes Ctrl+d in the same task as Ctrl+w v as far as it takes it settled", async () => {
    const user = await boot(pairedDiff(40));
    await user.keyboard("gg");
    await user.keyboard(SPLIT);
    await user.keyboard(CTRL_D);
    const settled = cursorItem();

    await user.keyboard("{Control>}w{/Control}o");
    await user.keyboard("gg");
    burst(CTRL_W_KEY, "v", CTRL_D_KEY);

    // The unified view of this file fits more lines in the viewport than the
    // split fits rows, so half a page of the view that just closed is a longer
    // step than the one the reader asked for.
    expect(cursorItem()).toBe(settled);
  });
});

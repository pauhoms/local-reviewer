import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { UserEvent } from "@testing-library/user-event";
import type { FileDiff, Line, Scope } from "@/ipc/types";
import { panel } from "../keys/helpers";
import { resizeViewport, restoreLayout, ROW_HEIGHT, stubLayout } from "../helpers/diff-layout";

vi.mock("@/ipc/client", () => import("../helpers/ipc-mock"));

import App from "@/App";
import { configureIpc } from "../helpers/ipc-mock";
import { reviewStore } from "@/state/review";

const SCOPE: Scope = { kind: "worktree", repo: "/home/dev/local-reviewer" };

/**
 * Many small hunks, which is what a real review looks like and what the
 * single-hunk fixtures never exercise: every header takes a row without taking
 * a line, so a window measured in rows and filled with lines overflows.
 */
function manyHunks(path: string, hunks: number, linesPerHunk: number): FileDiff {
  return {
    path,
    oldPath: null,
    status: "M",
    additions: hunks * linesPerHunk,
    deletions: 0,
    hunks: Array.from({ length: hunks }, (_, h) => {
      const start = h * 100 + 1;
      const lines: Line[] = Array.from({ length: linesPerHunk }, (_, i) => ({
        kind: "add",
        oldNo: null,
        newNo: start + i,
        content: `h${h} line ${i}`,
      }));
      return {
        header: `@@ -${start},0 +${start},${linesPerHunk} @@`,
        oldStart: start,
        oldLines: 0,
        newStart: start,
        newLines: linesPerHunk,
        lines,
      };
    }),
  };
}

async function boot(file: FileDiff): Promise<UserEvent> {
  configureIpc({ startup: { scope: SCOPE, home: "/home/dev" }, diff: [file], blobs: {} });
  render(<App />);
  await screen.findByRole("region", { name: /^1 FILES/ });
  const user = userEvent.setup();
  await user.keyboard("2");
  await act(async () => undefined);
  return user;
}

function viewport(): HTMLElement {
  const node = panel("diff").querySelector("[data-diff-viewport]");
  if (!(node instanceof HTMLElement)) throw new Error("there is no [data-diff-viewport]");
  return node;
}

/** Where the cursor really sits, in pixels, regardless of what the panel claims. */
function cursorBand(): { top: number; bottom: number } {
  const node = panel("diff").querySelector("[data-cursor='true']");
  if (!(node instanceof HTMLElement)) throw new Error("there is no row with data-cursor");
  const rows = Array.from(panel("diff").querySelectorAll("[data-line-index],[data-hunk-header]"));
  const row = rows.indexOf(node);
  if (row < 0) throw new Error("the cursor row is not mounted");
  const list = node.closest("ul,ol");
  const shift = list instanceof HTMLElement ? offsetOf(list) : 0;
  const top = shift + row * ROW_HEIGHT;
  return { top, bottom: top + ROW_HEIGHT };
}

/** The list is pushed down either by a translateY or by a spacer above it. */
function offsetOf(list: HTMLElement): number {
  const match = /translateY\((-?[\d.]+)px\)/.exec(list.style.transform);
  if (match) return Number(match[1]);
  return Number(list.style.paddingTop.replace("px", "")) || Number(list.style.top.replace("px", "")) || 0;
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

beforeEach(() => stubLayout());

afterEach(() => {
  restoreLayout();
  act(() => reviewStore.open(SCOPE, []));
});

describe("the diff keeps the cursor on screen, measured in pixels", () => {
  // Forty keystrokes with a geometry assertion each: half a second when the
  // machine is idle, well past the default budget when it is not.
  it("holds it there while walking down a file of many hunks", async () => {
    const user = await boot(manyHunks("src/many.ts", 20, 3));

    for (let step = 0; step < 40; step += 1) {
      await user.keyboard("j");
      expectCursorOnScreen(`tras ${step + 1} pulsaciones de j`);
    }
  }, 30_000);

  it("holds it there on G, on gg and after half a page", async () => {
    const user = await boot(manyHunks("src/many.ts", 20, 3));

    await user.keyboard("{Shift>}G{/Shift}");
    expectCursorOnScreen("tras G");

    await user.keyboard("gg");
    expectCursorOnScreen("tras gg");

    await user.keyboard("");
    await user.keyboard("{Control>}d{/Control}");
    expectCursorOnScreen("tras Ctrl+d");

    await user.keyboard("{Control>}d{/Control}");
    expectCursorOnScreen("tras dos Ctrl+d");
  });

  it("holds it there in a single hunk too, right at the bottom edge", async () => {
    const user = await boot(manyHunks("src/one.ts", 1, 200));

    for (let step = 0; step < 25; step += 1) {
      await user.keyboard("j");
      expectCursorOnScreen(`tras ${step + 1} pulsaciones de j`);
    }
  });

  it("holds it there after the viewport shrinks under it", async () => {
    const user = await boot(manyHunks("src/many.ts", 20, 3));

    await user.keyboard("{Shift>}G{/Shift}");
    act(() => resizeViewport(ROW_HEIGHT * 4));
    await act(async () => undefined);

    expectCursorOnScreen("tras encoger el viewport");
  });
});

describe("the window the panel publishes", () => {
  it("names only lines that are really on screen", async () => {
    const user = await boot(manyHunks("src/many.ts", 20, 3));
    await user.keyboard("{Shift>}G{/Shift}");

    const view = viewport();
    const last = Number(view.getAttribute("data-last-visible"));
    const node = panel("diff").querySelector(`[data-line-index='${last}']`);
    expect(node, `line ${last} claims to be visible but is not mounted`).not.toBeNull();

    const rows = Array.from(panel("diff").querySelectorAll("[data-line-index],[data-hunk-header]"));
    const list = node instanceof HTMLElement ? node.closest("ul,ol") : null;
    const shift = list instanceof HTMLElement ? offsetOf(list) : 0;
    const top = shift + rows.indexOf(node as Element) * ROW_HEIGHT;

    expect(
      top + ROW_HEIGHT <= view.scrollTop + view.clientHeight,
      `data-last-visible says ${last}, but that line ends at ${top + ROW_HEIGHT}px and the viewport at ${view.scrollTop + view.clientHeight}px`,
    ).toBe(true);
  });
});

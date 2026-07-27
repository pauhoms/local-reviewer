/**
 * The colours of the split view. Both columns show the same context line, but
 * each one comes out of a different file: a comment opened only in the new blob
 * greys the line there and leaves it live code on the old side, which is the
 * very comparison the split is for.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { UserEvent } from "@testing-library/user-event";
import type { FileDiff, Line, Scope } from "@/ipc/types";
import { panel } from "../keys/helpers";
import { restoreLayout, stubLayout, VIEWPORT_HEIGHT } from "../helpers/diff-layout";

vi.mock("@/ipc/client", () => import("../helpers/ipc-mock"));

import App from "@/App";
import { configureIpc } from "../helpers/ipc-mock";
import { reviewStore } from "@/state/review";

const SCOPE: Scope = { kind: "worktree", repo: "/home/dev/local-reviewer" };
const PATH = "src/switch.ts";

const SPLIT = "{Control>}w{/Control}v";

const LIVE = "const x = 2;";

/**
 * The new file wraps the last line in a block comment the old one never had, so
 * every grammar-aware reader gives the two blobs different colours for `LIVE`.
 */
const OLD_BLOB = ["const a = 1;", LIVE].join("\n");
const NEW_BLOB = ["const a = 1;", "/* apagado", LIVE, "*/"].join("\n");

function context(oldNo: number, newNo: number, content: string): Line {
  return { kind: "context", oldNo, newNo, content };
}

function add(newNo: number, content: string): Line {
  return { kind: "add", oldNo: null, newNo, content };
}

const FILE: FileDiff = {
  path: PATH,
  oldPath: null,
  status: "M",
  additions: 2,
  deletions: 0,
  hunks: [
    {
      header: "@@ -1,2 +1,4 @@",
      oldStart: 1,
      oldLines: 2,
      newStart: 1,
      newLines: 4,
      lines: [
        context(1, 1, "const a = 1;"),
        add(2, "/* apagado"),
        context(2, 3, LIVE),
        add(4, "*/"),
      ],
    },
  ],
};

function diffPanel(): HTMLElement {
  return panel("diff");
}

function rowShowing(body: string): HTMLElement {
  const rows = Array.from(diffPanel().querySelectorAll<HTMLElement>("[data-split-row]"));
  const row = rows.find((candidate) =>
    Array.from(candidate.querySelectorAll("[data-line-content]")).some(
      (content) => content.textContent === body,
    ),
  );
  if (!row) throw new Error(`no split-diff row shows "${body}"`);
  return row;
}

function cellOf(row: HTMLElement, side: "old" | "new"): HTMLElement {
  const cell = row.querySelector<HTMLElement>(`[data-side="${side}"]`);
  if (!cell) throw new Error(`the row has no ${side}-side cell`);
  return cell;
}

function coloursIn(cell: HTMLElement): string[] {
  return Array.from(cell.querySelectorAll<HTMLElement>("[data-line-content] [style]"))
    .map((node) => node.style.color)
    .filter((colour) => colour !== "");
}

async function bootSplit(blobs: Record<string, string>): Promise<UserEvent> {
  configureIpc({ startup: { scope: SCOPE, home: "/home/dev" }, diff: [FILE], blobs });
  render(<App />);
  await screen.findByRole("region", { name: /^1 FILES/ });
  const user = userEvent.setup();
  await user.keyboard("2");
  await act(async () => undefined);
  await user.keyboard(SPLIT);
  return user;
}

beforeEach(() => {
  stubLayout(VIEWPORT_HEIGHT);
});

afterEach(() => {
  restoreLayout();
  act(() => reviewStore.open(SCOPE, []));
});

const BOTH_BLOBS = { [`old:${PATH}`]: OLD_BLOB, [`new:${PATH}`]: NEW_BLOB };

async function colouredRow(blobs: Record<string, string>, body: string): Promise<HTMLElement> {
  await bootSplit(blobs);
  await waitFor(() => expect(coloursIn(cellOf(rowShowing(body), "new")).length).toBeGreaterThan(0));
  return rowShowing(body);
}

describe("each column of the split takes its colours from its own blob", () => {
  it("leaves the old column reading as live code while the new one is commented out", async () => {
    const row = await colouredRow(BOTH_BLOBS, LIVE);
    const old = coloursIn(cellOf(row, "old"));
    const fresh = coloursIn(cellOf(row, "new"));

    // The whole line is one comment in the new file and several things in the
    // old one: a keyword, a name and a number cannot share a single colour.
    expect(new Set(fresh).size).toBe(1);
    expect(new Set(old).size).toBeGreaterThan(1);
    expect(old).not.toEqual(fresh);
  });

  it("borrows the other blob for a column whose own file said nothing", async () => {
    const row = await colouredRow({ [`new:${PATH}`]: NEW_BLOB }, LIVE);

    // The body is the same string on both columns, so the new file's colours
    // are still better than none at all.
    expect(coloursIn(cellOf(row, "old"))).toEqual(coloursIn(cellOf(row, "new")));
    expect(coloursIn(cellOf(row, "old")).length).toBeGreaterThan(0);
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, within } from "@testing-library/react";
import type { FileDiff, Scope } from "@/ipc/types";
import { panel } from "../keys/helpers";

vi.mock("@/ipc/client", () => import("../helpers/ipc-mock"));

import App from "@/App";
import { configureIpc } from "../helpers/ipc-mock";
import { reviewStore } from "@/state/review";

const SCOPE: Scope = { kind: "worktree", repo: "/home/dev/reviewv4" };

function fileDiff(path: string): FileDiff {
  return { path, oldPath: null, status: "M", additions: 1, deletions: 0, hunks: [] };
}

const FILES: FileDiff[] = [
  fileDiff("src/a/x.ts"),
  fileDiff("src/a/y.ts"),
  fileDiff("src/a/z.ts"),
  fileDiff("src/b.ts"),
  fileDiff("w.md"),
];

async function boot(): Promise<void> {
  configureIpc({ startup: { scope: SCOPE, home: "/home/dev" }, diff: FILES });
  render(<App />);
  await screen.findByRole("region", { name: /^1 ÁRBOL/ });
  // The store is a singleton: an IPC promise still in flight from an earlier
  // test would land mid-burst and reopen the review, resetting the cursor.
  await act(async () => undefined);
}

/** Fails where the state went wrong, not three keys later. */
function expectCursorOn(path: string): void {
  expect(cursorPath()).toBe(path);
}

/**
 * One task for the whole burst — no await between keys. That is the shape a key
 * repeat takes, and the shape that used to reduce against the previous render.
 */
function burst(...keys: string[]): void {
  act(() => {
    for (const key of keys) {
      document.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
    }
  });
}

function rows(): HTMLElement[] {
  return within(panel("tree")).getAllByRole("option");
}

function paths(): (string | null)[] {
  return rows().map((row) => row.getAttribute("data-path"));
}

function cursorPath(): string | null {
  const row = rows().find((item) => item.getAttribute("aria-selected") === "true");
  return row?.getAttribute("data-path") ?? null;
}

afterEach(() => {
  reviewStore.open(SCOPE, []);
});

describe("keys that arrive faster than React can flush", () => {
  it("walks up to the parent on the second h instead of folding twice", async () => {
    await boot();
    expectCursorOn("src");
    burst("j");
    expectCursorOn("src/a");

    burst("h", "h");

    expect(paths()).toEqual(["src", "src/a", "src/b.ts", "w.md"]);
    expect(cursorPath()).toBe("src");
  });

  it("opens the file the cursor really landed on", async () => {
    await boot();
    expectCursorOn("src");
    burst("j");
    expectCursorOn("src/a");

    burst("h", "j", "j", "Enter");

    expect(cursorPath()).toBe("w.md");
    expect(reviewStore.getState().selectedPath).toBe("w.md");
  });

  it("never leaves the cursor on one row while the diff shows another file", async () => {
    await boot();
    expectCursorOn("src");
    burst("j");
    expectCursorOn("src/a");

    burst("h", "l", "j", "Enter");

    expect(cursorPath()).toBe("src/a/x.ts");
    expect(reviewStore.getState().selectedPath).toBe("src/a/x.ts");
  });
});

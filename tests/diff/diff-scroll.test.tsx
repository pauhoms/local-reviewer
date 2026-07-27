import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { FileDiff, Scope } from "@/ipc/types";
import { panel } from "../keys/helpers";
import { restoreLayout, ROW_HEIGHT, stubLayout } from "../helpers/diff-layout";

vi.mock("@/ipc/client", () => import("../helpers/ipc-mock"));

import App from "@/App";
import { configureIpc } from "../helpers/ipc-mock";
import { reviewStore } from "@/state/review";

const SCOPE: Scope = { kind: "worktree", repo: "/home/dev/local-reviewer" };

const LINES = 200;

const bigFile: FileDiff = {
  path: "src/big.ts",
  oldPath: null,
  status: "A",
  additions: LINES,
  deletions: 0,
  hunks: [
    {
      header: `@@ -0,0 +1,${LINES} @@`,
      oldStart: 0,
      oldLines: 0,
      newStart: 1,
      newLines: LINES,
      lines: Array.from({ length: LINES }, (_, index) => ({
        kind: "add" as const,
        oldNo: null,
        newNo: index + 1,
        content: `const l${index} = ${index};`,
      })),
    },
  ],
};

function viewport(): HTMLElement {
  const node = panel("diff").querySelector<HTMLElement>("[data-diff-viewport]");
  if (!node) throw new Error("panel 2 does not expose [data-diff-viewport]");
  return node;
}

function mountedIndexes(): number[] {
  return Array.from(panel("diff").querySelectorAll<HTMLElement>("[data-line-index]")).map((row) =>
    Number(row.getAttribute("data-line-index")),
  );
}

function firstVisible(): number {
  return Number(viewport().getAttribute("data-first-visible"));
}

/** The wheel: jsdom fires no scroll on its own, so the test plays the browser. */
function scrollToRow(row: number): void {
  const node = viewport();
  node.scrollTop = row * ROW_HEIGHT;
  fireEvent.scroll(node);
}

async function boot(): Promise<void> {
  configureIpc({ startup: { scope: SCOPE, home: "/home/dev" }, diff: [bigFile] });
  render(<App />);
  await screen.findByRole("region", { name: /^1 FILES/ });
  const user = userEvent.setup();
  await user.keyboard("2");
  await act(async () => undefined);
}

beforeEach(() => {
  stubLayout();
});

afterEach(() => {
  restoreLayout();
  act(() => reviewStore.open(SCOPE, []));
});

describe("the wheel moves the window as far as the cursor allows", () => {
  it("mounts the lines the scroll brought on screen", async () => {
    await boot();
    const user = userEvent.setup();
    for (let page = 0; page < 5; page += 1) {
      await user.keyboard("{Control>}d{/Control}");
    }

    // Row 41 holds line 40: the hunk header takes the first row of the list.
    act(() => scrollToRow(41));

    expect(firstVisible()).toBe(40);
    expect(mountedIndexes()).toContain(40);
    expect(mountedIndexes()).not.toContain(0);
  });

  it("snaps back to the cursor when the scroll leaves it behind", async () => {
    await boot();

    act(() => scrollToRow(150));

    expect(firstVisible()).toBe(0);
    expect(mountedIndexes()).toContain(0);
    // The rows went back to the top, so the viewport has to go with them.
    expect(viewport().scrollTop).toBe(0);
  });
});

describe("the keyboard keeps the diff cursor on screen", () => {
  it("uses the rendered row geometry instead of trusting the virtual window alone", async () => {
    await boot();
    const user = userEvent.setup();
    const secondLine = panel("diff").querySelector<HTMLElement>('[data-line-index="1"]');
    if (!secondLine) throw new Error("the second diff line is not mounted");

    vi.spyOn(viewport(), "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 800, 48));
    vi.spyOn(secondLine, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 48, 800, 24));

    await user.keyboard("j");

    expect(secondLine).toHaveAttribute("data-cursor", "true");
    expect(viewport().scrollTop).toBe(24);
  });

  it("scrolls down with j and returns to the top with k", async () => {
    await boot();
    const user = userEvent.setup();

    await user.keyboard("j".repeat(30));

    expect(firstVisible()).toBeGreaterThan(0);
    expect(viewport().scrollTop).toBeGreaterThan(0);
    expect(
      panel("diff").querySelector('[data-line-index="30"][data-cursor="true"]'),
    ).toBeInTheDocument();

    await user.keyboard("k".repeat(30));

    expect(firstVisible()).toBe(0);
    expect(viewport().scrollTop).toBe(0);
    expect(
      panel("diff").querySelector('[data-line-index="0"][data-cursor="true"]'),
    ).toBeInTheDocument();
  });
});

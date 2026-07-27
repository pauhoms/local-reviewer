import { describe, it, expect, beforeEach, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "@/App";
import { configureIpc } from "../helpers/ipc-mock";
import { sampleFiles } from "../helpers/fixtures";
import { reviewStore } from "@/state/review";
import { headIndex, panel, selectedIndexes } from "./helpers";

interface SeenKey {
  key: string;
  prevented: boolean;
}

function watchCtrlKeys(): { seen: SeenKey[]; stop: () => void } {
  const seen: SeenKey[] = [];
  const spy = (event: KeyboardEvent) => {
    if (event.ctrlKey && event.key !== "Control") {
      seen.push({ key: event.key, prevented: event.defaultPrevented });
    }
  };
  window.addEventListener("keydown", spy);
  return { seen, stop: () => window.removeEventListener("keydown", spy) };
}

vi.mock("@/ipc/client", () => import("../helpers/ipc-mock"));

const SCOPE = { kind: "worktree", repo: "/repo" } as const;

beforeEach(() => {
  configureIpc({
    startup: { scope: SCOPE, home: "/home/dev" },
    diff: sampleFiles,
  });
});

// The shell only exists once a scope resolved, and that resolution is async
// since phase 3 routes App through get_startup.
/** Panel 3 shows its empty state with no comments, so the walkable list the
 *  phase-2 shell asserts on only exists once the review has some. */
function seedComments(): void {
  act(() => {
    reviewStore.restoreComments([
      { id: "s1", path: "src/order/Order.ts", side: "new", from: 1, to: 2, text: "uno" },
      { id: "s2", path: "src/order/Order.ts", side: "new", from: 3, to: 3, text: "dos" },
      { id: "s3", path: "src/UserService.php", side: "new", from: 5, to: 6, text: "tres" },
    ]);
  });
}

async function renderShell(): Promise<void> {
  render(<App />);
  await screen.findByRole("region", { name: /^1 ÁRBOL/ });
  seedComments();
}

describe("the shell shows the visual range", () => {
  it("marks every line between the anchor and the head", async () => {
    await renderShell();
    const user = userEvent.setup();

    await user.keyboard("2");
    expect(selectedIndexes("diff")).toEqual([0]);

    await user.keyboard("vjj");
    expect(selectedIndexes("diff")).toEqual([0, 1, 2]);
    expect(headIndex("diff")).toBe(2);
  });

  it("marks the range the same way when it grows upwards", async () => {
    await renderShell();
    const user = userEvent.setup();

    // The anchor sits mid-list and the head ends up above it, which is what
    // tells this apart from growing downwards. The indexes shrank when panel 2
    // stopped being a placeholder list and became the real diff.
    await user.keyboard("2jvk");
    expect(selectedIndexes("diff")).toEqual([0, 1]);
    expect(headIndex("diff")).toBe(0);
  });

  it("drops the range on Esc and leaves the cursor alone", async () => {
    await renderShell();
    const user = userEvent.setup();

    await user.keyboard("2vjj");
    await user.keyboard("{Escape}");

    expect(selectedIndexes("diff")).toEqual([2]);
  });

  it("does not paint a range over a panel that is not the active one", async () => {
    await renderShell();
    const user = userEvent.setup();

    await user.keyboard("2vjj");
    expect(selectedIndexes("comments")).toEqual([0]);
  });
});

describe("the shell talks to assistive tech", () => {
  it("marks the active panel with aria-current, not only with a CSS hook", async () => {
    await renderShell();
    const user = userEvent.setup();

    expect(panel("tree")).toHaveAttribute("aria-current", "true");

    await user.keyboard("2");
    expect(panel("diff")).toHaveAttribute("aria-current", "true");
    expect(panel("tree")).not.toHaveAttribute("aria-current", "true");
  });

  it("announces the mode through a live region", async () => {
    await renderShell();
    const user = userEvent.setup();

    expect(screen.getByText("NORMAL")).toHaveAttribute("aria-live", "polite");

    await user.keyboard("2v");
    expect(screen.getByText("VISUAL")).toHaveAttribute("aria-live", "polite");
  });
});

describe("the shell only takes the keys it answers", () => {
  it("leaves Ctrl+d and Ctrl+u alone in a panel with no half page binding", async () => {
    await renderShell();
    const user = userEvent.setup();
    await user.keyboard("1");

    const watch = watchCtrlKeys();
    try {
      await user.keyboard("{Control>}d{/Control}");
      await user.keyboard("{Control>}u{/Control}");
    } finally {
      watch.stop();
    }

    expect(watch.seen).toEqual([
      { key: "d", prevented: false },
      { key: "u", prevented: false },
    ]);
  });
});

describe("the shell in insert mode", () => {
  it("shows INSERT after creating a comment from visual", async () => {
    await renderShell();
    const user = userEvent.setup();

    await user.keyboard("2vjc");
    expect(screen.getByText("INSERT")).toBeInTheDocument();
    expect(screen.queryByText("VISUAL")).toBeNull();
    expect(screen.queryByText("NORMAL")).toBeNull();

    await user.keyboard("{Escape}");
    expect(screen.getByText("NORMAL")).toBeInTheDocument();
  });

  it("leaves Ctrl+d and Ctrl+u to the editor while insert is on", async () => {
    await renderShell();
    const user = userEvent.setup();
    await user.keyboard("2vjc");

    const watch = watchCtrlKeys();
    try {
      await user.keyboard("{Control>}d{/Control}");
      await user.keyboard("{Control>}u{/Control}");
    } finally {
      watch.stop();
    }

    expect(watch.seen).toEqual([
      { key: "d", prevented: false },
      { key: "u", prevented: false },
    ]);
  });

  it("takes Ctrl+d back as soon as Esc returns to normal", async () => {
    await renderShell();
    const user = userEvent.setup();
    await user.keyboard("2vjc");
    await user.keyboard("{Escape}");

    const watch = watchCtrlKeys();
    try {
      await user.keyboard("{Control>}d{/Control}");
    } finally {
      watch.stop();
    }

    expect(watch.seen).toEqual([{ key: "d", prevented: true }]);
  });
});

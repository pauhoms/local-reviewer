/**
 * Corners of the comment cycle the acceptance suite leaves open: a comment with
 * nothing written in it, a file the diff cannot show, and the panel 3 keys that
 * must stay inert.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { UserEvent } from "@testing-library/user-event";
import type { FileDiff, Line, Review, Scope } from "@/ipc/types";
import { panel } from "../keys/helpers";
import { restoreLayout, stubLayout } from "../helpers/diff-layout";

vi.mock("@/ipc/client", () => import("../helpers/ipc-mock"));

import App from "@/App";
import { configureIpc, saveReview } from "../helpers/ipc-mock";
import { reviewStore } from "@/state/review";
import type { ReviewComment } from "@/state/review";

const SCOPE: Scope = { kind: "worktree", repo: "/home/dev/local-reviewer" };
const PATH = "src/UserService.php";

function add(newNo: number, content: string): Line {
  return { kind: "add", oldNo: null, newNo, content };
}

const file: FileDiff = {
  path: PATH,
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
      lines: [add(1, "uno"), add(2, "dos"), add(3, "tres")],
    },
  ],
};

const other: FileDiff = {
  ...file,
  path: "web/Order.ts",
  hunks: [
    {
      header: "@@ -0,0 +1,2 @@",
      oldStart: 0,
      oldLines: 0,
      newStart: 1,
      newLines: 2,
      lines: [add(1, "export interface Order {"), add(2, "}")],
    },
  ],
};

/** A file git reported with no hunks at all: a binary blob, or a mode change. */
const bare: FileDiff = { ...file, path: "assets/logo.png", hunks: [] };

function entries(): HTMLElement[] {
  return within(panel("comments"))
    .queryAllByRole("option")
    .filter((node) => node.hasAttribute("data-comment-id"));
}

function editor(): HTMLElement | null {
  return within(panel("comments")).queryByRole("textbox");
}

function mode(): string {
  for (const name of ["NORMAL", "VISUAL", "INSERT"]) {
    if (screen.queryByText(name) !== null) return name;
  }
  throw new Error("the header does not show any mode");
}

async function boot(files: FileDiff[] = [file], reviews: Review[] = []): Promise<UserEvent> {
  configureIpc({ startup: { scope: SCOPE, home: "/home/dev" }, diff: files, reviews });
  render(<App />);
  await screen.findByRole("region", { name: /^1 FILES/ });
  const user = userEvent.setup();
  await act(async () => undefined);
  return user;
}

/** One task for the whole burst: the shape a key repeat takes, with no render in between. */
function burst(...keys: string[]): void {
  act(() => {
    for (const key of keys) {
      document.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key }));
    }
  });
}

function seed(...comments: ReviewComment[]): void {
  act(() => {
    for (const item of comments) reviewStore.addComment(item);
  });
}

function diffCursorIndex(): number {
  const marked = Array.from(panel("diff").querySelectorAll<HTMLElement>("[data-line-index]")).filter(
    (row) => row.getAttribute("data-cursor") === "true",
  );
  return marked.length === 0 ? -1 : Number(marked[0].getAttribute("data-line-index"));
}

beforeEach(() => {
  stubLayout();
});

afterEach(() => {
  restoreLayout();
  act(() => reviewStore.open(SCOPE, []));
});

/** Resolves once `saveReview` has gone one quiet window without a new call. */
async function settleWrites(): Promise<void> {
  let seen = -1;
  while (seen !== saveReview.mock.calls.length) {
    seen = saveReview.mock.calls.length;
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 200));
    });
  }
}

describe("a comment nobody wrote", () => {
  it("Ctrl+Enter with an empty editor leaves no comment behind", async () => {
    const user = await boot();

    await user.keyboard("2gg v c");
    expect(entries()).toHaveLength(1);

    await user.keyboard("{Control>}{Enter}{/Control}");

    expect(entries()).toHaveLength(0);
    expect(editor()).toBeNull();
    expect(mode()).toBe("NORMAL");
    expect(panel("comments")).toHaveTextContent(/no comments/i);
  });

  it("a comment of nothing but spaces is not saved either", async () => {
    const user = await boot();

    await user.keyboard("2ggvc");
    await user.keyboard("   ");
    await user.keyboard("{Control>}{Enter}{/Control}");

    expect(entries()).toHaveLength(0);
  });

  it("saves the comment the moment there is something in it", async () => {
    const user = await boot();

    await user.keyboard("2ggvc");
    await user.keyboard("algo");
    await user.keyboard("{Control>}{Enter}{/Control}");

    expect(entries()).toHaveLength(1);
    await waitFor(() => expect(saveReview).toHaveBeenCalled());
  });
});

describe("a file with nothing to anchor to", () => {
  it("c on a diff with no lines neither creates a comment nor opens the editor", async () => {
    const user = await boot([bare]);

    await user.keyboard("2v");
    expect(mode()).toBe("VISUAL");

    await user.keyboard("c");

    expect(entries()).toHaveLength(0);
    expect(editor()).toBeNull();
    expect(mode()).toBe("VISUAL");
  });
});

describe("panel 3 keys that answer nothing", () => {
  it("z on its own folds nothing and leaves the entry as it was", async () => {
    const user = await boot();
    await user.keyboard("2ggvc");
    await user.keyboard("una nota");
    await user.keyboard("{Control>}{Enter}{/Control}");

    await user.keyboard("3");
    await user.keyboard("zx");

    expect(entries()[0]).toHaveAttribute("aria-expanded", "true");
    expect(mode()).toBe("NORMAL");
  });

  it("j right after a burst of dd reads the list already short", async () => {
    await boot([file, other]);
    seed(
      { id: "c1", path: PATH, side: "new", from: 1, to: 1, text: "uno" },
      { id: "c2", path: PATH, side: "new", from: 2, to: 2, text: "dos" },
      { id: "c3", path: other.path, side: "new", from: 2, to: 2, text: "tres" },
    );

    // Two deletions leave one entry, so `j` has nowhere to go and `Enter` has
    // to open the only comment left, not fall off the end of the list.
    burst("3", "d", "d", "d", "d", "j", "Enter");

    expect(entries().map((node) => node.getAttribute("data-comment-id"))).toEqual(["c3"]);
    expect(panel("diff")).toHaveTextContent(other.path);
    expect(diffCursorIndex()).toBe(1);
  });

  it("the review is not written again by walking the list", async () => {
    const user = await boot();
    await user.keyboard("2ggvc");
    await user.keyboard("una nota");
    await user.keyboard("{Control>}{Enter}{/Control}");
    await waitFor(() => expect(saveReview).toHaveBeenCalledTimes(1));
    // A serialised write reschedules a whole debounce behind itself, so the
    // tail can run to twice the delay. Wait for the count to stop moving
    // instead of guessing a duration, or the tail reads as a write the walk
    // caused — under CPU load it does.
    await settleWrites();
    saveReview.mockClear();

    await user.keyboard("3jkzczo{Enter}");
    await settleWrites();

    expect(saveReview).not.toHaveBeenCalled();
  });
});

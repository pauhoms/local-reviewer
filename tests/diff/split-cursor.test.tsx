/**
 * Two corners of the split view the panel has to answer for: the cursor sitting
 * on a gap of the active column, and Enter on a comment of panel 3 landing on
 * the row that holds the line it is anchored to — a row, not a line, because in
 * split the cursor counts rows.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { UserEvent } from "@testing-library/user-event";
import type { Comment, FileDiff, Line, Scope } from "@/ipc/types";
import { panel } from "../keys/helpers";
import { restoreLayout, stubLayout, VIEWPORT_HEIGHT } from "../helpers/diff-layout";

vi.mock("@/ipc/client", () => import("../helpers/ipc-mock"));

import App from "@/App";
import { configureIpc } from "../helpers/ipc-mock";
import { reviewStore } from "@/state/review";

const SCOPE: Scope = { kind: "worktree", repo: "/home/dev/local-reviewer" };
const PATH = "src/UserService.php";

const SPLIT = "{Control>}w{/Control}v";
const ONLY = "{Control>}w{/Control}o";

function context(oldNo: number, newNo: number, content: string): Line {
  return { kind: "context", oldNo, newNo, content };
}

function add(newNo: number, content: string): Line {
  return { kind: "add", oldNo: null, newNo, content };
}

function del(oldNo: number, content: string): Line {
  return { kind: "del", oldNo, newNo: null, content };
}

/**
 * The run interleaves its additions and its deletions, so the index of a line
 * and the row it ends up on are different numbers. Git writes every `-` of a
 * block before its `+`, so this order is not one it emits; nothing here may
 * lean on that order either.
 *
 *   line  kind     old  new   item  row
 *     0   context   33   33     0     1
 *     1   add        ·   35     1     2
 *     2   add        ·   36     2     3
 *     3   add        ·   37     3     4
 *     4   del       35    ·     1     2
 *     5   del       36    ·     2     3
 *     6   context   37   38     4     5
 */
const FILE: FileDiff = {
  path: PATH,
  oldPath: null,
  status: "M",
  additions: 3,
  deletions: 2,
  hunks: [
    {
      header: "@@ -33,4 +33,5 @@ class UserService",
      oldStart: 33,
      oldLines: 4,
      newStart: 33,
      newLines: 5,
      lines: [
        context(33, 33, "  public function save(User $u) {"),
        add(35, "    $this->repo->save($u);"),
        add(36, "    $this->log->info('saved');"),
        add(37, "    return true;"),
        del(35, "    $this->repo->persist($u);"),
        del(36, "    $this->repo->flush();"),
        context(37, 38, "  }"),
      ],
    },
  ],
};

function diffPanel(): HTMLElement {
  return panel("diff");
}

function cursorCell(): HTMLElement {
  const marked = Array.from(
    diffPanel().querySelectorAll<HTMLElement>("[data-split-row] [data-cursor='true']"),
  );
  const cells = marked.map((node) => node.closest<HTMLElement>("[data-side]"));
  const unique = [...new Set(cells)];
  if (unique.length !== 1 || unique[0] === null) {
    throw new Error(`expected one cursor cell, found ${unique.length}`);
  }
  return unique[0];
}

function rowOf(cell: HTMLElement): HTMLElement {
  const row = cell.closest<HTMLElement>("[data-split-row]");
  if (!row) throw new Error("the cell is not inside any row");
  return row;
}

function cellOf(row: HTMLElement, side: "old" | "new"): HTMLElement {
  const cell = row.querySelector<HTMLElement>(`[data-side="${side}"]`);
  if (!cell) throw new Error(`the row has no ${side}-side cell`);
  return cell;
}

function numberIn(cell: HTMLElement): string {
  const side = cell.getAttribute("data-side");
  return (
    cell.querySelector(side === "old" ? "[data-old-no]" : "[data-new-no]")?.textContent?.trim() ?? ""
  );
}

function isGap(cell: HTMLElement): boolean {
  return !cell.hasAttribute("data-line-index") && cell.querySelector("[data-line-index]") === null;
}

async function boot(): Promise<UserEvent> {
  configureIpc({ startup: { scope: SCOPE, home: "/home/dev" }, diff: [FILE] });
  render(<App />);
  await screen.findByRole("region", { name: /^1 FILES/ });
  const user = userEvent.setup();
  await user.keyboard("2");
  await act(async () => undefined);
  return user;
}

beforeEach(() => {
  stubLayout(VIEWPORT_HEIGHT);
});

afterEach(() => {
  restoreLayout();
  act(() => reviewStore.open(SCOPE, []));
});

describe("the cursor of the split view", () => {
  it("shows on the gap of the active column, and only there", async () => {
    const user = await boot();
    await user.keyboard(SPLIT);
    await user.keyboard("h");

    await user.keyboard("gg");
    await user.keyboard("jjj");

    const cell = cursorCell();
    expect(cell.getAttribute("data-side")).toBe("old");
    expect(isGap(cell)).toBe(true);
    // The row is still the one it looks like: its new column holds line 37.
    expect(numberIn(cellOf(rowOf(cell), "new"))).toBe("37");
  });
});

describe("a round trip through the unified view from a gap", () => {
  it("comes back to the same row, on the column that really holds the line", async () => {
    const user = await boot();
    await user.keyboard(SPLIT);
    await user.keyboard("h");
    await user.keyboard("gg");
    await user.keyboard("jjj");
    const row = rowOf(cursorCell()).getAttribute("data-split-row");
    expect(isGap(cursorCell())).toBe(true);

    await user.keyboard(ONLY);
    await user.keyboard(SPLIT);

    // The old column never had that line, so the active side moves with it
    // rather than land the reader back on a gap he cannot comment.
    const cell = cursorCell();
    expect(rowOf(cell).getAttribute("data-split-row")).toBe(row);
    expect(cell.getAttribute("data-side")).toBe("new");
    expect(numberIn(cell)).toBe("37");
    expect(panel("diff")).toHaveTextContent(/NEW side/i);
  });
});

describe("c has nothing to anchor when the active column is all gaps", () => {
  it("leaves the range where it was instead of opening an editor for nobody", async () => {
    const user = await boot();
    await user.keyboard(SPLIT);
    await user.keyboard("h");
    await user.keyboard("gg");
    await user.keyboard("jjj");
    expect(isGap(cursorCell())).toBe(true);

    await user.keyboard("v");
    await user.keyboard("c");

    expect(screen.getByText("VISUAL")).toBeInTheDocument();
    expect(panel("comments").querySelectorAll("[data-comment-id]")).toHaveLength(0);
    expect(panel("comments")).toHaveTextContent(/no comments/i);
  });
});

describe("Ctrl+w answers with a range open", () => {
  it("leaves the split without asking for an Escape first, and drops the range", async () => {
    const user = await boot();
    await user.keyboard(SPLIT);
    await user.keyboard("gg");
    await user.keyboard("v");
    await user.keyboard("j");
    expect(screen.getByText("VISUAL")).toBeInTheDocument();

    await user.keyboard(ONLY);

    expect(diffPanel().querySelectorAll("[data-split-row]")).toHaveLength(0);
    expect(screen.getByText("NORMAL")).toBeInTheDocument();
    // Nothing is painted as chosen any more beyond the line the cursor is on.
    const marked = diffPanel().querySelectorAll<HTMLElement>("[aria-selected='true']");
    expect(marked).toHaveLength(1);
    expect(marked[0].getAttribute("data-cursor")).toBe("true");
  });

  it("changes column with the range open and paints it on the column it moved to", async () => {
    const user = await boot();
    await user.keyboard(SPLIT);
    await user.keyboard("gg");
    await user.keyboard("v");
    await user.keyboard("j");

    await user.keyboard("{Control>}w{/Control}h");

    expect(screen.getByText("VISUAL")).toBeInTheDocument();
    const selected = Array.from(
      diffPanel().querySelectorAll<HTMLElement>("[data-split-row] [aria-selected='true']"),
    );
    expect(selected.map((cell) => cell.getAttribute("data-side"))).toEqual(["old", "old"]);
    expect(selected.map(numberIn)).toEqual(["33", "35"]);
  });
});

describe("Enter on a comment lands on the row that holds its line", () => {
  it("takes the split cursor to the row of the line, on the side it is anchored to", async () => {
    const saved: Comment[] = [
      { id: "c1", path: PATH, side: "old", from: 35, to: 35, text: "sobra el persist" },
    ];
    configureIpc({
      startup: { scope: SCOPE, home: "/home/dev" },
      diff: [FILE],
      reviews: [{ scope: SCOPE, comments: saved, view: "split" }],
    });
    render(<App />);
    const user = userEvent.setup();
    await screen.findByText(/resume/i);
    await user.keyboard("{Enter}");
    await screen.findByRole("region", { name: /^1 FILES/ });

    // The old line 35 is the fifth line of the file and the second row of the
    // split: a jump travelling as a line index would land three rows further.
    await user.keyboard("3");
    await user.keyboard("{Enter}");

    const cell = cursorCell();
    expect(cell.getAttribute("data-side")).toBe("old");
    expect(numberIn(cell)).toBe("35");
    expect(rowOf(cell).getAttribute("data-split-row")).toBe("2");
  });
});

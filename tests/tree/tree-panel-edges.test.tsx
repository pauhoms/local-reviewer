import { afterEach, describe, expect, it } from "vitest";
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { FileDiff, Scope } from "@/ipc/types";
import ReviewShell from "@/screens/ReviewShell";
import { reviewStore } from "@/state/review";
import TreePanel from "@/panels/TreePanel";
import { panel } from "../keys/helpers";

const SCOPE: Scope = { kind: "worktree", repo: "/home/dev/local-reviewer" };

function fileDiff(path: string): FileDiff {
  return { path, oldPath: null, status: "M", additions: 1, deletions: 1, hunks: [] };
}

function rowPaths(): Array<string | null> {
  return within(panel("tree"))
    .getAllByRole("option")
    .map((row) => row.getAttribute("data-path"));
}

afterEach(() => act(() => reviewStore.open(SCOPE, [])));

describe("TreePanel with nothing to show", () => {
  it("says so in place of the list instead of rendering an empty listbox", () => {
    render(
      <TreePanel
        rows={[]}
        cursor={0}
        active
        commentCounts={new Map()}
        totals={{ files: 0, additions: 0, deletions: 0 }}
      />,
    );

    expect(within(panel("tree")).queryAllByRole("option")).toEqual([]);
    expect(screen.getByText(/No changed files/i)).toBeInTheDocument();
  });
});

describe("the tree when another review opens", () => {
  it("shows the new files unfolded even if the old folders were collapsed", async () => {
    act(() => reviewStore.open(SCOPE, [fileDiff("src/a.ts"), fileDiff("src/b.ts")]));
    render(<ReviewShell scope={SCOPE} />);
    const user = userEvent.setup();

    await user.keyboard("h");
    expect(rowPaths()).toEqual(["src"]);

    act(() => reviewStore.open(SCOPE, [fileDiff("src/c.ts"), fileDiff("other.md")]));

    expect(rowPaths()).toEqual(["src", "src/c.ts", "other.md"]);
  });
});

describe("the tree header", () => {
  it("counts the files of the diff and what they changed", () => {
    render(
      <TreePanel
        rows={[]}
        cursor={0}
        active
        commentCounts={new Map()}
        totals={{ files: 2, additions: 7, deletions: 3 }}
      />,
    );

    expect(panel("tree").querySelector("h2")).toHaveTextContent("2f +7 −3");
  });

  it("adds up the real files of a review, folders aside", () => {
    act(() =>
      reviewStore.open(SCOPE, [
        { ...fileDiff("src/a.ts"), additions: 3, deletions: 2 },
        { ...fileDiff("src/deep/b.ts"), additions: 4, deletions: 1 },
      ]),
    );
    render(<ReviewShell scope={SCOPE} />);

    expect(panel("tree").querySelector("h2")).toHaveTextContent("2f +7 −3");
  });
});

import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "@/App";

type PanelName = "tree" | "diff" | "comments";

const TITLES: Record<PanelName, RegExp> = {
  tree: /^1 ÁRBOL/,
  diff: /^2 DIFF/,
  comments: /^3 COMENTARIOS/,
};

function panel(name: PanelName): HTMLElement {
  return screen.getByRole("region", { name: TITLES[name] });
}

function items(name: PanelName): HTMLElement[] {
  return within(panel(name)).getAllByRole("option");
}

function cursorIndex(name: PanelName): number {
  return items(name).findIndex(
    (item) => item.getAttribute("aria-selected") === "true",
  );
}

function activePanels(): PanelName[] {
  const names: PanelName[] = ["tree", "diff", "comments"];
  return names.filter((name) => panel(name).getAttribute("data-active") === "true");
}

describe("three panel shell", () => {
  it("TS-13: renders the three panels with their titles and a placeholder list each", () => {
    render(<App />);

    expect(screen.getByRole("heading", { name: TITLES.tree })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: TITLES.diff })).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: TITLES.comments }),
    ).toBeInTheDocument();

    for (const name of ["tree", "diff", "comments"] as PanelName[]) {
      expect(items(name).length).toBeGreaterThanOrEqual(3);
    }

    expect(activePanels()).toEqual(["tree"]);
    expect(cursorIndex("tree")).toBe(0);
    expect(cursorIndex("diff")).toBe(0);
    expect(cursorIndex("comments")).toBe(0);
    expect(screen.getByText("NORMAL")).toBeInTheDocument();
  });

  it("TS-13: 1/2/3 move the active mark from panel to panel", async () => {
    render(<App />);
    const user = userEvent.setup();

    await user.keyboard("2");
    expect(activePanels()).toEqual(["diff"]);

    await user.keyboard("3");
    expect(activePanels()).toEqual(["comments"]);

    await user.keyboard("1");
    expect(activePanels()).toEqual(["tree"]);
  });

  it("TS-13: j and k move the cursor of the active panel only", async () => {
    render(<App />);
    const user = userEvent.setup();

    await user.keyboard("1jj");
    expect(cursorIndex("tree")).toBe(2);
    expect(cursorIndex("diff")).toBe(0);
    expect(cursorIndex("comments")).toBe(0);

    await user.keyboard("k");
    expect(cursorIndex("tree")).toBe(1);

    await user.keyboard("kk");
    expect(cursorIndex("tree")).toBe(0);
  });

  it("TS-13: every panel keeps its own cursor when coming back to it", async () => {
    render(<App />);
    const user = userEvent.setup();

    await user.keyboard("2jj");
    expect(cursorIndex("diff")).toBe(2);

    await user.keyboard("1j");
    expect(cursorIndex("tree")).toBe(1);

    await user.keyboard("2");
    expect(activePanels()).toEqual(["diff"]);
    expect(cursorIndex("diff")).toBe(2);

    await user.keyboard("1");
    expect(cursorIndex("tree")).toBe(1);
  });

  it("TS-13: gg and G jump to the first and last item of the active panel", async () => {
    render(<App />);
    const user = userEvent.setup();

    await user.keyboard("2");
    await user.keyboard("{Shift>}G{/Shift}");
    expect(cursorIndex("diff")).toBe(items("diff").length - 1);

    await user.keyboard("gg");
    expect(cursorIndex("diff")).toBe(0);
  });

  it("TS-13: v shows visual mode and Esc goes back to normal", async () => {
    render(<App />);
    const user = userEvent.setup();

    await user.keyboard("2v");
    expect(screen.getByText("VISUAL")).toBeInTheDocument();
    expect(screen.queryByText("NORMAL")).toBeNull();

    await user.keyboard("{Escape}");
    expect(screen.getByText("NORMAL")).toBeInTheDocument();
    expect(screen.queryByText("VISUAL")).toBeNull();
  });

  it("TS-13: Ctrl+d and Ctrl+u never reach the browser default action", async () => {
    const seen: Array<{ key: string; ctrl: boolean; prevented: boolean }> = [];
    const spy = (event: KeyboardEvent) => {
      seen.push({
        key: event.key,
        ctrl: event.ctrlKey,
        prevented: event.defaultPrevented,
      });
    };
    window.addEventListener("keydown", spy);
    try {
      render(<App />);
      const user = userEvent.setup();

      await user.keyboard("2");
      await user.keyboard("{Control>}d{/Control}");
      await user.keyboard("{Control>}u{/Control}");
    } finally {
      window.removeEventListener("keydown", spy);
    }

    expect(seen.filter((e) => e.ctrl && (e.key === "d" || e.key === "u"))).toEqual([
      { key: "d", ctrl: true, prevented: true },
      { key: "u", ctrl: true, prevented: true },
    ]);
  });
});

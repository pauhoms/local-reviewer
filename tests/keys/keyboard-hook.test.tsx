import React from "react";
import { describe, it, expect } from "vitest";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useKeyboard } from "@/keys/useKeyboard";
import type { Command } from "@/keys/types";

interface HarnessProps {
  treeItems: number;
  diffPage?: number;
  onCommands?: (commands: Command[]) => void;
}

function Harness({ treeItems, diffPage = 10, onCommands }: HarnessProps): JSX.Element {
  const state = useKeyboard(
    {
      tree: { itemCount: treeItems, pageSize: treeItems },
      diff: { itemCount: 50, pageSize: diffPage },
      comments: { itemCount: 3, pageSize: 3 },
    },
    onCommands,
  );

  return (
    <div>
      <span data-testid="mode">{state.mode}</span>
      <span data-testid="tree-cursor">{state.panels.tree.cursor}</span>
      <span data-testid="diff-cursor">{state.panels.diff.cursor}</span>
    </div>
  );
}

function cursor(panel: "tree" | "diff"): string | null {
  return screen.getByTestId(`${panel}-cursor`).textContent;
}

function dispatchKey(key: string, at?: number): void {
  const event = new KeyboardEvent("keydown", { key, bubbles: true });
  if (at !== undefined) Object.defineProperty(event, "timeStamp", { value: at });
  document.dispatchEvent(event);
}

describe("useKeyboard follows its config after mount", () => {
  it("takes in an item count that arrives late", async () => {
    const { rerender } = render(<Harness treeItems={3} />);
    const user = userEvent.setup();

    await user.keyboard("1jjjjj");
    expect(cursor("tree")).toBe("2");

    rerender(<Harness treeItems={10} />);
    await user.keyboard("jjjjj");
    expect(cursor("tree")).toBe("7");
  });

  it("revives j and k when the panel starts empty", async () => {
    const { rerender } = render(<Harness treeItems={0} />);
    const user = userEvent.setup();

    await user.keyboard("1jj");
    expect(cursor("tree")).toBe("0");

    rerender(<Harness treeItems={4} />);
    await user.keyboard("jj");
    expect(cursor("tree")).toBe("2");
  });

  it("clamps the cursor when the item count shrinks", async () => {
    const { rerender } = render(<Harness treeItems={10} />);
    const user = userEvent.setup();

    await user.keyboard("1jjjjj");
    expect(cursor("tree")).toBe("5");

    rerender(<Harness treeItems={2} />);
    expect(cursor("tree")).toBe("1");
  });

  it("takes in a page size that changes with the viewport", async () => {
    const { rerender } = render(<Harness treeItems={4} diffPage={2} />);
    const user = userEvent.setup();

    await user.keyboard("2");
    await user.keyboard("{Control>}d{/Control}");
    expect(cursor("diff")).toBe("1");

    rerender(<Harness treeItems={4} diffPage={20} />);
    await user.keyboard("{Control>}d{/Control}");
    expect(cursor("diff")).toBe("11");
  });
});

describe("useKeyboard emits one command per key", () => {
  it("does not duplicate commands under StrictMode", () => {
    const emitted: Command[] = [];
    render(
      <React.StrictMode>
        <Harness treeItems={10} onCommands={(commands) => emitted.push(...commands)} />
      </React.StrictMode>,
    );

    act(() => {
      dispatchKey("1");
      dispatchKey("j");
      dispatchKey("j");
      dispatchKey("j");
    });

    expect(emitted).toEqual([
      { type: "SwitchPanel", panel: "tree" },
      { type: "MoveCursor", panel: "tree", to: 1 },
      { type: "MoveCursor", panel: "tree", to: 2 },
      { type: "MoveCursor", panel: "tree", to: 3 },
    ]);
    expect(cursor("tree")).toBe("3");
  });

  it("does not duplicate commands typed one by one", async () => {
    const emitted: Command[] = [];
    render(
      <React.StrictMode>
        <Harness treeItems={10} onCommands={(commands) => emitted.push(...commands)} />
      </React.StrictMode>,
    );
    const user = userEvent.setup();

    await user.keyboard("1jj");

    expect(emitted).toEqual([
      { type: "SwitchPanel", panel: "tree" },
      { type: "MoveCursor", panel: "tree", to: 1 },
      { type: "MoveCursor", panel: "tree", to: 2 },
    ]);
  });
});

describe("useKeyboard timestamps the keys it forwards", () => {
  it("drops a prefix that has been waiting too long", () => {
    render(<Harness treeItems={4} />);

    act(() => {
      dispatchKey("2");
      dispatchKey("j");
      dispatchKey("j");
      dispatchKey("j");
    });
    expect(cursor("diff")).toBe("3");

    act(() => dispatchKey("g", 1_000));
    act(() => dispatchKey("g", 602_000));
    expect(cursor("diff")).toBe("3");
  });

  it("keeps a prompt double alive", async () => {
    render(<Harness treeItems={4} />);
    const user = userEvent.setup();

    await user.keyboard("2jjj");
    expect(cursor("diff")).toBe("3");

    await user.keyboard("gg");
    expect(cursor("diff")).toBe("0");
  });
});

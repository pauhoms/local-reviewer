import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { START_KEYMAPS } from "@/keys/keymap";
import { useKeyboard } from "@/keys/useKeyboard";
import type { Command } from "@/keys/types";

interface HarnessProps {
  listId: string;
  items: number;
  onCommands?: (commands: Command[]) => void;
}

function Harness({ listId, items, onCommands }: HarnessProps): JSX.Element {
  const state = useKeyboard(
    {
      tree: { itemCount: 3, pageSize: 3 },
      diff: { itemCount: items, pageSize: items, listId },
      comments: { itemCount: 3, pageSize: 3 },
    },
    onCommands,
    START_KEYMAPS,
  );

  return <span data-testid="diff-cursor">{state.panels.diff.cursor}</span>;
}

function cursor(): string | null {
  return screen.getByTestId("diff-cursor").textContent;
}

describe("useKeyboard takes the table it is given", () => {
  it("answers l with the row of the table passed in, not the default one", async () => {
    const emitted: Command[] = [];
    render(<Harness listId="/home/dev" items={5} onCommands={(c) => emitted.push(...c)} />);
    const user = userEvent.setup();

    await user.keyboard("2jl");

    expect(emitted).toContainEqual({ type: "Descend", panel: "diff", index: 1 });
  });
});

describe("useKeyboard resets the cursor when the list is replaced", () => {
  it("puts the cursor back on the first row of a new list", async () => {
    const { rerender } = render(<Harness listId="/home/dev" items={5} />);
    const user = userEvent.setup();

    await user.keyboard("2jjj");
    expect(cursor()).toBe("3");

    rerender(<Harness listId="/home/dev/prx" items={5} />);
    expect(cursor()).toBe("0");
  });

  it("leaves the cursor alone while the list keeps its identity", async () => {
    const { rerender } = render(<Harness listId="/home/dev" items={5} />);
    const user = userEvent.setup();

    await user.keyboard("2jj");
    expect(cursor()).toBe("2");

    rerender(<Harness listId="/home/dev" items={4} />);
    expect(cursor()).toBe("2");
  });
});

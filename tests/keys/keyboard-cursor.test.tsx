import { describe, it, expect } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { START_KEYMAPS } from "@/keys/keymap";
import { useKeyboard } from "@/keys/useKeyboard";
import type { Command } from "@/keys/types";

interface HarnessProps {
  cursorNow: () => number;
  onCommands: (commands: Command[]) => void;
}

function Harness({ cursorNow, onCommands }: HarnessProps): JSX.Element {
  const state = useKeyboard(
    {
      tree: { itemCount: 3, pageSize: 3 },
      diff: { itemCount: 50, pageSize: 10, cursorNow },
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

/** One task for the whole burst: the shape a key repeat takes, with no render in between. */
function burst(...keys: string[]): void {
  act(() => {
    for (const key of keys) {
      document.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
    }
  });
}

describe("useKeyboard reads the cursor of a panel that owns it elsewhere", () => {
  it("answers the key with the cursor as the owner has it, not as the last render left it", () => {
    let owned = 0;
    const onCommands = (commands: Command[]): void => {
      for (const command of commands) {
        if (command.type === "MoveCursor" && command.panel === "diff") owned = command.to;
      }
      // Whoever owns the cursor may move it while answering a key of the burst.
      if (owned === 3) owned = 0;
    };
    render(<Harness cursorNow={() => owned} onCommands={onCommands} />);

    burst("2", "j", "j", "j", "j");

    expect(owned).toBe(1);
    expect(cursor()).toBe("1");
  });

  it("leaves a panel with no owner walking on its own", () => {
    const seen: number[] = [];
    render(
      <Harness
        cursorNow={() => 0}
        onCommands={(commands) => {
          for (const command of commands) {
            if (command.type === "MoveCursor" && command.panel === "tree") seen.push(command.to);
          }
        }}
      />,
    );

    burst("1", "j", "j");

    expect(seen).toEqual([1, 2]);
  });
});

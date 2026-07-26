import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "@/App";
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

describe("the shell shows the visual range", () => {
  it("marks every line between the anchor and the head", async () => {
    render(<App />);
    const user = userEvent.setup();

    await user.keyboard("2");
    expect(selectedIndexes("diff")).toEqual([0]);

    await user.keyboard("vjj");
    expect(selectedIndexes("diff")).toEqual([0, 1, 2]);
    expect(headIndex("diff")).toBe(2);
  });

  it("marks the range the same way when it grows upwards", async () => {
    render(<App />);
    const user = userEvent.setup();

    await user.keyboard("2jjjvkk");
    expect(selectedIndexes("diff")).toEqual([1, 2, 3]);
    expect(headIndex("diff")).toBe(1);
  });

  it("drops the range on Esc and leaves the cursor alone", async () => {
    render(<App />);
    const user = userEvent.setup();

    await user.keyboard("2vjj");
    await user.keyboard("{Escape}");

    expect(selectedIndexes("diff")).toEqual([2]);
  });

  it("does not paint a range over a panel that is not the active one", async () => {
    render(<App />);
    const user = userEvent.setup();

    await user.keyboard("2vjj");
    expect(selectedIndexes("comments")).toEqual([0]);
  });
});

describe("the shell talks to assistive tech", () => {
  it("marks the active panel with aria-current, not only with a CSS hook", async () => {
    render(<App />);
    const user = userEvent.setup();

    expect(panel("tree")).toHaveAttribute("aria-current", "true");

    await user.keyboard("2");
    expect(panel("diff")).toHaveAttribute("aria-current", "true");
    expect(panel("tree")).not.toHaveAttribute("aria-current", "true");
  });

  it("announces the mode through a live region", async () => {
    render(<App />);
    const user = userEvent.setup();

    expect(screen.getByText("NORMAL")).toHaveAttribute("aria-live", "polite");

    await user.keyboard("2v");
    expect(screen.getByText("VISUAL")).toHaveAttribute("aria-live", "polite");
  });
});

describe("the shell only takes the keys it answers", () => {
  it("leaves Ctrl+d and Ctrl+u alone in a panel with no half page binding", async () => {
    render(<App />);
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
    render(<App />);
    const user = userEvent.setup();

    await user.keyboard("2vjc");
    expect(screen.getByText("INSERT")).toBeInTheDocument();
    expect(screen.queryByText("VISUAL")).toBeNull();
    expect(screen.queryByText("NORMAL")).toBeNull();

    await user.keyboard("{Escape}");
    expect(screen.getByText("NORMAL")).toBeInTheDocument();
  });

  it("leaves Ctrl+d and Ctrl+u to the editor while insert is on", async () => {
    render(<App />);
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
    render(<App />);
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

import { describe, expect, it } from "vitest";
import { reviewKeymaps } from "@/keys/keymap";
import type { DiffMetrics } from "@/keys/keymap";
import type { Command, MachineState } from "@/keys/types";
import { base, key, pressWith } from "../keys/helpers";

const NO_ROWS = () => [];
const NO_COMMENTS = () => 0;

function keymaps(metrics: DiffMetrics) {
  return reviewKeymaps(NO_ROWS, () => metrics, NO_COMMENTS);
}

/** The machine still believes the previous file: 20 lines and a page of 10. */
function onDiff(): MachineState {
  return pressWith(keymaps({ lineCount: 20, pageSize: 10 }), base(), "2").state;
}

function press(metrics: DiffMetrics, ...keys: Array<string | ReturnType<typeof key>>): {
  state: MachineState;
  commands: Command[];
} {
  return pressWith(keymaps(metrics), onDiff(), ...keys);
}

const SHORT: DiffMetrics = { lineCount: 3, pageSize: 8 };

describe("the diff keys read the file on show, not the one the machine remembers", () => {
  it("stops j at the last line of the file that is open now", () => {
    const { state } = press(SHORT, "j", "j", "j", "j");

    expect(state.panels.diff.cursor).toBe(2);
  });

  it("sends G to the last line of the file on show", () => {
    const { commands, state } = press(SHORT, "G");

    expect(commands).toEqual([{ type: "MoveCursor", panel: "diff", to: 2 }]);
    expect(state.panels.diff.cursor).toBe(2);
  });

  it("sends gg to the first line", () => {
    const { state } = press(SHORT, "G", "g", "g");

    expect(state.panels.diff.cursor).toBe(0);
  });

  it("leaves the cursor on the only line of a one line file", () => {
    const { state } = press({ lineCount: 1, pageSize: 8 }, "G", "j", "j");

    expect(state.panels.diff.cursor).toBe(0);
  });

  it("answers a file with no lines with a cursor that does not move", () => {
    const { commands, state } = press({ lineCount: 0, pageSize: 8 }, "j");

    expect(commands).toEqual([{ type: "MoveCursor", panel: "diff", to: 0 }]);
    expect(state.panels.diff.cursor).toBe(0);
  });
});

describe("half a page is the one of the viewport on show", () => {
  it("takes Ctrl+d half of the measured page, not of the remembered one", () => {
    const { state } = press({ lineCount: 200, pageSize: 30 }, key("d", { ctrl: true }));

    expect(state.panels.diff.cursor).toBe(15);
  });

  it("brings Ctrl+u back by the same half page", () => {
    const { state } = press(
      { lineCount: 200, pageSize: 30 },
      key("d", { ctrl: true }),
      key("d", { ctrl: true }),
      key("u", { ctrl: true }),
    );

    expect(state.panels.diff.cursor).toBe(15);
  });

  it("still moves a line when the viewport only fits one", () => {
    const { state } = press({ lineCount: 200, pageSize: 1 }, key("d", { ctrl: true }));

    expect(state.panels.diff.cursor).toBe(1);
  });

  it("stops at the end of the file it can see", () => {
    const { state } = press(SHORT, key("d", { ctrl: true }));

    expect(state.panels.diff.cursor).toBe(2);
  });
});

describe("the visual range grows over the file on show", () => {
  it("extends down no further than the last line", () => {
    const { state } = press(SHORT, "v", "j", "j", "j");

    expect(state.selection).toEqual({ anchor: 0, head: 2 });
    expect(state.panels.diff.cursor).toBe(2);
  });

  it("extends up no further than the first line", () => {
    const { state } = press(SHORT, "G", "v", "k", "k", "k");

    expect(state.selection).toEqual({ anchor: 2, head: 0 });
  });
});

describe("the tree tables keep answering next to the diff ones", () => {
  it("still folds the row the tree cursor is on", () => {
    const rows = [{ foldable: true, expanded: true, parent: null }];
    const { commands } = pressWith(reviewKeymaps(() => rows, () => SHORT, NO_COMMENTS), base(), "1", "h");

    expect(commands).toEqual([{ type: "ToggleFold", panel: "tree", index: 0, open: false }]);
  });
});

import { describe, it, expect } from "vitest";
import { DEFAULT_KEYMAPS, START_KEYMAPS } from "@/keys/keymap";
import { base, pressWith } from "./helpers";

describe("the start screen keymap", () => {
  it("keeps 1/2/3 on the three lists of the picker", () => {
    for (const [digit, panel] of [
      ["1", "tree"],
      ["2", "diff"],
      ["3", "comments"],
    ] as const) {
      const step = pressWith(START_KEYMAPS, base(), digit);
      expect(step.commands).toEqual([{ type: "SwitchPanel", panel }]);
    }
  });

  it("moves the cursor of every list with j and k", () => {
    for (const [digit, panel] of [
      ["1", "tree"],
      ["2", "diff"],
      ["3", "comments"],
    ] as const) {
      const down = pressWith(START_KEYMAPS, base(), digit, "j");
      expect(down.commands).toEqual([{ type: "MoveCursor", panel, to: 1 }]);

      const up = pressWith(START_KEYMAPS, down.state, "k");
      expect(up.commands).toEqual([{ type: "MoveCursor", panel, to: 0 }]);
    }
  });

  it("confirms the row under the cursor of every list", () => {
    for (const [digit, panel] of [
      ["1", "tree"],
      ["2", "diff"],
      ["3", "comments"],
    ] as const) {
      const step = pressWith(START_KEYMAPS, base(), digit, "j", "Enter");
      expect(step.commands).toEqual([{ type: "Confirm", panel, index: 1 }]);
    }
  });

  it("walks into the directory under the cursor with l and back up with h", () => {
    const onEntry = pressWith(START_KEYMAPS, base(), "2", "j").state;

    expect(pressWith(START_KEYMAPS, onEntry, "l").commands).toEqual([
      { type: "Descend", panel: "diff", index: 1 },
    ]);
    expect(pressWith(START_KEYMAPS, onEntry, "h").commands).toEqual([
      { type: "Ascend", panel: "diff" },
    ]);
  });

  it("leaves h and l alone outside the directory browser", () => {
    for (const digit of ["1", "3"]) {
      for (const key of ["h", "l"]) {
        expect(pressWith(START_KEYMAPS, base(), digit, key).commands).toEqual([]);
      }
    }
  });

  it("has no visual mode to fall into", () => {
    for (const digit of ["1", "2", "3"]) {
      const step = pressWith(START_KEYMAPS, base(), digit, "v");
      expect(step.commands).toEqual([]);
      expect(step.state.mode).toBe("normal");
    }
  });

  it("does not lend its rows to the review keymap", () => {
    const onBrowser = pressWith(DEFAULT_KEYMAPS, base(), "2").state;

    for (const key of ["h", "l"]) {
      expect(pressWith(DEFAULT_KEYMAPS, onBrowser, key).commands).toEqual([]);
    }
  });

  it("neither Descend nor Ascend touches the cursor: the screen answers them", () => {
    const walked = pressWith(START_KEYMAPS, base(), "2", "j", "l");
    expect(walked.state.panels.diff.cursor).toBe(1);

    const up = pressWith(START_KEYMAPS, walked.state, "h");
    expect(up.state.panels.diff.cursor).toBe(1);
  });
});

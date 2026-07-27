/**
 * The window keys of panel 2: `Ctrl+w v` splits, `Ctrl+w o` goes back and
 * `h`/`l` — with or without `Ctrl+w` — choose the column. They read the view
 * and the side through the getter, so a burst that changes either is answered
 * by the state the burst left behind and not by the one React last rendered.
 */

import { describe, expect, it } from "vitest";
import { reviewKeymaps } from "@/keys/keymap";
import type { DiffMetrics } from "@/keys/keymap";
import type { Command, MachineState } from "@/keys/types";
import { base, key, pressWith } from "./helpers";

const NO_ROWS = () => [];
const NO_COMMENTS = () => 0;

const CTRL_W = key("w", { ctrl: true });

const UNIFIED: DiffMetrics = { lineCount: 12, pageSize: 8, view: "unified", side: "new" };
const SPLIT: DiffMetrics = { lineCount: 10, pageSize: 8, view: "split", side: "new" };
const SPLIT_OLD: DiffMetrics = { ...SPLIT, side: "old" };

function press(
  metrics: DiffMetrics,
  ...keys: Array<string | ReturnType<typeof key>>
): { state: MachineState; commands: Command[] } {
  const keymaps = reviewKeymaps(NO_ROWS, () => metrics, NO_COMMENTS);
  const onDiff = pressWith(keymaps, base(), "2").state;
  return pressWith(keymaps, onDiff, ...keys);
}

describe("Ctrl+w opens and closes the split", () => {
  it("waits for the second key instead of answering Ctrl+w by itself", () => {
    const { state, commands } = press(UNIFIED, CTRL_W);

    expect(commands).toEqual([]);
    expect(state.pending).toBe("Ctrl+w");
  });

  it("asks for the split view with Ctrl+w v", () => {
    expect(press(UNIFIED, CTRL_W, "v").commands).toEqual([{ type: "SetView", view: "split" }]);
  });

  it("asks for the unified view with Ctrl+w o", () => {
    expect(press(SPLIT, CTRL_W, "o").commands).toEqual([{ type: "SetView", view: "unified" }]);
  });

  it("says nothing when the view asked for is the one on show", () => {
    expect(press(SPLIT, CTRL_W, "v").commands).toEqual([]);
    expect(press(UNIFIED, CTRL_W, "o").commands).toEqual([]);
  });

  it("leaves the mode and the cursor where they were", () => {
    const { state } = press(UNIFIED, "j", "j", CTRL_W, "v");

    expect(state.mode).toBe("normal");
    expect(state.panels.diff.cursor).toBe(2);
  });
});

describe("h and l choose the column, in split and nowhere else", () => {
  it("takes the old side with Ctrl+w h and with a lone h", () => {
    const asked = [{ type: "SetSide", side: "old" }];

    expect(press(SPLIT, CTRL_W, "h").commands).toEqual(asked);
    expect(press(SPLIT, "h").commands).toEqual(asked);
  });

  it("takes the new side with Ctrl+w l and with a lone l", () => {
    const asked = [{ type: "SetSide", side: "new" }];

    expect(press(SPLIT_OLD, CTRL_W, "l").commands).toEqual(asked);
    expect(press(SPLIT_OLD, "l").commands).toEqual(asked);
  });

  it("says nothing when the side asked for is the active one", () => {
    expect(press(SPLIT, "l").commands).toEqual([]);
    expect(press(SPLIT_OLD, "h").commands).toEqual([]);
    expect(press(SPLIT_OLD, CTRL_W, "h").commands).toEqual([]);
  });

  it("answers nothing at all in the unified view, cursor included", () => {
    for (const keys of [["h"], ["l"], [CTRL_W, "h"], [CTRL_W, "l"]]) {
      const { state, commands } = press(UNIFIED, "j", ...keys);

      expect(commands).toEqual([]);
      expect(state.panels.diff.cursor).toBe(1);
      expect(state.mode).toBe("normal");
    }
  });

  it("does not move the cursor when it changes the side", () => {
    const { state } = press(SPLIT, "j", "j", "h");

    expect(state.panels.diff.cursor).toBe(2);
  });
});

describe("the rows the cursor walks are the ones of the view on show", () => {
  it("stops j at the last row of the split, which is not the last line", () => {
    const { state } = press({ ...SPLIT, lineCount: 3 }, "j", "j", "j", "j", "j");

    expect(state.panels.diff.cursor).toBe(2);
  });

  it("sends G to the last row of the split", () => {
    expect(press({ ...SPLIT, lineCount: 3 }, "G").commands).toEqual([
      { type: "MoveCursor", panel: "diff", to: 2 },
    ]);
  });
});

/**
 * Vim takes its window keys in visual too, and a reader who cannot leave the
 * split without first cancelling the range is trapped in it.
 */
describe("the window keys answer in visual mode as well", () => {
  it("goes back to unified with Ctrl+w o and closes the range doing it", () => {
    const { state, commands } = press(SPLIT, "v", "j", CTRL_W, "o");

    expect(commands).toEqual([{ type: "SetView", view: "unified" }]);
    // The range was drawn in rows and unified counts lines: keeping it would
    // paint lines nobody chose, so changing view ends the selection.
    expect(state.mode).toBe("normal");
    expect(state.selection).toBeNull();
  });

  it("splits with Ctrl+w v from a range of the unified view, and closes it too", () => {
    const { state, commands } = press(UNIFIED, "v", "j", CTRL_W, "v");

    expect(commands).toEqual([{ type: "SetView", view: "split" }]);
    expect(state.mode).toBe("normal");
    expect(state.selection).toBeNull();
  });

  it("keeps the range when the key only changes column, which counts the same rows", () => {
    for (const keys of [[CTRL_W, "h"], ["h"]]) {
      const { state, commands } = press(SPLIT, "v", "j", ...keys);

      expect(commands).toEqual([{ type: "SetSide", side: "old" }]);
      expect(state.mode).toBe("visual");
      expect(state.selection).toEqual({ anchor: 0, head: 1 });
      expect(state.panels.diff.cursor).toBe(1);
    }
  });

  it("swallows no key of its own: a Ctrl+w that leads nowhere leaves the next one alone", () => {
    const { state, commands } = press(UNIFIED, "v", CTRL_W, "j");

    expect(commands).toEqual([{ type: "ExtendSelection", from: 0, to: 1 }]);
    expect(state.mode).toBe("visual");
  });
});

describe("c only anchors where the active side has a line", () => {
  function withAnchor(anchored: (from: number, to: number) => boolean): DiffMetrics {
    return { ...SPLIT_OLD, anchored };
  }

  it("creates the comment when the range holds a line of the active side", () => {
    const { commands } = press(withAnchor(() => true), "v", "j", "c");

    expect(commands).toEqual([{ type: "CreateComment", panel: "diff", from: 0, to: 1 }]);
  });

  it("says nothing when the active side is a gap all the way through the range", () => {
    const { state, commands } = press(withAnchor(() => false), "v", "j", "c");

    expect(commands).toEqual([]);
    expect(state.mode).toBe("visual");
  });
});

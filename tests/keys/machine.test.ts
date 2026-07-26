import { describe, it, expect } from "vitest";
import {
  enterInsert,
  initialState,
  reduce,
  setItemCount,
  setPageSize,
} from "@/keys/machine";
import type { Command, KeyEvent, MachineState } from "@/keys/types";

const TREE_ITEMS = 4;
const DIFF_ITEMS = 20;
const COMMENT_ITEMS = 6;
const DIFF_PAGE = 10;

function key(k: string, mods: Partial<Omit<KeyEvent, "key">> = {}): KeyEvent {
  return { key: k, ctrl: false, shift: false, alt: false, meta: false, ...mods };
}

const CTRL_D = key("d", { ctrl: true });
const CTRL_U = key("u", { ctrl: true });
const SHIFT_G = key("G", { shift: true });

function base(): MachineState {
  let state = initialState();
  state = setItemCount(state, "tree", TREE_ITEMS);
  state = setItemCount(state, "diff", DIFF_ITEMS);
  state = setItemCount(state, "comments", COMMENT_ITEMS);
  state = setPageSize(state, "tree", TREE_ITEMS);
  state = setPageSize(state, "diff", DIFF_PAGE);
  state = setPageSize(state, "comments", COMMENT_ITEMS);
  return state;
}

/** Applies keys in order; `commands` are the ones emitted by the *last* key. */
function press(
  state: MachineState,
  ...keys: Array<string | KeyEvent>
): { state: MachineState; commands: Command[] } {
  let next = state;
  let commands: Command[] = [];
  for (const k of keys) {
    const step = reduce(next, typeof k === "string" ? key(k) : k);
    next = step.state;
    commands = step.commands;
  }
  return { state: next, commands };
}

describe("keyboard machine", () => {
  it("TS-09: 1/2/3 switch the active panel and emit SwitchPanel", () => {
    const start = base();
    expect(start.activePanel).toBe("tree");
    expect(start.mode).toBe("normal");
    expect(start.selection).toBeNull();
    expect(start.pending).toBeNull();
    expect(start.panels.tree.cursor).toBe(0);
    expect(start.panels.diff.cursor).toBe(0);
    expect(start.panels.comments.cursor).toBe(0);

    const toDiff = press(start, "2");
    expect(toDiff.commands).toEqual([{ type: "SwitchPanel", panel: "diff" }]);
    expect(toDiff.state.activePanel).toBe("diff");
    expect(toDiff.state.mode).toBe("normal");

    const toComments = press(toDiff.state, "3");
    expect(toComments.commands).toEqual([
      { type: "SwitchPanel", panel: "comments" },
    ]);
    expect(toComments.state.activePanel).toBe("comments");

    const toTree = press(toComments.state, "1");
    expect(toTree.commands).toEqual([{ type: "SwitchPanel", panel: "tree" }]);
    expect(toTree.state.activePanel).toBe("tree");
  });

  it("TS-09: each panel keeps its own cursor across panel switches", () => {
    const afterDiff = press(base(), "2", "j", "j", "j");
    expect(afterDiff.state.panels.diff.cursor).toBe(3);

    const afterTree = press(afterDiff.state, "1", "j");
    expect(afterTree.state.panels.tree.cursor).toBe(1);
    expect(afterTree.state.panels.diff.cursor).toBe(3);

    const afterComments = press(afterTree.state, "3", "j", "j");
    expect(afterComments.state.panels.comments.cursor).toBe(2);
    expect(afterComments.state.panels.tree.cursor).toBe(1);
    expect(afterComments.state.panels.diff.cursor).toBe(3);

    const backToDiff = press(afterComments.state, "2");
    expect(backToDiff.state.activePanel).toBe("diff");
    expect(backToDiff.state.panels.diff.cursor).toBe(3);
    expect(backToDiff.state.panels.tree.cursor).toBe(1);
    expect(backToDiff.state.panels.comments.cursor).toBe(2);
  });

  it("TS-09: switching panels does not reset the mode", () => {
    const visual = press(base(), "2", "j", "v");
    expect(visual.state.mode).toBe("visual");

    const switched = press(visual.state, "1");
    expect(switched.state.activePanel).toBe("tree");
    expect(switched.state.mode).toBe("visual");
  });

  it("TS-10: j and k move the active panel cursor and emit MoveCursor", () => {
    const down = press(base(), "2", "j");
    expect(down.commands).toEqual([
      { type: "MoveCursor", panel: "diff", to: 1 },
    ]);
    expect(down.state.panels.diff.cursor).toBe(1);

    const down2 = press(down.state, "j");
    expect(down2.commands).toEqual([
      { type: "MoveCursor", panel: "diff", to: 2 },
    ]);
    expect(down2.state.panels.diff.cursor).toBe(2);

    const up = press(down2.state, "k");
    expect(up.commands).toEqual([{ type: "MoveCursor", panel: "diff", to: 1 }]);
    expect(up.state.panels.diff.cursor).toBe(1);
  });

  it("TS-10: j and k clamp at both ends without overflowing", () => {
    const top = press(base(), "2", "k");
    expect(top.state.panels.diff.cursor).toBe(0);
    for (const command of top.commands) {
      if (command.type === "MoveCursor") expect(command.to).toBe(0);
    }

    const bottom = press(top.state, SHIFT_G, "j", "j");
    expect(bottom.state.panels.diff.cursor).toBe(DIFF_ITEMS - 1);
    for (const command of bottom.commands) {
      if (command.type === "MoveCursor") expect(command.to).toBe(DIFF_ITEMS - 1);
    }
  });

  it("TS-10: gg jumps to the first item and G to the last", () => {
    const moved = press(base(), "2", "j", "j", "j", "j", "j");
    expect(moved.state.panels.diff.cursor).toBe(5);

    const top = press(moved.state, "g", "g");
    expect(top.commands).toEqual([{ type: "MoveCursor", panel: "diff", to: 0 }]);
    expect(top.state.panels.diff.cursor).toBe(0);
    expect(top.state.pending).toBeNull();

    const bottom = press(top.state, SHIFT_G);
    expect(bottom.commands).toEqual([
      { type: "MoveCursor", panel: "diff", to: DIFF_ITEMS - 1 },
    ]);
    expect(bottom.state.panels.diff.cursor).toBe(DIFF_ITEMS - 1);
  });

  it("TS-10: a lone g emits nothing and a non-g key cancels the pending buffer", () => {
    const start = press(base(), "2", "j", "j", "j", "j", "j").state;

    const pending = press(start, "g");
    expect(pending.commands).toEqual([]);
    expect(pending.state.pending).toBe("g");
    expect(pending.state.panels.diff.cursor).toBe(5);

    const cancelled = press(pending.state, "j");
    expect(cancelled.state.pending).toBeNull();
    expect(cancelled.state.panels.diff.cursor).not.toBe(0);

    const afterCancel = press(cancelled.state, "g", "g");
    expect(afterCancel.commands).toEqual([
      { type: "MoveCursor", panel: "diff", to: 0 },
    ]);
    expect(afterCancel.state.panels.diff.cursor).toBe(0);
  });

  it("TS-10: Ctrl+d and Ctrl+u move half a page of the active panel", () => {
    const half = DIFF_PAGE / 2;

    const down = press(base(), "2", CTRL_D);
    expect(down.commands).toEqual([
      { type: "MoveCursor", panel: "diff", to: half },
    ]);
    expect(down.state.panels.diff.cursor).toBe(half);

    const down2 = press(down.state, CTRL_D);
    expect(down2.state.panels.diff.cursor).toBe(half * 2);

    const up = press(down2.state, CTRL_U);
    expect(up.commands).toEqual([
      { type: "MoveCursor", panel: "diff", to: half },
    ]);
    expect(up.state.panels.diff.cursor).toBe(half);

    const clampedTop = press(up.state, CTRL_U, CTRL_U);
    expect(clampedTop.state.panels.diff.cursor).toBe(0);

    const clampedBottom = press(clampedTop.state, SHIFT_G, CTRL_D);
    expect(clampedBottom.state.panels.diff.cursor).toBe(DIFF_ITEMS - 1);
  });

  it("TS-10: half a page follows the page size of each panel", () => {
    let state = base();
    state = setItemCount(state, "diff", 100);
    state = setPageSize(state, "diff", 40);

    const down = press(state, "2", CTRL_D);
    expect(down.commands).toEqual([
      { type: "MoveCursor", panel: "diff", to: 20 },
    ]);
    expect(down.state.panels.diff.cursor).toBe(20);
  });

  it("TS-10: the tree keymap binds j/k/h/l/Enter and nothing else", () => {
    const onItem = press(base(), "1", "j").state;
    expect(onItem.panels.tree.cursor).toBe(1);

    const collapsed = press(onItem, "h");
    expect(collapsed.commands).toEqual([
      { type: "ToggleFold", panel: "tree", index: 1, open: false },
    ]);

    const expanded = press(collapsed.state, "l");
    expect(expanded.commands).toEqual([
      { type: "ToggleFold", panel: "tree", index: 1, open: true },
    ]);

    const confirmed = press(expanded.state, "Enter");
    expect(confirmed.commands).toEqual([
      { type: "Confirm", panel: "tree", index: 1 },
    ]);

    for (const unbound of ["v", "c", CTRL_D, CTRL_U]) {
      const ignored = press(confirmed.state, unbound);
      expect(ignored.commands).toEqual([]);
      expect(ignored.state.mode).toBe("normal");
      expect(ignored.state.panels.tree.cursor).toBe(1);
    }
  });

  it("TS-10: the comments keymap binds j/k/gg/G/Enter/dd and nothing else", () => {
    const onItem = press(base(), "3", "j").state;
    expect(onItem.panels.comments.cursor).toBe(1);

    const confirmed = press(onItem, "Enter");
    expect(confirmed.commands).toEqual([
      { type: "Confirm", panel: "comments", index: 1 },
    ]);

    const pending = press(confirmed.state, "d");
    expect(pending.commands).toEqual([]);
    expect(pending.state.pending).toBe("d");

    const deleted = press(pending.state, "d");
    expect(deleted.commands).toEqual([
      { type: "DeleteItem", panel: "comments", index: 1 },
    ]);
    expect(deleted.state.pending).toBeNull();

    const last = press(deleted.state, SHIFT_G);
    expect(last.state.panels.comments.cursor).toBe(COMMENT_ITEMS - 1);

    for (const unbound of ["h", "l", "v", "c", CTRL_D, CTRL_U]) {
      const ignored = press(last.state, unbound);
      expect(ignored.commands).toEqual([]);
      expect(ignored.state.mode).toBe("normal");
      expect(ignored.state.panels.comments.cursor).toBe(COMMENT_ITEMS - 1);
    }
  });

  it("TS-11: v enters visual anchoring the selection at the cursor", () => {
    const visual = press(base(), "2", "j", "j", "j", "v");
    expect(visual.commands).toEqual([{ type: "EnterVisual" }]);
    expect(visual.state.mode).toBe("visual");
    expect(visual.state.selection).toEqual({ anchor: 3, head: 3 });
    expect(visual.state.panels.diff.cursor).toBe(3);
  });

  it("TS-11: j and k extend the selection in both directions", () => {
    const visual = press(base(), "2", "j", "j", "j", "v").state;

    const down = press(visual, "j", "j");
    expect(down.commands).toEqual([
      { type: "ExtendSelection", from: 3, to: 5 },
    ]);
    expect(down.state.selection).toEqual({ anchor: 3, head: 5 });
    expect(down.state.panels.diff.cursor).toBe(5);
    expect(down.state.mode).toBe("visual");

    const up = press(down.state, "k", "k", "k");
    expect(up.commands).toEqual([{ type: "ExtendSelection", from: 3, to: 2 }]);
    expect(up.state.selection).toEqual({ anchor: 3, head: 2 });
    expect(up.state.panels.diff.cursor).toBe(2);
  });

  it("TS-11: extending the selection clamps at both ends", () => {
    const atBottom = press(base(), "2", SHIFT_G, "v", "j", "j");
    expect(atBottom.state.selection).toEqual({
      anchor: DIFF_ITEMS - 1,
      head: DIFF_ITEMS - 1,
    });

    const atTop = press(base(), "2", "v", "k", "k");
    expect(atTop.state.selection).toEqual({ anchor: 0, head: 0 });
  });

  it("TS-11: Esc leaves visual, discards the selection and keeps the cursor", () => {
    const visual = press(base(), "2", "j", "j", "j", "v", "j").state;
    expect(visual.selection).toEqual({ anchor: 3, head: 4 });

    const escaped = press(visual, "Escape");
    expect(escaped.commands).toEqual([{ type: "Escape" }]);
    expect(escaped.state.mode).toBe("normal");
    expect(escaped.state.selection).toBeNull();
    expect(escaped.state.panels.diff.cursor).toBe(4);
  });

  it("TS-12: in insert mode movement keys and c emit no commands", () => {
    const normal = press(base(), "2", "j", "j", "j").state;
    const insert = enterInsert(normal);
    expect(insert.mode).toBe("insert");
    expect(insert.panels.diff.cursor).toBe(3);

    for (const swallowed of ["j", "k", SHIFT_G, CTRL_D, CTRL_U, "c", "v"]) {
      const step = press(insert, swallowed);
      expect(step.commands).toEqual([]);
      expect(step.state.mode).toBe("insert");
      expect(step.state.panels.diff.cursor).toBe(3);
      expect(step.state.pending).toBeNull();
    }

    const gg = press(insert, "g", "g");
    expect(gg.commands).toEqual([]);
    expect(gg.state.panels.diff.cursor).toBe(3);
    expect(gg.state.mode).toBe("insert");
  });

  it("TS-12: in insert mode panel switch keys are not commands either", () => {
    const insert = enterInsert(press(base(), "2").state);

    for (const digit of ["1", "3"]) {
      const step = press(insert, digit);
      expect(step.commands).toEqual([]);
      expect(step.state.activePanel).toBe("diff");
      expect(step.state.mode).toBe("insert");
    }
  });

  it("TS-12: Esc returns to normal mode from insert", () => {
    const insert = enterInsert(press(base(), "2", "j").state);

    const escaped = press(insert, "Escape");
    expect(escaped.commands).toEqual([{ type: "Escape" }]);
    expect(escaped.state.mode).toBe("normal");
    expect(escaped.state.panels.diff.cursor).toBe(1);

    const afterEscape = press(escaped.state, "j");
    expect(afterEscape.commands).toEqual([
      { type: "MoveCursor", panel: "diff", to: 2 },
    ]);
  });
});

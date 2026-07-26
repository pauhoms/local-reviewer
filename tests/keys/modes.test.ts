import { describe, it, expect } from "vitest";
import { DEFAULT_KEYMAPS } from "@/keys/keymap";
import type { Keymaps } from "@/keys/keymap";
import { enterInsert } from "@/keys/machine";
import { base, DIFF_ITEMS, key, press, pressWith } from "./helpers";

describe("visual to insert edge", () => {
  it("c in visual creates the comment and enters insert mode", () => {
    const step = press(base(), "2", "v", "j", "c");

    expect(step.commands).toEqual([
      { type: "CreateComment", panel: "diff", from: 0, to: 1 },
    ]);
    expect(step.state.mode).toBe("insert");
    expect(step.state.selection).toBeNull();
  });

  it("keys typed after c are swallowed instead of moving cursors", () => {
    const insert = press(base(), "2", "v", "j", "c").state;

    const typed = press(insert, "j", "k", "1", "g", "g");
    expect(typed.commands).toEqual([]);
    expect(typed.state.mode).toBe("insert");
    expect(typed.state.activePanel).toBe("diff");
    expect(typed.state.panels.diff.cursor).toBe(1);
  });

  it("Esc after c goes back to normal", () => {
    const insert = press(base(), "2", "v", "j", "c").state;

    const escaped = press(insert, "Escape");
    expect(escaped.commands).toEqual([{ type: "Escape" }]);
    expect(escaped.state.mode).toBe("normal");
  });

  it("enterInsert still reaches insert mode from normal", () => {
    expect(enterInsert(base()).mode).toBe("insert");
  });
});

describe("modifiers are part of the key identity", () => {
  it("Ctrl+c in visual copies instead of creating a comment", () => {
    const visual = press(base(), "2", "v", "j").state;

    const step = press(visual, key("c", { ctrl: true }));
    expect(step.commands).toEqual([]);
    expect(step.state.mode).toBe("visual");
    expect(step.state.selection).toEqual({ anchor: 0, head: 1 });
  });

  it("Ctrl+v does not enter visual mode", () => {
    const step = press(base(), "2", key("v", { ctrl: true }));
    expect(step.commands).toEqual([]);
    expect(step.state.mode).toBe("normal");
  });

  it("Meta+1 does not switch panel", () => {
    const step = press(base(), "2", key("1", { meta: true }));
    expect(step.commands).toEqual([]);
    expect(step.state.activePanel).toBe("diff");
  });

  it("Alt+j does not move the cursor", () => {
    const step = press(base(), "2", key("j", { alt: true }));
    expect(step.commands).toEqual([]);
    expect(step.state.panels.diff.cursor).toBe(0);
  });

  it("Shift keeps the bare key identity so G still jumps to the last item", () => {
    const step = press(base(), "2", key("G", { shift: true }));
    expect(step.commands).toEqual([
      { type: "MoveCursor", panel: "diff", to: DIFF_ITEMS - 1 },
    ]);
  });

  it("Escape ignores its modifiers so a late Ctrl release cannot trap the user", () => {
    const visual = press(base(), "2", "v").state;

    const left = press(visual, key("Escape", { ctrl: true }));
    expect(left.commands).toEqual([{ type: "Escape" }]);
    expect(left.state.mode).toBe("normal");
    expect(left.state.selection).toBeNull();

    const out = press(enterInsert(visual), key("Escape", { alt: true }));
    expect(out.commands).toEqual([{ type: "Escape" }]);
    expect(out.state.mode).toBe("normal");
  });
});

describe("every panel has its own table in visual", () => {
  it("panel switch keys keep the mode without borrowing the normal tables", () => {
    for (const digit of ["1", "3"]) {
      const step = press(base(), "2", "v", digit);
      expect(step.state.mode).toBe("visual");
    }
  });

  it("the tree only moves its cursor while visual is on", () => {
    const visual = press(base(), "2", "v", "1").state;
    expect(visual.activePanel).toBe("tree");

    const moved = press(visual, "j");
    expect(moved.commands).toEqual([{ type: "MoveCursor", panel: "tree", to: 1 }]);
    expect(moved.state.panels.tree.cursor).toBe(1);

    const back = press(moved.state, "k");
    expect(back.commands).toEqual([{ type: "MoveCursor", panel: "tree", to: 0 }]);

    for (const inert of ["h", "l", "Enter"]) {
      const step = press(moved.state, inert);
      expect(step.commands).toEqual([]);
      expect(step.state.panels.tree.cursor).toBe(1);
    }
  });

  it("the comments panel neither deletes nor confirms while visual is on", () => {
    const visual = press(base(), "2", "v", "3", "j", "j").state;
    expect(visual.panels.comments.cursor).toBe(2);

    const deleted = press(visual, "d", "d");
    expect(deleted.commands).toEqual([]);
    expect(deleted.state.pending).toBeNull();
    expect(deleted.state.panels.comments.cursor).toBe(2);

    for (const inert of ["Enter", "G"]) {
      expect(press(visual, inert).commands).toEqual([]);
    }
    expect(press(visual, "g", "g").commands).toEqual([]);

    const moved = press(visual, "k");
    expect(moved.commands).toEqual([{ type: "MoveCursor", panel: "comments", to: 1 }]);
  });

  it("the diff panel extends the selection instead of moving the cursor", () => {
    const visual = press(base(), "2", "v").state;

    const extended = press(visual, "j");
    expect(extended.commands).toEqual([{ type: "ExtendSelection", from: 0, to: 1 }]);

    const unbound = press(extended.state, "g", "g");
    expect(unbound.commands).toEqual([]);
    expect(unbound.state.panels.diff.cursor).toBe(1);
  });
});

describe("the pending buffer is armed by the keymap alone", () => {
  it("only keys that start a declared row of the active panel arm the buffer", () => {
    for (const armed of ["g", "d"]) {
      expect(press(base(), "3", armed).state.pending).toBe(armed);
    }

    for (const inert of ["j", "k", "1", "Enter", "z", "G"]) {
      expect(press(base(), "3", inert).state.pending).toBeNull();
    }
  });

  it("a sequence row of one panel does not arm the buffer of another", () => {
    expect(press(base(), "1", "g").state.pending).toBeNull();
    expect(press(base(), "2", "d").state.pending).toBeNull();
  });

  it("entering insert disarms the buffer so typing d does not delete an item", () => {
    const armed = press(base(), "3", "j", "d").state;
    expect(armed.pending).toBe("d");

    const insert = enterInsert(armed);
    expect(insert.pending).toBeNull();

    const typed = press(insert, "d");
    expect(typed.commands).toEqual([]);
    expect(typed.state.mode).toBe("insert");
  });

  it("a key that starts no declared row never arms the buffer", () => {
    expect(press(base(), "3", key("d", { ctrl: true })).state.pending).toBeNull();
    expect(press(base(), "3", key("g", { alt: true })).state.pending).toBeNull();
    expect(press(base(), "3", key("g", { meta: true })).state.pending).toBeNull();
  });
});

describe("a sequence prefix is any declared key id", () => {
  // Phase 7 declares the window shortcuts; adding the row must be all it takes.
  const withWindowSplit: Keymaps = {
    ...DEFAULT_KEYMAPS,
    normal: {
      ...DEFAULT_KEYMAPS.normal,
      panels: {
        ...DEFAULT_KEYMAPS.normal.panels,
        diff: {
          ...DEFAULT_KEYMAPS.normal.panels.diff,
          "Ctrl+w v": ({ panel }) => ({ type: "SwitchPanel", panel }),
        },
      },
    },
  };

  const onDiff = press(base(), "2").state;

  it("a row whose prefix carries a modifier arms the buffer and fires", () => {
    const armed = pressWith(withWindowSplit, onDiff, key("w", { ctrl: true }));
    expect(armed.commands).toEqual([]);
    expect(armed.state.pending).toBe("Ctrl+w");

    const fired = pressWith(withWindowSplit, armed.state, "v");
    expect(fired.commands).toEqual([{ type: "SwitchPanel", panel: "diff" }]);
    expect(fired.state.pending).toBeNull();
  });

  it("the second key of the sequence wins over its own standalone row", () => {
    const armed = pressWith(withWindowSplit, onDiff, key("w", { ctrl: true })).state;

    const fired = pressWith(withWindowSplit, armed, "v");
    expect(fired.state.mode).toBe("normal");
    expect(fired.state.selection).toBeNull();
  });

  it("a key outside the sequence still resolves on its own", () => {
    const armed = pressWith(withWindowSplit, onDiff, key("w", { ctrl: true })).state;

    const moved = pressWith(withWindowSplit, armed, "j");
    expect(moved.commands).toEqual([{ type: "MoveCursor", panel: "diff", to: 1 }]);
  });
});

describe("the pending buffer expires", () => {
  const armed = press(base(), "2", "j", "j", "j").state;

  it("a second g long after the first does not jump to the top", () => {
    const pending = press(armed, key("g", { at: 1_000 }));
    expect(pending.state.pending).toBe("g");

    const late = press(pending.state, key("g", { at: 602_000 }));
    expect(late.commands).toEqual([]);
    expect(late.state.panels.diff.cursor).toBe(3);
  });

  it("the late key arms the buffer again so a prompt double fires", () => {
    const late = press(armed, key("g", { at: 0 }), key("g", { at: 602_000 })).state;
    expect(late.pending).toBe("g");

    const jumped = press(late, key("g", { at: 602_200 }));
    expect(jumped.commands).toEqual([{ type: "MoveCursor", panel: "diff", to: 0 }]);
  });

  it("a double pressed within the timeout still fires", () => {
    const jumped = press(armed, key("g", { at: 5_000 }), key("g", { at: 5_400 }));
    expect(jumped.commands).toEqual([{ type: "MoveCursor", panel: "diff", to: 0 }]);
    expect(jumped.state.pending).toBeNull();
  });

  it("a double lands just inside the grace period", () => {
    const jumped = press(armed, key("g", { at: 0 }), key("g", { at: 999 }));
    expect(jumped.commands).toEqual([{ type: "MoveCursor", panel: "diff", to: 0 }]);
    expect(jumped.state.pending).toBeNull();
  });

  it("a double one millisecond past the grace period arms the buffer again", () => {
    const late = press(armed, key("g", { at: 0 }), key("g", { at: 1_001 }));
    expect(late.commands).toEqual([]);
    expect(late.state.panels.diff.cursor).toBe(3);
    expect(late.state.pending).toBe("g");
  });

  it("a key with no timestamp never expires the buffer", () => {
    const jumped = press(armed, "g", "g");
    expect(jumped.commands).toEqual([{ type: "MoveCursor", panel: "diff", to: 0 }]);
  });

  it("an expired prefix does not swallow the key that follows it", () => {
    const pending = press(armed, key("g", { at: 0 })).state;

    const moved = press(pending, key("j", { at: 602_000 }));
    expect(moved.commands).toEqual([{ type: "MoveCursor", panel: "diff", to: 4 }]);
  });
});

describe("the range a comment is anchored to", () => {
  it("comes out ordered when the selection grew upwards", () => {
    const step = press(base(), "2", "j", "j", "j", "v", "k", "k", "c");
    expect(step.commands).toEqual([
      { type: "CreateComment", panel: "diff", from: 1, to: 3 },
    ]);
  });

  it("comes out the same range when the selection grew downwards", () => {
    const step = press(base(), "2", "j", "v", "j", "j", "c");
    expect(step.commands).toEqual([
      { type: "CreateComment", panel: "diff", from: 1, to: 3 },
    ]);
  });

  // ExtendSelection stays directional on purpose: the head is where the cursor went,
  // and the next j/k has to know which end is moving.
  it("does not order ExtendSelection, which carries the direction instead", () => {
    const step = press(base(), "2", "j", "j", "j", "v", "k");
    expect(step.commands).toEqual([{ type: "ExtendSelection", from: 3, to: 2 }]);
    expect(step.state.selection).toEqual({ anchor: 3, head: 2 });
  });
});

describe("keys the diff panel does not answer yet", () => {
  // h/l get their meaning in phase 7, where the diff grows an active side.
  it("h and l emit nothing in the diff panel", () => {
    const onLine = press(base(), "2", "j").state;

    for (const deferred of ["h", "l"]) {
      const step = press(onLine, deferred);
      expect(step.commands).toEqual([]);
      expect(step.state.panels.diff.cursor).toBe(1);
    }
  });
});

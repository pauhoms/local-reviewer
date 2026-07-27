import { describe, expect, it } from "vitest";
import { DEFAULT_KEYMAPS } from "@/keys/keymap";
import { enterInsert } from "@/keys/machine";
import { base, key, press } from "./helpers";

describe("c hands the keyboard to the comment editor", () => {
  it("moves the active panel to the comments while entering insert", () => {
    const step = press(base(), "2", "v", "j", "c");

    expect(step.state.mode).toBe("insert");
    expect(step.state.activePanel).toBe("comments");
  });

  it("Esc gives the keyboard back to the panel the comment was made from", () => {
    const insert = press(base(), "2", "v", "j", "c").state;

    const back = press(insert, "Escape");

    expect(back.state.mode).toBe("normal");
    expect(back.state.activePanel).toBe("diff");
  });

  it("Ctrl+Enter saves and goes back the same way Esc does", () => {
    const insert = press(base(), "2", "v", "j", "c").state;

    const saved = press(insert, key("Enter", { ctrl: true }));

    expect(saved.commands).toEqual([{ type: "SaveComment" }]);
    expect(saved.state.mode).toBe("normal");
    expect(saved.state.activePanel).toBe("diff");
  });

  it("a plain Enter while writing is text, not a save", () => {
    const insert = press(base(), "2", "v", "j", "c").state;

    const typed = press(insert, "Enter");

    expect(typed.commands).toEqual([]);
    expect(typed.state.mode).toBe("insert");
  });

  it("Ctrl+Enter outside insert does nothing", () => {
    const step = press(base(), "3", key("Enter", { ctrl: true }));

    expect(step.commands).toEqual([]);
    expect(step.state.mode).toBe("normal");
  });

  it("leaving an insert nobody navigated into keeps the panel where it was", () => {
    const step = press(enterInsert(press(base(), "3").state), "Escape");

    expect(step.state.activePanel).toBe("comments");
  });

  it("the cursor of the comments panel is not moved by the trip into insert", () => {
    const walked = press(base(), "3", "j", "j").state;
    expect(walked.panels.comments.cursor).toBe(2);

    const written = press(walked, "2", "v", "c", "Escape").state;

    expect(written.panels.comments.cursor).toBe(2);
  });
});

describe("the comments panel folds its entries", () => {
  it("zc folds the entry under the cursor and zo unfolds it", () => {
    const onComments = press(base(), "3", "j").state;

    expect(press(onComments, "z", "c").commands).toEqual([
      { type: "ToggleFold", panel: "comments", index: 1, open: false },
    ]);
    expect(press(onComments, "z", "o").commands).toEqual([
      { type: "ToggleFold", panel: "comments", index: 1, open: true },
    ]);
  });

  it("z alone arms the buffer and any other key after it does nothing", () => {
    const armed = press(base(), "3", "z");
    expect(armed.state.pending).toBe("z");

    const dropped = press(armed.state, "x");
    expect(dropped.commands).toEqual([]);
    expect(dropped.state.pending).toBeNull();
  });

  it("z is inert in the tree and in the diff, which fold with h and l", () => {
    for (const panel of ["1", "2"]) {
      expect(press(base(), panel, "z").state.pending).toBeNull();
    }
  });

  it("zc while writing a comment is typed instead of folding", () => {
    const insert = press(base(), "2", "v", "c").state;

    const typed = press(insert, "z", "c");

    expect(typed.commands).toEqual([]);
    expect(typed.state.mode).toBe("insert");
  });
});

describe("c needs lines to anchor to", () => {
  it("the default table still answers c with the selection it was given", () => {
    expect(DEFAULT_KEYMAPS.visual.panels.diff?.c).toBeDefined();
  });
});

import { describe, expect, it } from "vitest";
import { foldingKeymaps } from "@/keys/keymap";
import type { FoldRow } from "@/keys/keymap";
import { initialState, setCursor, setItemCount } from "@/keys/machine";
import type { MachineState } from "@/keys/types";
import { pressWith } from "../keys/helpers";

/** src (dir) → domain (dir, collapsed) / app.ts (file); readme.md at the top level. */
const ROWS: FoldRow[] = [
  { foldable: true, expanded: true, parent: null },
  { foldable: true, expanded: false, parent: 0 },
  { foldable: false, expanded: false, parent: 0 },
  { foldable: false, expanded: false, parent: null },
];

function atRow(index: number, rows: FoldRow[] = ROWS): MachineState {
  let state = setItemCount(initialState(), "tree", rows.length);
  state = setCursor(state, "tree", index);
  return state;
}

describe("foldingKeymaps", () => {
  it("h closes the folder under the cursor when it is open", () => {
    const { commands } = pressWith(foldingKeymaps(() => ROWS), atRow(0), "h");

    expect(commands).toEqual([{ type: "ToggleFold", panel: "tree", index: 0, open: false }]);
  });

  it("h walks up to the row holding a folder that is already closed", () => {
    const { commands } = pressWith(foldingKeymaps(() => ROWS), atRow(1), "h");

    expect(commands).toEqual([{ type: "MoveCursor", panel: "tree", to: 0 }]);
  });

  it("h walks up from a file without folding anything", () => {
    const { commands } = pressWith(foldingKeymaps(() => ROWS), atRow(2), "h");

    expect(commands).toEqual([{ type: "MoveCursor", panel: "tree", to: 0 }]);
  });

  it("h answers nothing on a top level row with nothing above it", () => {
    expect(pressWith(foldingKeymaps(() => ROWS), atRow(3), "h").commands).toEqual([]);
  });

  it("l opens the folder under the cursor when it is closed", () => {
    const { commands } = pressWith(foldingKeymaps(() => ROWS), atRow(1), "l");

    expect(commands).toEqual([{ type: "ToggleFold", panel: "tree", index: 1, open: true }]);
  });

  it("l answers nothing on a folder that is already open or on a file", () => {
    expect(pressWith(foldingKeymaps(() => ROWS), atRow(0), "l").commands).toEqual([]);
    expect(pressWith(foldingKeymaps(() => ROWS), atRow(2), "l").commands).toEqual([]);
  });

  it("answers nothing when there is no row under the cursor", () => {
    const empty = foldingKeymaps(() => []);

    expect(pressWith(empty, atRow(0, []), "h").commands).toEqual([]);
    expect(pressWith(empty, atRow(0, []), "l").commands).toEqual([]);
  });

  it("leaves the other rows of the tree and the other panels as they are", () => {
    const keymaps = foldingKeymaps(() => ROWS);

    expect(pressWith(keymaps, atRow(0), "j").commands).toEqual([
      { type: "MoveCursor", panel: "tree", to: 1 },
    ]);
    expect(pressWith(keymaps, atRow(0), "2", "v").commands).toEqual([{ type: "EnterVisual" }]);
  });
});

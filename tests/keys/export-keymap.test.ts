/**
 * The two rows of the toolbar. They are global to the review — no panel owns
 * exporting — and they only answer in normal mode: in insert every key is text,
 * and in visual there is a range open that neither of them has anything to do
 * with.
 */

import { describe, expect, it } from "vitest";
import { COPY_PATH_KEY, EXPORT_KEY, reviewKeymaps, START_KEYMAPS } from "@/keys/keymap";
import type { DiffMetrics } from "@/keys/keymap";
import { enterInsert, reduce } from "@/keys/machine";
import type { MachineState, Panel } from "@/keys/types";
import { base, key, pressWith } from "./helpers";

const METRICS: DiffMetrics = { lineCount: 12, pageSize: 8, view: "unified", side: "new" };
const KEYMAPS = reviewKeymaps(
  () => [],
  () => METRICS,
  () => 0,
);

const PANEL_KEYS: Record<Panel, string> = { tree: "1", diff: "2", comments: "3" };

function on(panel: Panel, state: MachineState = base()): MachineState {
  return pressWith(KEYMAPS, state, PANEL_KEYS[panel]).state;
}

describe("the export rows answer from anywhere in the review", () => {
  const PANELS: Panel[] = ["tree", "diff", "comments"];

  it("asks for the export from every panel", () => {
    for (const panel of PANELS) {
      expect(pressWith(KEYMAPS, on(panel), EXPORT_KEY).commands).toEqual([
        { type: "ExportReview" },
      ]);
    }
  });

  it("asks for the copy from every panel", () => {
    for (const panel of PANELS) {
      expect(pressWith(KEYMAPS, on(panel), COPY_PATH_KEY).commands).toEqual([{ type: "CopyPath" }]);
    }
  });

  it("takes two different keys, so one cannot do the other's work", () => {
    expect(EXPORT_KEY).not.toBe(COPY_PATH_KEY);
  });

  it("leaves the mode, the panel and the cursors exactly where they were", () => {
    const before = pressWith(KEYMAPS, on("diff"), "j", "j").state;

    const after = pressWith(KEYMAPS, before, EXPORT_KEY, COPY_PATH_KEY).state;

    expect(after).toEqual(before);
  });

  it("says nothing while a comment is being written", () => {
    const writing = enterInsert(on("comments"));

    expect(pressWith(KEYMAPS, writing, EXPORT_KEY).commands).toEqual([]);
    expect(pressWith(KEYMAPS, writing, COPY_PATH_KEY).commands).toEqual([]);
    expect(pressWith(KEYMAPS, writing, EXPORT_KEY).state.mode).toBe("insert");
  });

  it("says nothing with a range open, which is not what either key is for", () => {
    const selecting = pressWith(KEYMAPS, on("diff"), "v").state;

    expect(pressWith(KEYMAPS, selecting, EXPORT_KEY).commands).toEqual([]);
    expect(pressWith(KEYMAPS, selecting, COPY_PATH_KEY).commands).toEqual([]);
  });

  it("is not in the picker, which has no review to export", () => {
    expect(pressWith(START_KEYMAPS, base(), EXPORT_KEY).commands).toEqual([]);
    expect(pressWith(START_KEYMAPS, base(), COPY_PATH_KEY).commands).toEqual([]);
  });
});

/**
 * Held down, these rows would write a file per repeat: the OS sends a keydown
 * for every one, and nothing downstream tells them apart from real presses.
 */
describe("a held key does not export over and over", () => {
  it("answers the first press of e and stays quiet while it repeats", () => {
    expect(pressWith(KEYMAPS, base(), EXPORT_KEY).commands).toEqual([{ type: "ExportReview" }]);

    const held = reduce(base(), { ...key(EXPORT_KEY), repeat: true }, KEYMAPS);
    expect(held.commands).toEqual([]);
  });

  it("does the same for y, so a held key copies once", () => {
    expect(pressWith(KEYMAPS, base(), COPY_PATH_KEY).commands).toEqual([{ type: "CopyPath" }]);

    const held = reduce(base(), { ...key(COPY_PATH_KEY), repeat: true }, KEYMAPS);
    expect(held.commands).toEqual([]);
  });

  it("leaves moving alone: holding j is how a long file is walked", () => {
    const held = reduce(on("diff"), { ...key("j"), repeat: true }, KEYMAPS);
    expect(held.commands).not.toEqual([]);
  });
});

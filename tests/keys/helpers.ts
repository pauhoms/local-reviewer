import { screen, within } from "@testing-library/react";
import { DEFAULT_KEYMAPS } from "@/keys/keymap";
import type { Keymaps } from "@/keys/keymap";
import { initialState, reduce, setItemCount, setPageSize } from "@/keys/machine";
import type { Command, KeyEvent, MachineState, Panel } from "@/keys/types";

export const TREE_ITEMS = 4;
export const DIFF_ITEMS = 20;
export const COMMENT_ITEMS = 6;
export const DIFF_PAGE = 10;

export function key(k: string, mods: Partial<Omit<KeyEvent, "key">> = {}): KeyEvent {
  return { key: k, ctrl: false, shift: false, alt: false, meta: false, ...mods };
}

export function base(): MachineState {
  let state = initialState();
  state = setItemCount(state, "tree", TREE_ITEMS);
  state = setItemCount(state, "diff", DIFF_ITEMS);
  state = setItemCount(state, "comments", COMMENT_ITEMS);
  state = setPageSize(state, "tree", TREE_ITEMS);
  state = setPageSize(state, "diff", DIFF_PAGE);
  state = setPageSize(state, "comments", COMMENT_ITEMS);
  return state;
}

export function pressWith(
  keymaps: Keymaps,
  state: MachineState,
  ...keys: Array<string | KeyEvent>
): { state: MachineState; commands: Command[] } {
  let next = state;
  let commands: Command[] = [];
  for (const k of keys) {
    const step = reduce(next, typeof k === "string" ? key(k) : k, keymaps);
    next = step.state;
    commands = step.commands;
  }
  return { state: next, commands };
}

/** Applies keys in order; `commands` are the ones emitted by the *last* key. */
export function press(
  state: MachineState,
  ...keys: Array<string | KeyEvent>
): { state: MachineState; commands: Command[] } {
  return pressWith(DEFAULT_KEYMAPS, state, ...keys);
}

const PANEL_TITLES: Record<Panel, RegExp> = {
  tree: /^1 ÁRBOL/,
  diff: /^2 DIFF/,
  comments: /^3 COMENTARIOS/,
};

export function panel(name: Panel): HTMLElement {
  return screen.getByRole("region", { name: PANEL_TITLES[name] });
}

export function options(name: Panel): HTMLElement[] {
  return within(panel(name)).getAllByRole("option");
}

export function selectedIndexes(name: Panel): number[] {
  return options(name).flatMap((option, index) =>
    option.getAttribute("aria-selected") === "true" ? [index] : [],
  );
}

export function headIndex(name: Panel): number {
  return options(name).findIndex((option) => option.getAttribute("data-cursor") === "true");
}

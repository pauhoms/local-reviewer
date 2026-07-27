import { useCallback, useEffect, useRef, useState } from "react";
import { DEFAULT_KEYMAPS } from "./keymap";
import type { Keymaps } from "./keymap";
import {
  initialState,
  PANELS,
  placeCursor,
  reduce,
  setCursor,
  setItemCount,
  setPageSize,
} from "./machine";
import type { Command, KeyEvent, MachineState, Panel } from "./types";

export interface PanelConfig {
  itemCount: number;
  pageSize: number;
  /** Identity of the list on show: a new one starts under the cursor again. */
  listId?: string;
  /** Where the cursor is for a panel that keeps it outside the machine, read at
   *  the moment the key lands: a command of the same burst may have moved it. */
  cursorNow?: () => number;
}

export type KeyboardConfig = Record<Panel, PanelConfig>;

/** A screen with nothing to walk through: only keys that need no list answer. */
export const NO_LISTS: KeyboardConfig = {
  tree: { itemCount: 0, pageSize: 0 },
  diff: { itemCount: 0, pageSize: 0 },
  comments: { itemCount: 0, pageSize: 0 },
};

function normalizeEvent(event: KeyboardEvent): KeyEvent {
  return {
    key: event.key,
    ctrl: event.ctrlKey,
    shift: event.shiftKey,
    alt: event.altKey,
    meta: event.metaKey,
    at: event.timeStamp,
    repeat: event.repeat,
  };
}

/** The browser scrolls the page on Ctrl+d/Ctrl+u; the machine owns that shortcut instead. */
function stealsBrowserDefault(event: KeyEvent): boolean {
  return event.ctrl && (event.key === "d" || event.key === "u");
}

type ListIds = Partial<Record<Panel, string | undefined>>;

function applyConfig(state: MachineState, config: KeyboardConfig): MachineState {
  let next = state;
  for (const panel of PANELS) {
    next = setItemCount(next, panel, config[panel].itemCount);
    next = setPageSize(next, panel, config[panel].pageSize);
  }
  return next;
}

function syncConfig(state: MachineState, config: KeyboardConfig, listIds: ListIds): MachineState {
  let next = applyConfig(state, config);
  for (const panel of PANELS) {
    const listId = config[panel].listId;
    if (listId !== listIds[panel]) {
      listIds[panel] = listId;
      next = setCursor(next, panel, 0);
    }
  }
  return next;
}

function adoptCursors(state: MachineState, config: KeyboardConfig): MachineState {
  let next = state;
  for (const panel of PANELS) {
    const cursor = config[panel].cursorNow?.();
    if (cursor !== undefined) next = placeCursor(next, panel, cursor);
  }
  return next;
}

export function useKeyboard(
  config: KeyboardConfig,
  onCommands?: (commands: Command[]) => void,
  keymaps: Keymaps = DEFAULT_KEYMAPS,
): MachineState {
  // The handler reduces off this ref, never inside the setState updater: React may
  // replay an updater, and replaying it would emit the same command twice.
  const stateRef = useRef<MachineState | null>(null);
  if (stateRef.current === null) stateRef.current = applyConfig(initialState(), config);

  const onCommandsRef = useRef(onCommands);
  const keymapsRef = useRef(keymaps);
  const configRef = useRef(config);
  const listIdsRef = useRef<ListIds>({});
  const [, bumpRender] = useState(0);

  // Written while rendering, not from a passive effect. The rows a panel walks
  // change as an answer to its own commands, so a key that lands before React
  // flushes its effects would otherwise reduce against the previous render:
  // the cursor would end up on one row and the diff panel on another file.
  onCommandsRef.current = onCommands;
  keymapsRef.current = keymaps;
  configRef.current = config;
  stateRef.current = syncConfig(stateRef.current, config, listIdsRef.current);

  const commit = useCallback((next: MachineState): void => {
    stateRef.current = next;
    bumpRender((tick) => tick + 1);
  }, []);

  useEffect(() => {
    function handleKeyDown(nativeEvent: KeyboardEvent): void {
      const event = normalizeEvent(nativeEvent);
      const current = adoptCursors(stateRef.current ?? initialState(), configRef.current);
      const step = reduce(current, event, keymapsRef.current);

      // Only a key the machine actually answers is worth stealing: elsewhere the shortcut
      // would be inert *and* blocked, which is worse than leaving it to the browser.
      const answered = step.commands.length > 0 || step.state.pending !== null;
      // The key that opens the editor focuses it before the browser is done with
      // the event, so its own character would land inside the field it opened.
      const opensEditor = current.mode !== "insert" && step.state.mode === "insert";
      const steal = opensEditor || (answered && stealsBrowserDefault(event));
      if (steal && nativeEvent.cancelable) {
        nativeEvent.preventDefault();
      }

      commit(step.state);
      if (step.commands.length > 0) onCommandsRef.current?.(step.commands);
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [commit]);

  return stateRef.current;
}

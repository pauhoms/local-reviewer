import { useCallback, useEffect, useRef, useState } from "react";
import { initialState, PANELS, reduce, setItemCount, setPageSize } from "./machine";
import type { Command, KeyEvent, MachineState, Panel } from "./types";

export interface PanelConfig {
  itemCount: number;
  pageSize: number;
}

export type KeyboardConfig = Record<Panel, PanelConfig>;

function normalizeEvent(event: KeyboardEvent): KeyEvent {
  return {
    key: event.key,
    ctrl: event.ctrlKey,
    shift: event.shiftKey,
    alt: event.altKey,
    meta: event.metaKey,
    at: event.timeStamp,
  };
}

/** The browser scrolls the page on Ctrl+d/Ctrl+u; the machine owns that shortcut instead. */
function stealsBrowserDefault(event: KeyEvent): boolean {
  return event.ctrl && (event.key === "d" || event.key === "u");
}

function applyConfig(state: MachineState, config: KeyboardConfig): MachineState {
  let next = state;
  for (const panel of PANELS) {
    next = setItemCount(next, panel, config[panel].itemCount);
    next = setPageSize(next, panel, config[panel].pageSize);
  }
  return next;
}

export function useKeyboard(
  config: KeyboardConfig,
  onCommands?: (commands: Command[]) => void,
): MachineState {
  const [state, setState] = useState<MachineState>(() => applyConfig(initialState(), config));

  // The handler reduces off this ref, never inside the setState updater: React may
  // replay an updater, and replaying it would emit the same command twice.
  const stateRef = useRef(state);
  const onCommandsRef = useRef(onCommands);

  useEffect(() => {
    onCommandsRef.current = onCommands;
  });

  const commit = useCallback((next: MachineState): void => {
    stateRef.current = next;
    setState(next);
  }, []);

  useEffect(() => {
    function handleKeyDown(nativeEvent: KeyboardEvent): void {
      const event = normalizeEvent(nativeEvent);
      const step = reduce(stateRef.current, event);

      // Only a key the machine actually answers is worth stealing: elsewhere the shortcut
      // would be inert *and* blocked, which is worse than leaving it to the browser.
      const answered = step.commands.length > 0 || step.state.pending !== null;
      if (answered && stealsBrowserDefault(event) && nativeEvent.cancelable) {
        nativeEvent.preventDefault();
      }

      commit(step.state);
      if (step.commands.length > 0) onCommandsRef.current?.(step.commands);
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [commit]);

  useEffect(() => {
    commit(applyConfig(stateRef.current, config));
    // Compared by value: an inline config literal would loop on identity.
  }, [
    commit,
    config.tree.itemCount,
    config.tree.pageSize,
    config.diff.itemCount,
    config.diff.pageSize,
    config.comments.itemCount,
    config.comments.pageSize,
  ]);

  return state;
}

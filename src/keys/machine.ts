import { DEFAULT_KEYMAPS, hasSequenceStart, lookupBinding, lookupSequence } from "./keymap";
import type { Binding, Keymaps } from "./keymap";
import type { Command, KeyEvent, MachineState, Panel, PanelState } from "./types";

const PANELS: Panel[] = ["tree", "diff", "comments"];

const MODIFIER_KEYS = new Set(["Shift", "Control", "Alt", "Meta"]);

/** Same grace period as Vim's `timeoutlen`. */
const PENDING_TIMEOUT_MS = 1000;

export interface Step {
  state: MachineState;
  commands: Command[];
}

function emptyPanelState(): PanelState {
  return { cursor: 0, itemCount: 0, pageSize: 0 };
}

export function initialState(): MachineState {
  return {
    mode: "normal",
    activePanel: "tree",
    panels: {
      tree: emptyPanelState(),
      diff: emptyPanelState(),
      comments: emptyPanelState(),
    },
    selection: null,
    pending: null,
    pendingAt: null,
  };
}

function updatePanel(
  state: MachineState,
  panel: Panel,
  update: (panelState: PanelState) => PanelState,
): MachineState {
  return { ...state, panels: { ...state.panels, [panel]: update(state.panels[panel]) } };
}

function clamp(value: number, itemCount: number): number {
  if (itemCount <= 0) return 0;
  return Math.min(Math.max(value, 0), itemCount - 1);
}

export function setItemCount(state: MachineState, panel: Panel, itemCount: number): MachineState {
  return updatePanel(state, panel, (panelState) => ({
    ...panelState,
    itemCount,
    cursor: clamp(panelState.cursor, itemCount),
  }));
}

export function setPageSize(state: MachineState, panel: Panel, pageSize: number): MachineState {
  return updatePanel(state, panel, (panelState) => ({ ...panelState, pageSize }));
}

export function enterInsert(state: MachineState): MachineState {
  return { ...clearPending(state), mode: "insert" };
}

/** Shift is left out on purpose: it already shows up in `event.key` (`G`, `?`, …). */
function keyId(event: KeyEvent): string {
  // Vim ignores modifiers on <Esc>; releasing Ctrl late must not trap the user in insert.
  if (event.key === "Escape") return event.key;

  const parts: string[] = [];
  if (event.ctrl) parts.push("Ctrl");
  if (event.alt) parts.push("Alt");
  if (event.meta) parts.push("Meta");
  parts.push(event.key);
  return parts.join("+");
}

function applyCommand(state: MachineState, command: Command): MachineState {
  switch (command.type) {
    case "MoveCursor":
      return updatePanel(state, command.panel, (panelState) => ({
        ...panelState,
        cursor: command.to,
      }));
    case "SwitchPanel":
      return { ...state, activePanel: command.panel };
    case "EnterVisual": {
      const cursor = state.panels[state.activePanel].cursor;
      return { ...state, mode: "visual", selection: { anchor: cursor, head: cursor } };
    }
    case "ExtendSelection":
      return updatePanel(
        { ...state, selection: { anchor: command.from, head: command.to } },
        state.activePanel,
        (panelState) => ({ ...panelState, cursor: command.to }),
      );
    case "Escape":
      if (state.mode === "insert") return { ...state, mode: "normal" };
      if (state.mode === "visual") return { ...state, mode: "normal", selection: null };
      return state;
    case "CreateComment":
      return enterInsert({ ...state, selection: null });
    case "Confirm":
    case "DeleteItem":
    case "ToggleFold":
      return state;
  }
}

function applyBinding(state: MachineState, binding: Binding | undefined): Step {
  if (!binding) return { state, commands: [] };
  const panel = state.activePanel;
  const panelState = state.panels[panel];
  const command = binding({ panel, panelState, selection: state.selection });
  if (!command) return { state, commands: [] };
  return { state: applyCommand(state, command), commands: [command] };
}

function clearPending(state: MachineState): MachineState {
  return { ...state, pending: null, pendingAt: null };
}

function isStale(state: MachineState, event: KeyEvent): boolean {
  if (state.pendingAt === null || event.at === undefined) return false;
  return event.at - state.pendingAt > PENDING_TIMEOUT_MS;
}

function resolvePending(
  keymaps: Keymaps,
  state: MachineState,
  event: KeyEvent,
  prefix: string,
): Step {
  const cleared = clearPending(state);
  const { mode, activePanel } = cleared;
  const binding = lookupSequence(keymaps, mode, activePanel, prefix, keyId(event));
  if (!binding) return reduce(cleared, event, keymaps);
  return applyBinding(cleared, binding);
}

export function reduce(
  state: MachineState,
  event: KeyEvent,
  keymaps: Keymaps = DEFAULT_KEYMAPS,
): Step {
  if (MODIFIER_KEYS.has(event.key)) return { state, commands: [] };

  const current = isStale(state, event) ? clearPending(state) : state;
  const { mode, activePanel } = current;
  const id = keyId(event);

  // Defensive: `enterInsert` disarms the buffer, so insert should never see a pending
  // prefix; the guard holds the contract if a later phase gives insert rows of its own.
  if (mode !== "insert" && current.pending) {
    return resolvePending(keymaps, current, event, current.pending);
  }

  if (hasSequenceStart(keymaps, mode, activePanel, id)) {
    return { state: { ...current, pending: id, pendingAt: event.at ?? null }, commands: [] };
  }

  return applyBinding(current, lookupBinding(keymaps, mode, activePanel, id));
}

export { PANELS };

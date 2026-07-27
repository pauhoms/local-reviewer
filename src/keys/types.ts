import type { DiffView, Side } from "@/ipc/types";

export type Mode = "normal" | "visual" | "insert";

export type Panel = "tree" | "diff" | "comments";

export interface KeyEvent {
  key: string;
  ctrl: boolean;
  shift: boolean;
  alt: boolean;
  meta: boolean;
  /** Milliseconds from whoever owns the clock; the machine never reads one itself. */
  at?: number;
}

export type Command =
  | { type: "MoveCursor"; panel: Panel; to: number }
  | { type: "SwitchPanel"; panel: Panel }
  | { type: "EnterVisual" }
  | { type: "ExtendSelection"; from: number; to: number }
  | { type: "Escape" }
  | { type: "CreateComment"; panel: Panel; from: number; to: number }
  | { type: "SaveComment" }
  | { type: "Confirm"; panel: Panel; index: number }
  | { type: "Descend"; panel: Panel; index: number }
  | { type: "Ascend"; panel: Panel }
  | { type: "DeleteItem"; panel: Panel; index: number }
  | { type: "ToggleFold"; panel: Panel; index: number; open: boolean }
  | { type: "SetView"; view: DiffView }
  | { type: "SetSide"; side: Side };

export interface PanelState {
  cursor: number;
  itemCount: number;
  pageSize: number;
}

export interface Selection {
  anchor: number;
  head: number;
}

export interface MachineState {
  mode: Mode;
  activePanel: Panel;
  panels: Record<Panel, PanelState>;
  selection: Selection | null;
  /** Panel the keyboard goes back to when insert ends, whichever way it ends. */
  insertOrigin: Panel | null;
  pending: string | null;
  pendingAt: number | null;
}

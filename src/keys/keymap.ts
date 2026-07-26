import { selectionRange } from "./selection";
import type { Command, Mode, Panel, PanelState, Selection } from "./types";

export interface BindingContext {
  panel: Panel;
  panelState: PanelState;
  selection: Selection | null;
}

export type Binding = (ctx: BindingContext) => Command | null;

export type PanelKeymap = Partial<Record<string, Binding>>;
export type PanelKeymaps = Partial<Record<Panel, PanelKeymap>>;

export interface ModeKeymap {
  global: PanelKeymap;
  panels: PanelKeymaps;
}

export type Keymaps = Record<Mode, ModeKeymap>;

/** Rows of more than one key are declared as key ids joined by this separator. */
const SEQUENCE_SEPARATOR = " ";

function clamp(value: number, itemCount: number): number {
  if (itemCount <= 0) return 0;
  return Math.min(Math.max(value, 0), itemCount - 1);
}

const moveDown: Binding = ({ panel, panelState }) => ({
  type: "MoveCursor",
  panel,
  to: clamp(panelState.cursor + 1, panelState.itemCount),
});

const moveUp: Binding = ({ panel, panelState }) => ({
  type: "MoveCursor",
  panel,
  to: clamp(panelState.cursor - 1, panelState.itemCount),
});

const jumpTop: Binding = ({ panel }) => ({ type: "MoveCursor", panel, to: 0 });

const jumpBottom: Binding = ({ panel, panelState }) => ({
  type: "MoveCursor",
  panel,
  to: clamp(panelState.itemCount - 1, panelState.itemCount),
});

const halfPageDown: Binding = ({ panel, panelState }) => ({
  type: "MoveCursor",
  panel,
  to: clamp(panelState.cursor + Math.floor(panelState.pageSize / 2), panelState.itemCount),
});

const halfPageUp: Binding = ({ panel, panelState }) => ({
  type: "MoveCursor",
  panel,
  to: clamp(panelState.cursor - Math.floor(panelState.pageSize / 2), panelState.itemCount),
});

const confirm: Binding = ({ panel, panelState }) => ({
  type: "Confirm",
  panel,
  index: panelState.cursor,
});

const foldClose: Binding = ({ panel, panelState }) => ({
  type: "ToggleFold",
  panel,
  index: panelState.cursor,
  open: false,
});

const foldOpen: Binding = ({ panel, panelState }) => ({
  type: "ToggleFold",
  panel,
  index: panelState.cursor,
  open: true,
});

const deleteItem: Binding = ({ panel, panelState }) => ({
  type: "DeleteItem",
  panel,
  index: panelState.cursor,
});

const descend: Binding = ({ panel, panelState }) => ({
  type: "Descend",
  panel,
  index: panelState.cursor,
});

const ascend: Binding = ({ panel }) => ({ type: "Ascend", panel });

const enterVisual: Binding = () => ({ type: "EnterVisual" });

const extendDown: Binding = ({ panelState, selection }) => {
  if (!selection) return null;
  return {
    type: "ExtendSelection",
    from: selection.anchor,
    to: clamp(panelState.cursor + 1, panelState.itemCount),
  };
};

const extendUp: Binding = ({ panelState, selection }) => {
  if (!selection) return null;
  return {
    type: "ExtendSelection",
    from: selection.anchor,
    to: clamp(panelState.cursor - 1, panelState.itemCount),
  };
};

/** Which panel takes the focus once the comment editor exists is deferred to phase 6. */
const createComment: Binding = ({ panel, selection }) => {
  if (!selection) return null;
  return { type: "CreateComment", panel, ...selectionRange(selection) };
};

const switchPanel =
  (panel: Panel): Binding =>
  () => ({ type: "SwitchPanel", panel });

const escape: Binding = () => ({ type: "Escape" });

const GLOBAL_KEYMAP: PanelKeymap = {
  "1": switchPanel("tree"),
  "2": switchPanel("diff"),
  "3": switchPanel("comments"),
  Escape: escape,
};

const NORMAL_PANELS: PanelKeymaps = {
  tree: {
    j: moveDown,
    k: moveUp,
    h: foldClose,
    l: foldOpen,
    Enter: confirm,
  },
  diff: {
    j: moveDown,
    k: moveUp,
    "g g": jumpTop,
    G: jumpBottom,
    "Ctrl+d": halfPageDown,
    "Ctrl+u": halfPageUp,
    v: enterVisual,
  },
  comments: {
    j: moveDown,
    k: moveUp,
    "g g": jumpTop,
    G: jumpBottom,
    Enter: confirm,
    "d d": deleteItem,
  },
};

/** Outside the diff there is no range to extend, so j/k stay plain movement. */
const VISUAL_PANELS: PanelKeymaps = {
  tree: {
    j: moveDown,
    k: moveUp,
  },
  diff: {
    j: extendDown,
    k: extendUp,
    c: createComment,
  },
  comments: {
    j: moveDown,
    k: moveUp,
  },
};

export const DEFAULT_KEYMAPS: Keymaps = {
  normal: { global: GLOBAL_KEYMAP, panels: NORMAL_PANELS },
  visual: { global: GLOBAL_KEYMAP, panels: VISUAL_PANELS },
  insert: { global: { Escape: escape }, panels: {} },
};

/** The picker: three lists, one of which is a directory tree to walk. */
const START_PANELS: PanelKeymaps = {
  tree: {
    j: moveDown,
    k: moveUp,
    Enter: confirm,
  },
  diff: {
    j: moveDown,
    k: moveUp,
    Enter: confirm,
    l: descend,
    h: ascend,
  },
  comments: {
    j: moveDown,
    k: moveUp,
    Enter: confirm,
  },
};

export const START_KEYMAPS: Keymaps = {
  normal: { global: GLOBAL_KEYMAP, panels: START_PANELS },
  // No row of the picker enters visual or insert; these tables only keep Esc
  // answering if the app ever lands in one of them.
  visual: { global: GLOBAL_KEYMAP, panels: {} },
  insert: { global: { Escape: escape }, panels: {} },
};

function tablesFor(keymaps: Keymaps, mode: Mode, panel: Panel): PanelKeymap[] {
  const keymap = keymaps[mode];
  const panelTable = keymap.panels[panel];
  return panelTable ? [panelTable, keymap.global] : [keymap.global];
}

export function lookupBinding(
  keymaps: Keymaps,
  mode: Mode,
  panel: Panel,
  keyId: string,
): Binding | undefined {
  for (const table of tablesFor(keymaps, mode, panel)) {
    const binding = table[keyId];
    if (binding) return binding;
  }
  return undefined;
}

export function lookupSequence(
  keymaps: Keymaps,
  mode: Mode,
  panel: Panel,
  prefix: string,
  keyId: string,
): Binding | undefined {
  return lookupBinding(keymaps, mode, panel, prefix + SEQUENCE_SEPARATOR + keyId);
}

export function hasSequenceStart(
  keymaps: Keymaps,
  mode: Mode,
  panel: Panel,
  prefix: string,
): boolean {
  const start = prefix + SEQUENCE_SEPARATOR;
  return tablesFor(keymaps, mode, panel).some((table) =>
    Object.keys(table).some((row) => row.startsWith(start)),
  );
}

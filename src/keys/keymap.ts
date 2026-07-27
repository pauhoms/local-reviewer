import type { DiffView, Side } from "@/ipc/types";
import { selectionRange } from "./selection";
import type { Command, Mode, Panel, PanelState, Selection } from "./types";

/**
 * What a foldable list says about one visible row: the panel state alone cannot
 * tell whether `h` should close a folder or walk up to the one holding it.
 */
export interface FoldRow {
  foldable: boolean;
  expanded: boolean;
  /** Index of the row that holds this one, `null` at the top level. */
  parent: number | null;
}

export interface BindingContext {
  panel: Panel;
  panelState: PanelState;
  selection: Selection | null;
  /** Set while the OS repeats a held key, so a row that writes to disk can opt out. */
  repeat: boolean;
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

const createComment: Binding = ({ panel, selection }) => {
  if (!selection) return null;
  return { type: "CreateComment", panel, ...selectionRange(selection) };
};

const saveComment: Binding = () => ({ type: "SaveComment" });

const switchPanel =
  (panel: Panel): Binding =>
  () => ({ type: "SwitchPanel", panel });

const escape: Binding = () => ({ type: "Escape" });

/** `y` for the copy, the way Vim yanks; `e` is what the action is called. */
export const EXPORT_KEY = "y";
export const COPY_PATH_KEY = "e";

// Held down, these would write a file per repeat and litter the reviews
// directory. Moving costs nothing on repeat; writing does.
const exportReview: Binding = ({ repeat }) => (repeat ? null : { type: "ExportReview" });

const copyPath: Binding = ({ repeat }) => (repeat ? null : { type: "CopyPath" });

const GLOBAL_KEYMAP: PanelKeymap = {
  "1": switchPanel("tree"),
  "2": switchPanel("diff"),
  "3": switchPanel("comments"),
  Escape: escape,
};

/** Only in the review: the picker has nothing exported and nothing to export. */
const TOOLBAR_KEYMAP: PanelKeymap = {
  ...GLOBAL_KEYMAP,
  [EXPORT_KEY]: exportReview,
  [COPY_PATH_KEY]: copyPath,
};

/**
 * `h`/`l` here are the fallback: `ReviewShell` always hands `foldingKeymaps`
 * to the hook, and those rows read the tree on show. Keep the two in step.
 */
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
    "z c": foldClose,
    "z o": foldOpen,
  },
};

/**
 * The only rows insert has: `Esc` leaves and `Ctrl+Enter` saves. Everything
 * else is text and belongs to the field, movement and creation included.
 */
const INSERT_GLOBAL: PanelKeymap = {
  Escape: escape,
  "Ctrl+Enter": saveComment,
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
  insert: { global: INSERT_GLOBAL, panels: {} },
};

export type FoldRows = () => readonly FoldRow[];

const closeOrUp =
  (rowsNow: FoldRows): Binding =>
  ({ panel, panelState }) => {
    const row = rowsNow()[panelState.cursor];
    if (!row) return null;
    if (row.foldable && row.expanded) {
      return { type: "ToggleFold", panel, index: panelState.cursor, open: false };
    }
    if (row.parent === null) return null;
    return { type: "MoveCursor", panel, to: row.parent };
  };

const openFold =
  (rowsNow: FoldRows): Binding =>
  ({ panel, panelState }) => {
    const row = rowsNow()[panelState.cursor];
    if (!row || !row.foldable || row.expanded) return null;
    return { type: "ToggleFold", panel, index: panelState.cursor, open: true };
  };

const confirmOrFold =
  (rowsNow: FoldRows): Binding =>
  ({ panel, panelState }) => {
    const row = rowsNow()[panelState.cursor];
    if (!row) return null;
    // A folder has no diff to open, so Enter does there what a tree always does.
    if (row.foldable) {
      return { type: "ToggleFold", panel, index: panelState.cursor, open: !row.expanded };
    }
    return { type: "Confirm", panel, index: panelState.cursor };
  };

/**
 * The tree tables. Rows arrive as a getter, not as a value: folding answers the
 * very keys these bindings emit, so a burst of keys reaching the machine before
 * React re-renders must still read the rows as they are, not as they were.
 */
export function foldingKeymaps(rowsNow: FoldRows): Keymaps {
  return {
    ...DEFAULT_KEYMAPS,
    normal: {
      global: GLOBAL_KEYMAP,
      panels: {
        ...NORMAL_PANELS,
        tree: {
          ...NORMAL_PANELS.tree,
          h: closeOrUp(rowsNow),
          l: openFold(rowsNow),
          Enter: confirmOrFold(rowsNow),
        },
      },
    },
  };
}

/** What the diff panel is showing right now, counted in whatever its view walks. */
export interface DiffMetrics {
  /** Items the cursor walks: lines in the unified view, rows in the split one. */
  lineCount: number;
  pageSize: number;
  view?: DiffView;
  /** Column the cursor is on; only the split view has two to choose from. */
  side?: Side;
  /** Whether a range of items holds any line of the active side to anchor to.
   *  Absent in the unified view, where every line of the range anchors. */
  anchored?: (from: number, to: number) => boolean;
}

export type DiffMetricsNow = () => DiffMetrics;

const diffMove =
  (metricsNow: DiffMetricsNow, step: (metrics: DiffMetrics) => number): Binding =>
  ({ panel, panelState }) => {
    const metrics = metricsNow();
    return {
      type: "MoveCursor",
      panel,
      to: clamp(panelState.cursor + step(metrics), metrics.lineCount),
    };
  };

const diffExtend =
  (metricsNow: DiffMetricsNow, step: number): Binding =>
  ({ panelState, selection }) => {
    if (!selection) return null;
    return {
      type: "ExtendSelection",
      from: selection.anchor,
      to: clamp(panelState.cursor + step, metricsNow().lineCount),
    };
  };

/** Never zero: a viewport too short to halve would leave Ctrl+d dead. */
const halfPage = (metrics: DiffMetrics): number => Math.max(1, Math.floor(metrics.pageSize / 2));

const viewOf = (metrics: DiffMetrics): DiffView => metrics.view ?? "unified";

const sideOf = (metrics: DiffMetrics): Side => metrics.side ?? "new";

/** Asking for the view already on show is not a move, and would drag the cursor. */
const setView =
  (metricsNow: DiffMetricsNow, view: DiffView): Binding =>
  () =>
    viewOf(metricsNow()) === view ? null : { type: "SetView", view };

/** Outside the split there is only one column, so there is no side to choose. */
const setSide =
  (metricsNow: DiffMetricsNow, side: Side): Binding =>
  () => {
    const metrics = metricsNow();
    if (viewOf(metrics) !== "split" || sideOf(metrics) === side) return null;
    return { type: "SetSide", side };
  };

/**
 * The window keys of Vim, because a split view is literally two windows. `h`
 * and `l` on their own do the same: in a read-only viewer they have no other
 * useful meaning, and that way changing column costs one key.
 */
function windowKeys(metricsNow: DiffMetricsNow): PanelKeymap {
  return {
    "Ctrl+w v": setView(metricsNow, "split"),
    "Ctrl+w o": setView(metricsNow, "unified"),
    "Ctrl+w h": setSide(metricsNow, "old"),
    "Ctrl+w l": setSide(metricsNow, "new"),
    h: setSide(metricsNow, "old"),
    l: setSide(metricsNow, "new"),
  };
}

function diffNormal(metricsNow: DiffMetricsNow): PanelKeymap {
  return {
    j: diffMove(metricsNow, () => 1),
    k: diffMove(metricsNow, () => -1),
    "g g": jumpTop,
    G: ({ panel }) => ({ type: "MoveCursor", panel, to: Math.max(0, metricsNow().lineCount - 1) }),
    "Ctrl+d": diffMove(metricsNow, halfPage),
    "Ctrl+u": diffMove(metricsNow, (metrics) => -halfPage(metrics)),
    v: enterVisual,
    ...windowKeys(metricsNow),
  };
}

/** A comment that anchors to nothing would still drag the keyboard into the editor. */
function anchors(metrics: DiffMetrics, selection: Selection | null): boolean {
  if (metrics.lineCount === 0 || selection === null) return false;
  const { from, to } = selectionRange(selection);
  return metrics.anchored?.(from, to) ?? true;
}

/**
 * The window keys answer here too, the way Vim takes `Ctrl+W` in visual: a
 * reader with a range open must not have to cancel it to leave the split.
 * Changing column keeps the range, which counts the same rows on either side;
 * changing view closes it, and that is the machine's doing.
 */
function diffVisual(metricsNow: DiffMetricsNow): PanelKeymap {
  return {
    j: diffExtend(metricsNow, 1),
    k: diffExtend(metricsNow, -1),
    c: (ctx) => (anchors(metricsNow(), ctx.selection) ? createComment(ctx) : null),
    ...windowKeys(metricsNow),
  };
}

/** How many comments the list holds right now. */
export type CommentCountNow = () => number;

function commentsNormal(countNow: CommentCountNow): PanelKeymap {
  return {
    j: ({ panel, panelState }) => ({
      type: "MoveCursor",
      panel,
      to: clamp(panelState.cursor + 1, countNow()),
    }),
    k: ({ panel, panelState }) => ({
      type: "MoveCursor",
      panel,
      to: clamp(panelState.cursor - 1, countNow()),
    }),
    "g g": jumpTop,
    G: ({ panel }) => ({ type: "MoveCursor", panel, to: Math.max(0, countNow() - 1) }),
    Enter: confirm,
    "d d": deleteItem,
    "z c": foldClose,
    "z o": foldOpen,
  };
}

/**
 * The review tables. Every getter answers on the spot for the same reason: a
 * burst of keys arrives before React re-renders, and opening another file — or
 * deleting a comment — changes the very list the next key walks.
 */
export function reviewKeymaps(
  rowsNow: FoldRows,
  diffNow: DiffMetricsNow,
  commentsNow: CommentCountNow,
): Keymaps {
  const folding = foldingKeymaps(rowsNow);
  return {
    ...folding,
    normal: {
      global: TOOLBAR_KEYMAP,
      panels: {
        ...folding.normal.panels,
        diff: diffNormal(diffNow),
        comments: commentsNormal(commentsNow),
      },
    },
    visual: {
      global: GLOBAL_KEYMAP,
      panels: { ...folding.visual.panels, diff: diffVisual(diffNow) },
    },
  };
}

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
  insert: { global: INSERT_GLOBAL, panels: {} },
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

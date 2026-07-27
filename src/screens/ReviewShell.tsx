import { useCallback, useMemo, useRef } from "react";
import type { Scope } from "@/ipc/types";
import { foldingKeymaps } from "@/keys/keymap";
import { selectionRange } from "@/keys/selection";
import type { Command, Mode, Panel, Selection } from "@/keys/types";
import { useKeyboard } from "@/keys/useKeyboard";
import TreePanel from "@/panels/TreePanel";
import { commentCountsByPath, reviewStore, useReviewState } from "@/state/review";
import { buildTree, diffTotals, flatten, foldRows } from "@/tree/build-tree";
import type { FlatRow, TreeNode } from "@/tree/build-tree";
import { basename } from "./paths";
import { scopeLabel } from "./scope-label";

type SidePanel = Exclude<Panel, "tree">;

const SIDE_PANELS: SidePanel[] = ["diff", "comments"];

const PANEL_TITLES: Record<SidePanel, string> = {
  diff: "2 DIFF",
  comments: "3 COMENTARIOS",
};

/** Placeholder lists until the real panels (fases 5-6) render actual review data. */
const PANEL_ITEMS: Record<SidePanel, string[]> = {
  diff: ["línea 1", "línea 2", "línea 3", "línea 4", "línea 5"],
  comments: ["comentario 1", "comentario 2", "comentario 3"],
};

const MODE_LABELS: Record<Mode, string> = {
  normal: "NORMAL",
  visual: "VISUAL",
  insert: "INSERT",
};

interface ReviewShellProps {
  scope: Scope;
}

interface PanelView {
  name: SidePanel;
  subtitle: string | null;
  cursor: number;
  active: boolean;
  range: Selection | null;
}

function isSelected(index: number, cursor: number, range: Selection | null): boolean {
  if (!range) return index === cursor;
  const { from, to } = selectionRange(range);
  return index >= from && index <= to;
}

function renderPanel({ name, subtitle, cursor, active, range }: PanelView): JSX.Element {
  const title = PANEL_TITLES[name];
  return (
    <section
      key={name}
      className="panel"
      aria-label={title}
      aria-current={active}
      data-active={active}
    >
      <h2>
        {title}
        {subtitle !== null && <span className="panel-subtitle"> {subtitle}</span>}
      </h2>
      <ul role="listbox" className="panel-list">
        {PANEL_ITEMS[name].map((item, index) => (
          <li
            key={item}
            role="option"
            aria-selected={isSelected(index, cursor, range)}
            data-cursor={index === cursor}
          >
            {item}
          </li>
        ))}
      </ul>
    </section>
  );
}

export default function ReviewShell({ scope }: ReviewShellProps): JSX.Element {
  const { files, comments, selectedPath, collapsed } = useReviewState();

  // What the cursor walks: the folds and the file on show must not reset it.
  const listId = useMemo(() => files.map((file) => file.path).join("\n"), [files]);

  const tree = useMemo(() => buildTree(files), [files]);
  const rows = useMemo(() => flatten(tree, collapsed), [tree, collapsed]);
  const totals = useMemo(() => diffTotals(files), [files]);
  const commentCounts = useMemo(() => commentCountsByPath(comments), [comments]);

  // Read from the store, not from this render: a burst of keys folds and walks
  // faster than React re-renders, and every key must see the fold before it.
  const treeRef = useRef(tree);
  treeRef.current = tree;
  const rowsNow = useCallback(
    (): FlatRow[] => flatten(treeRef.current, reviewStore.getState().collapsed),
    [],
  );
  const keymaps = useMemo(() => foldingKeymaps(() => foldRows(rowsNow())), [rowsNow]);

  const handleCommands = useCallback(
    (commands: Command[]): void => {
      for (const command of commands) {
        if (command.type !== "ToggleFold" && command.type !== "Confirm") continue;
        if (command.panel !== "tree") continue;
        const node: TreeNode | undefined = rowsNow()[command.index]?.node;
        if (command.type === "ToggleFold" && node?.kind === "dir") {
          reviewStore.toggleFold(node.path, command.open);
        } else if (command.type === "Confirm" && node?.kind === "file") {
          reviewStore.selectFile(node.path);
        }
      }
    },
    [rowsNow],
  );

  const state = useKeyboard(
    {
      tree: { itemCount: rows.length, pageSize: rows.length, listId },
      diff: { itemCount: PANEL_ITEMS.diff.length, pageSize: PANEL_ITEMS.diff.length },
      comments: { itemCount: PANEL_ITEMS.comments.length, pageSize: PANEL_ITEMS.comments.length },
    },
    handleCommands,
    keymaps,
  );

  const range = state.mode === "visual" ? state.selection : null;

  return (
    <div className="app">
      <header className="app-header">
        <h1>AI Code Reviewer</h1>
        <span className="scope-summary">
          {basename(scope.repo)} · {scopeLabel(scope)}
        </span>
        <span className="mode-indicator" data-mode={state.mode} aria-live="polite">
          {MODE_LABELS[state.mode]}
        </span>
      </header>
      <div className="panels">
        <TreePanel
          rows={rows}
          cursor={state.panels.tree.cursor}
          active={state.activePanel === "tree"}
          commentCounts={commentCounts}
          totals={totals}
        />
        {SIDE_PANELS.map((name) => {
          const active = state.activePanel === name;
          return renderPanel({
            name,
            subtitle: name === "diff" ? selectedPath : null,
            cursor: state.panels[name].cursor,
            active,
            range: active ? range : null,
          });
        })}
      </div>
    </div>
  );
}

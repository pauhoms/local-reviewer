import { useCallback, useMemo, useRef, useState } from "react";
import { countDiffLines } from "@/diff/rows";
import { DEFAULT_PAGE_SIZE } from "@/diff/window";
import type { Scope } from "@/ipc/types";
import { reviewKeymaps } from "@/keys/keymap";
import type { DiffMetrics } from "@/keys/keymap";
import { selectionRange } from "@/keys/selection";
import type { Command, Mode, Selection } from "@/keys/types";
import { useKeyboard } from "@/keys/useKeyboard";
import DiffPanel from "@/panels/DiffPanel";
import TreePanel from "@/panels/TreePanel";
import { commentCountsByPath, reviewStore, selectedFile, useReviewState } from "@/state/review";
import { buildTree, diffTotals, flatten, foldRows } from "@/tree/build-tree";
import type { FlatRow, TreeNode } from "@/tree/build-tree";
import { basename } from "./paths";
import { scopeLabel } from "./scope-label";

const COMMENTS_TITLE = "3 COMENTARIOS";

/** Placeholder list until the comments panel (fase 6) renders actual comments. */
const COMMENT_ITEMS = ["comentario 1", "comentario 2", "comentario 3"];

const MODE_LABELS: Record<Mode, string> = {
  normal: "NORMAL",
  visual: "VISUAL",
  insert: "INSERT",
};

interface ReviewShellProps {
  scope: Scope;
}

interface CommentsView {
  cursor: number;
  active: boolean;
  range: Selection | null;
}

function isSelected(index: number, cursor: number, range: Selection | null): boolean {
  if (!range) return index === cursor;
  const { from, to } = selectionRange(range);
  return index >= from && index <= to;
}

function renderComments({ cursor, active, range }: CommentsView): JSX.Element {
  return (
    <section
      className="panel"
      aria-label={COMMENTS_TITLE}
      aria-current={active}
      data-active={active}
    >
      <h2>{COMMENTS_TITLE}</h2>
      <ul role="listbox" className="panel-list">
        {COMMENT_ITEMS.map((item, index) => (
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
  const { files, comments, selectedPath, collapsed, diffCursor } = useReviewState();

  // What the cursor walks: the folds and the file on show must not reset it.
  const listId = useMemo(() => files.map((file) => file.path).join("\n"), [files]);

  const file = useMemo(() => selectedFile(files, selectedPath), [files, selectedPath]);
  const diffLines = useMemo(() => countDiffLines(file), [file]);

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
  // Same reason for the diff: opening another file changes the lines the next
  // key walks, and a resize changes what half a page means.
  const pageSizeRef = useRef(DEFAULT_PAGE_SIZE);
  const [diffPageSize, setDiffPageSize] = useState(DEFAULT_PAGE_SIZE);
  const handlePageSize = useCallback((size: number): void => {
    pageSizeRef.current = size;
    setDiffPageSize(size);
  }, []);
  const diffNow = useCallback((): DiffMetrics => {
    const { files: known, selectedPath: shown } = reviewStore.getState();
    return {
      lineCount: countDiffLines(selectedFile(known, shown)),
      pageSize: pageSizeRef.current,
    };
  }, []);

  const keymaps = useMemo(
    () => reviewKeymaps(() => foldRows(rowsNow()), diffNow),
    [rowsNow, diffNow],
  );

  const handleCommands = useCallback(
    (commands: Command[]): void => {
      for (const command of commands) {
        if (command.type === "MoveCursor" && command.panel === "diff") {
          reviewStore.setDiffCursor(command.to);
          continue;
        }
        // Only the diff has a range to extend, and extending it drags the cursor.
        if (command.type === "ExtendSelection") {
          reviewStore.setDiffCursor(command.to);
          continue;
        }
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
      diff: {
        itemCount: diffLines,
        pageSize: diffPageSize,
        cursorNow: () => reviewStore.getState().diffCursor,
      },
      comments: { itemCount: COMMENT_ITEMS.length, pageSize: COMMENT_ITEMS.length },
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
        <DiffPanel
          scope={scope}
          path={selectedPath}
          file={file}
          cursor={diffCursor}
          active={state.activePanel === "diff"}
          range={state.activePanel === "diff" ? range : null}
          onPageSize={handlePageSize}
        />
        {renderComments({
          cursor: state.panels.comments.cursor,
          active: state.activePanel === "comments",
          range: state.activePanel === "comments" ? range : null,
        })}
      </div>
    </div>
  );
}

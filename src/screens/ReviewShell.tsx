import { useCallback, useEffect, useMemo, useRef } from "react";
import { nextCommentId } from "@/comments/id";
import { anchorFor, diffLines, rowOfLine } from "@/diff/anchor";
import { buildDiffRows } from "@/diff/rows";
import { itemOfLine, lineOfItem, splitAnchor, splitLayout } from "@/diff/split-rows";
import { DEFAULT_PAGE_SIZE, diffPage } from "@/diff/window";
import { copyToClipboard, exportReview } from "@/ipc/client";
import { errorMessage } from "@/ipc/errors";
import type { DiffView, FileDiff, Scope, Side } from "@/ipc/types";
import { reviewKeymaps } from "@/keys/keymap";
import type { DiffMetrics } from "@/keys/keymap";
import type { Command, Mode } from "@/keys/types";
import { useKeyboard } from "@/keys/useKeyboard";
import CommentsPanel from "@/panels/CommentsPanel";
import DiffPanel from "@/panels/DiffPanel";
import TreePanel from "@/panels/TreePanel";
import { startAutosave } from "@/state/persist";
import {
  commentCountsByPath,
  persistableReview,
  reviewStore,
  selectedFile,
  useReviewState,
} from "@/state/review";
import type { ReviewComment } from "@/state/review";
import Toolbar from "@/toolbar/Toolbar";
import { buildTree, diffTotals, filePaths, flatten, foldRows } from "@/tree/build-tree";
import type { FlatRow } from "@/tree/build-tree";
import { basename } from "./paths";
import { scopeLabel } from "./scope-label";

const MODE_LABELS: Record<Mode, string> = {
  normal: "NORMAL",
  visual: "VISUAL",
  insert: "INSERT",
};

interface ReviewShellProps {
  scope: Scope;
}

/** The file the diff panel is showing right now, whatever the last render saw. */
function fileNow(): FileDiff | null {
  const { files, selectedPath } = reviewStore.getState();
  return selectedFile(files, selectedPath);
}

/**
 * The comment the `c` key just anchored, or `null` when the range holds no line
 * on the side it would anchor to — which in split is the active column.
 */
function commentForRange(from: number, to: number): ReviewComment | null {
  const { view, side } = reviewStore.getState();
  const file = fileNow();
  if (!file) return null;
  const anchor =
    view === "split"
      ? splitAnchor(splitLayout(file), side, from, to)
      : anchorFor(diffLines(file), from, to);
  if (!anchor) return null;
  return { id: nextCommentId(), path: file.path, text: "", ...anchor };
}

/** Where the diff has to land to show the line a comment is anchored to. */
function placeOfComment(comment: ReviewComment): { cursor: number; side: Side } {
  const file = selectedFile(reviewStore.getState().files, comment.path);
  if (!file) return { cursor: 0, side: comment.side };
  const line = rowOfLine(diffLines(file), comment.side, comment.from);
  if (reviewStore.getState().view !== "split") return { cursor: line, side: comment.side };
  const landed = itemOfLine(splitLayout(file), line, comment.side);
  return { cursor: landed.item, side: landed.side };
}

interface ViewLayout {
  /** Row each item sits on, so `itemRows.length` is what the cursor walks. */
  itemRows: readonly number[];
  rowCount: number;
}

/** What the cursor walks and what the viewport scrolls, in the view on show. */
function viewLayout(view: DiffView, file: FileDiff | null): ViewLayout {
  if (view === "split") {
    const layout = splitLayout(file);
    return { itemRows: layout.itemRows, rowCount: layout.rows.length };
  }
  const unified = buildDiffRows(file);
  return { itemRows: unified.lineRows, rowCount: unified.rows.length };
}

/**
 * Both read the store and not this render: the key that asks for either may
 * land in the same burst as the one that changed what it reads.
 */
function runExport(): void {
  const state = reviewStore.getState();
  const review = persistableReview(state);
  if (review === null) return;
  exportReview(review, filePaths(buildTree(state.files)))
    .then((path) => reviewStore.exported(path))
    .catch((error: unknown) =>
      reviewStore.exportFailed(`No se pudo exportar la revisión: ${errorMessage(error)}`),
    );
}

function runCopy(): void {
  const { exportPath } = reviewStore.getState();
  if (exportPath === null) return;
  copyToClipboard(exportPath)
    .then(() => reviewStore.copied())
    .catch((error: unknown) =>
      reviewStore.copyFailed(`No se pudo copiar la ruta: ${errorMessage(error)}`),
    );
}

/** The cursor of one view read in the units of the other, keeping its line. */
function movedTo(view: DiffView): { cursor: number; side: Side } {
  const { diffCursor, side } = reviewStore.getState();
  const layout = splitLayout(fileNow());
  if (view === "split") {
    const landed = itemOfLine(layout, diffCursor, side);
    return { cursor: landed.item, side: landed.side };
  }
  return { cursor: lineOfItem(layout, diffCursor, side), side };
}

export default function ReviewShell({ scope }: ReviewShellProps): JSX.Element {
  const {
    files,
    comments,
    selectedPath,
    collapsed,
    diffCursor,
    editing,
    foldedComments,
    view,
    side,
    exportPath,
    toolbarError,
    copied,
  } = useReviewState();

  // What the cursor walks: the folds and the file on show must not reset it.
  const listId = useMemo(() => files.map((file) => file.path).join("\n"), [files]);

  const file = useMemo(() => selectedFile(files, selectedPath), [files, selectedPath]);
  // What the diff cursor walks: lines in the unified view, rows in the split one.
  const diffItemCount = useMemo(() => viewLayout(view, file).itemRows.length, [view, file]);

  const tree = useMemo(() => buildTree(files), [files]);
  const rows = useMemo(() => flatten(tree, collapsed), [tree, collapsed]);
  const totals = useMemo(() => diffTotals(files), [files]);
  const commentCounts = useMemo(() => commentCountsByPath(comments), [comments]);
  const editingComment = useMemo(
    () => comments.find((comment) => comment.id === editing) ?? null,
    [comments, editing],
  );

  // No save button: the review reaches its state file by itself, and what the
  // store already holds when this mounts is what the disk holds.
  useEffect(() => startAutosave(reviewStore).stop, []);

  // Read from the store, not from this render: a burst of keys folds and walks
  // faster than React re-renders, and every key must see the fold before it.
  const treeRef = useRef(tree);
  treeRef.current = tree;
  const rowsNow = useCallback(
    (): FlatRow[] => flatten(treeRef.current, reviewStore.getState().collapsed),
    [],
  );
  // Same reason for the diff: opening another file changes the lines the next
  // key walks, and a resize changes what half a page means. Only the geometry
  // of the viewport is kept, in rows: how many items a page holds is worked out
  // against the view of the moment, which `Ctrl+w v` changes mid-burst.
  const viewportRef = useRef({ pageRows: DEFAULT_PAGE_SIZE, topRow: 0 });
  const handleViewport = useCallback((pageRows: number, topRow: number): void => {
    viewportRef.current = { pageRows, topRow };
  }, []);
  const diffNow = useCallback((): DiffMetrics => {
    const { view: on, side: column, diffCursor: cursor } = reviewStore.getState();
    const shown = fileNow();
    const layout = viewLayout(on, shown);
    const { pageRows, topRow } = viewportRef.current;
    const page = diffPage(layout.itemRows, {
      rowCount: layout.rowCount,
      pageSize: pageRows,
      cursor,
      offset: topRow,
    });
    const metrics: DiffMetrics = {
      lineCount: layout.itemRows.length,
      pageSize: page.itemCount,
      view: on,
      side: column,
    };
    if (on !== "split") return metrics;
    const split = splitLayout(shown);
    return { ...metrics, anchored: (from, to) => splitAnchor(split, column, from, to) !== null };
  }, []);
  // And for panel 3: `dd` shortens the very list the next key of the burst walks.
  const commentsNow = useCallback((): number => reviewStore.getState().comments.length, []);

  const keymaps = useMemo(
    () => reviewKeymaps(() => foldRows(rowsNow()), diffNow, commentsNow),
    [rowsNow, diffNow, commentsNow],
  );

  const handleCommands = useCallback(
    (commands: Command[]): void => {
      for (const command of commands) {
        switch (command.type) {
          case "MoveCursor":
            if (command.panel === "diff") reviewStore.setDiffCursor(command.to);
            break;
          // Only the diff has a range to extend, and extending it drags the cursor.
          case "ExtendSelection":
            reviewStore.setDiffCursor(command.to);
            break;
          case "CreateComment": {
            const fresh = commentForRange(command.from, command.to);
            if (fresh) reviewStore.startComment(fresh);
            break;
          }
          case "SaveComment":
            reviewStore.saveEditing();
            break;
          // Changing view is one move: the cursor arrives already read in the
          // units of the view that opens, on the column the line lives on.
          case "SetView": {
            const landed = movedTo(command.view);
            reviewStore.setView(command.view, landed.cursor, landed.side);
            break;
          }
          case "SetSide":
            reviewStore.setSide(command.side);
            break;
          // Leaving insert throws away the comment that was being written; in
          // any other mode there is none, and this is a no-op.
          case "Escape":
            reviewStore.cancelEditing();
            break;
          case "Confirm": {
            if (command.panel === "tree") {
              const node = rowsNow()[command.index]?.node;
              if (node?.kind === "file") reviewStore.selectFile(node.path);
              break;
            }
            if (command.panel !== "comments") break;
            const target = reviewStore.getState().comments[command.index];
            if (target) {
              const place = placeOfComment(target);
              reviewStore.openAt(target.path, place.cursor, place.side);
            }
            break;
          }
          case "DeleteItem": {
            if (command.panel !== "comments") break;
            const target = reviewStore.getState().comments[command.index];
            if (target) reviewStore.removeComment(target.id);
            break;
          }
          case "ToggleFold": {
            if (command.panel === "tree") {
              const node = rowsNow()[command.index]?.node;
              if (node?.kind === "dir") reviewStore.toggleFold(node.path, command.open);
              break;
            }
            if (command.panel !== "comments") break;
            const target = reviewStore.getState().comments[command.index];
            if (target) reviewStore.toggleCommentFold(target.id, command.open);
            break;
          }
          case "ExportReview":
            runExport();
            break;
          case "CopyPath":
            runCopy();
            break;
          default:
            break;
        }
      }
    },
    [rowsNow],
  );

  const state = useKeyboard(
    {
      tree: { itemCount: rows.length, pageSize: rows.length, listId },
      diff: {
        itemCount: diffItemCount,
        // The diff tables halve the page they read from `diffNow`, never this
        // one; it is here so the machine's own idea of the panel is not a lie.
        pageSize: diffNow().pageSize,
        cursorNow: () => reviewStore.getState().diffCursor,
      },
      comments: { itemCount: comments.length, pageSize: comments.length },
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
        <Toolbar
          path={exportPath}
          error={toolbarError}
          copied={copied}
          onExport={runExport}
          onCopy={runCopy}
        />
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
          view={view}
          side={side}
          onViewport={handleViewport}
        />
        <CommentsPanel
          comments={comments}
          cursor={state.panels.comments.cursor}
          active={state.activePanel === "comments"}
          folded={foldedComments}
          editing={editingComment}
          onEditorChange={(text) => {
            if (editing !== null) reviewStore.setCommentText(editing, text);
          }}
        />
      </div>
    </div>
  );
}

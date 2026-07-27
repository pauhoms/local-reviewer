import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { nextCommentId } from "@/comments/id";
import { anchorFor, diffLines, rowOfLine } from "@/diff/anchor";
import { countDiffLines } from "@/diff/rows";
import { DEFAULT_PAGE_SIZE } from "@/diff/window";
import type { Scope } from "@/ipc/types";
import { reviewKeymaps } from "@/keys/keymap";
import type { DiffMetrics } from "@/keys/keymap";
import type { Command, Mode } from "@/keys/types";
import { useKeyboard } from "@/keys/useKeyboard";
import CommentsPanel from "@/panels/CommentsPanel";
import DiffPanel from "@/panels/DiffPanel";
import TreePanel from "@/panels/TreePanel";
import { startAutosave } from "@/state/persist";
import { commentCountsByPath, reviewStore, selectedFile, useReviewState } from "@/state/review";
import type { ReviewComment } from "@/state/review";
import { buildTree, diffTotals, flatten, foldRows } from "@/tree/build-tree";
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

/** The comment the `c` key just anchored, or `null` when the range holds no line. */
function commentForRange(from: number, to: number): ReviewComment | null {
  const { files, selectedPath } = reviewStore.getState();
  const file = selectedFile(files, selectedPath);
  if (!file) return null;
  const anchor = anchorFor(diffLines(file), from, to);
  if (!anchor) return null;
  return { id: nextCommentId(), path: file.path, text: "", ...anchor };
}

/** Row the diff has to land on to show the line a comment is anchored to. */
function rowOfComment(comment: ReviewComment): number {
  const file = selectedFile(reviewStore.getState().files, comment.path);
  if (!file) return 0;
  return rowOfLine(diffLines(file), comment.side, comment.from);
}

export default function ReviewShell({ scope }: ReviewShellProps): JSX.Element {
  const { files, comments, selectedPath, collapsed, diffCursor, editing, foldedComments } =
    useReviewState();

  // What the cursor walks: the folds and the file on show must not reset it.
  const listId = useMemo(() => files.map((file) => file.path).join("\n"), [files]);

  const file = useMemo(() => selectedFile(files, selectedPath), [files, selectedPath]);
  const diffLineCount = useMemo(() => countDiffLines(file), [file]);

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
            if (target) reviewStore.openAt(target.path, rowOfComment(target));
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
        itemCount: diffLineCount,
        pageSize: diffPageSize,
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

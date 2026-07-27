import { useSyncExternalStore } from "react";
import type { Comment, DiffView, FileDiff, Review, Scope, Side } from "@/ipc/types";
import { buildTree, flatten } from "@/tree/build-tree";

export type ReviewComment = Comment;

export interface ReviewState {
  /** What the review is about; every panel reads it from here, not from a prop chain. */
  scope: Scope | null;
  files: FileDiff[];
  selectedPath: string | null;
  /** Diff line under the cursor. Here and not in the panel: opening another
   *  file puts it back on the first line, and the key that follows in the same
   *  burst has to read it already moved. */
  diffCursor: number;
  comments: ReviewComment[];
  /** Comment the editor is on, `null` when nobody is writing. */
  editing: string | null;
  /** Previous text when editing an existing comment; `null` for a new draft. */
  editingOriginalText: string | null;
  /** Folded folder paths. Here and not in the panel: folding answers keys that
   *  may arrive faster than React re-renders, so it has to be readable at once. */
  collapsed: ReadonlySet<string>;
  /** Same reason as `collapsed`, for the entries of panel 3. */
  foldedComments: ReadonlySet<string>;
  /** How the diff is being read; in split it also decides what `diffCursor` counts. */
  view: DiffView;
  /** Column the cursor is on in split: what `v` selects and what `c` anchors to. */
  side: Side;
  /** Where the last export of this session landed, `null` before the first one.
   *  Here and not in the toolbar: the key that copies it reads it the moment it
   *  lands, and the key that exports may have just changed it. */
  exportPath: string | null;
  /** What went wrong exporting or copying, in the words the toolbar shows. */
  toolbarError: string | null;
  /** Whether `exportPath` is the text sitting in the clipboard. The clipboard is
   *  write-only, so without this the reviewer has no way of telling `y` worked. */
  copied: boolean;
}

export interface ReviewStore {
  getState: () => ReviewState;
  subscribe: (listener: () => void) => () => void;
  open: (scope: Scope, files: FileDiff[], view?: DiffView) => void;
  selectFile: (path: string) => void;
  setDiffCursor: (line: number) => void;
  /** Opening a file and landing on one of its lines is a single move: two would
   *  let the key after it read the cursor of the file that just closed. */
  openAt: (path: string, line: number, side?: Side) => void;
  /** Same reason: the view decides what the cursor counts, so it travels with
   *  the line it lands on and with the column that line lives on. */
  setView: (view: DiffView, cursor: number, side: Side) => void;
  setSide: (side: Side) => void;
  toggleFold: (path: string, open: boolean) => void;
  toggleCommentFold: (id: string, open: boolean) => void;
  addComment: (comment: ReviewComment) => void;
  startComment: (comment: ReviewComment) => void;
  editComment: (id: string) => void;
  setCommentText: (id: string, text: string) => void;
  saveEditing: () => void;
  cancelEditing: () => void;
  removeComment: (id: string) => void;
  restoreComments: (comments: readonly ReviewComment[]) => void;
  exported: (path: string) => void;
  /** The path of an export that did work stays: its file is on disk, and the
   *  reviewer needs to know which one is still the good one. */
  exportFailed: (message: string) => void;
  copied: () => void;
  copyFailed: (message: string) => void;
}

export function commentCountsByPath(comments: readonly ReviewComment[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const comment of comments) {
    counts.set(comment.path, (counts.get(comment.path) ?? 0) + 1);
  }
  return counts;
}

/** The file the diff panel is showing, or `null` when the path is not in the changes. */
export function selectedFile(files: readonly FileDiff[], path: string | null): FileDiff | null {
  if (path === null) return null;
  return files.find((file) => file.path === path) ?? null;
}

/** The half of the state that belongs on disk: no cursors, no folds. */
export function persistableReview(state: ReviewState): Review | null {
  if (state.scope === null) return null;
  // The draft is in `comments` from the moment `c` is pressed, so without this
  // the autosave writes a bodiless comment before the first letter is typed —
  // and a crash with the editor open would resurrect it on the next resume.
  const comments = state.comments.flatMap((comment) => {
    if (comment.id !== state.editing) return [comment];
    if (state.editingOriginalText !== null) {
      return [{ ...comment, text: state.editingOriginalText }];
    }
    return comment.text.trim() === "" ? [] : [comment];
  });
  return { scope: state.scope, comments, view: state.view };
}

const NO_FOLDS: ReadonlySet<string> = new Set();

function emptyState(): ReviewState {
  return {
    scope: null,
    files: [],
    selectedPath: null,
    diffCursor: 0,
    comments: [],
    editing: null,
    editingOriginalText: null,
    collapsed: NO_FOLDS,
    foldedComments: NO_FOLDS,
    view: "unified",
    side: "new",
    exportPath: null,
    toolbarError: null,
    copied: false,
  };
}

/**
 * The tree sorts its rows, so `files[0]` is rarely the row the cursor starts on
 * — and the first row is usually a folder, which has no diff to show at all.
 */
function firstFileOfTree(files: FileDiff[]): string | null {
  for (const row of flatten(buildTree(files), NO_FOLDS)) {
    if (row.node.kind === "file") return row.node.path;
  }
  return null;
}

function withFold(folds: ReadonlySet<string>, key: string, open: boolean): ReadonlySet<string> {
  const next = new Set(folds);
  if (open) next.delete(key);
  else next.add(key);
  return next;
}

export function createReviewStore(): ReviewStore {
  let state = emptyState();
  const listeners = new Set<() => void>();

  function emit(): void {
    for (const listener of listeners) listener();
  }

  function set(next: ReviewState): void {
    state = next;
    emit();
  }

  function drop(id: string): ReviewState {
    const wasEditing = state.editing === id;
    return {
      ...state,
      comments: state.comments.filter((comment) => comment.id !== id),
      editing: wasEditing ? null : state.editing,
      editingOriginalText: wasEditing ? null : state.editingOriginalText,
    };
  }

  return {
    getState: () => state,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    open: (scope, files, view = "unified") => {
      // Comments belong to the review that is closing, not to the one opening.
      set({ ...emptyState(), scope, files, selectedPath: firstFileOfTree(files), view });
    },
    selectFile: (path) => {
      // The line of the file that closes means nothing in the one that opens.
      set({ ...state, selectedPath: path, diffCursor: 0 });
    },
    setDiffCursor: (line) => set({ ...state, diffCursor: line }),
    openAt: (path, line, side = state.side) =>
      set({ ...state, selectedPath: path, diffCursor: line, side }),
    setView: (view, cursor, side) => set({ ...state, view, diffCursor: cursor, side }),
    setSide: (side) => set({ ...state, side }),
    toggleFold: (path, open) => set({ ...state, collapsed: withFold(state.collapsed, path, open) }),
    toggleCommentFold: (id, open) =>
      set({ ...state, foldedComments: withFold(state.foldedComments, id, open) }),
    addComment: (comment) => set({ ...state, comments: [...state.comments, comment] }),
    startComment: (comment) =>
      set({
        ...state,
        comments: [...state.comments, comment],
        editing: comment.id,
        editingOriginalText: null,
      }),
    editComment: (id) => {
      const comment = state.comments.find((item) => item.id === id);
      if (!comment || state.editing !== null) return;
      set({ ...state, editing: id, editingOriginalText: comment.text });
    },
    setCommentText: (id, text) => {
      if (!state.comments.some((comment) => comment.id === id)) return;
      set({
        ...state,
        comments: state.comments.map((comment) =>
          comment.id === id ? { ...comment, text } : comment,
        ),
      });
    },
    saveEditing: () => {
      const id = state.editing;
      if (id === null) return;
      // Saving a comment with nothing written in it would put an empty heading
      // in the exported Markdown; it is the same as never having made it.
      const draft = state.comments.find((comment) => comment.id === id);
      set(
        draft && draft.text.trim() === ""
          ? drop(id)
          : { ...state, editing: null, editingOriginalText: null },
      );
    },
    cancelEditing: () => {
      const id = state.editing;
      if (id === null) return;
      const originalText = state.editingOriginalText;
      if (originalText === null) {
        set(drop(id));
        return;
      }
      set({
        ...state,
        comments: state.comments.map((comment) =>
          comment.id === id ? { ...comment, text: originalText } : comment,
        ),
        editing: null,
        editingOriginalText: null,
      });
    },
    removeComment: (id) => {
      if (!state.comments.some((comment) => comment.id === id)) return;
      set(drop(id));
    },
    restoreComments: (comments) =>
      set({
        ...state,
        comments: [...comments],
        editing: null,
        editingOriginalText: null,
      }),
    exported: (path) => set({ ...state, exportPath: path, toolbarError: null, copied: false }),
    exportFailed: (message) =>
      set({
        ...state,
        toolbarError:
          state.exportPath === null
            ? message
            : `${message} · la última exportada sigue siendo ${state.exportPath}`,
        copied: false,
      }),
    copied: () => set({ ...state, toolbarError: null, copied: true }),
    copyFailed: (message) => set({ ...state, toolbarError: message, copied: false }),
  };
}

export const reviewStore = createReviewStore();

export function useReviewState(): ReviewState {
  return useSyncExternalStore(reviewStore.subscribe, reviewStore.getState);
}

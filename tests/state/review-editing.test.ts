import { describe, expect, it } from "vitest";
import type { Scope } from "@/ipc/types";
import { createReviewStore, persistableReview } from "@/state/review";
import type { ReviewComment } from "@/state/review";
import { sampleFiles } from "../helpers/fixtures";

const SCOPE: Scope = { kind: "worktree", repo: "/home/dev/local-reviewer" };

function comment(id: string, text = `nota ${id}`): ReviewComment {
  return { id, path: "src/a.ts", side: "new", from: 1, to: 2, text };
}

describe("writing a comment", () => {
  it("startComment puts the comment on the list and leaves it under edit", () => {
    const store = createReviewStore();

    store.startComment(comment("c1", ""));

    expect(store.getState().comments.map((item) => item.id)).toEqual(["c1"]);
    expect(store.getState().editing).toBe("c1");
  });

  it("setCommentText rewrites only the text of that comment", () => {
    const store = createReviewStore();
    store.startComment(comment("c1", ""));
    store.addComment(comment("c2", "intacto"));

    store.setCommentText("c1", "ya escrito");

    expect(store.getState().comments.map((item) => item.text)).toEqual([
      "ya escrito",
      "intacto",
    ]);
  });

  it("setCommentText leaves the state alone when the id is not there", () => {
    const store = createReviewStore();
    store.addComment(comment("c1"));
    const before = store.getState();

    store.setCommentText("nope", "algo");

    expect(store.getState()).toBe(before);
  });

  it("saveEditing keeps the comment and closes the editor", () => {
    const store = createReviewStore();
    store.startComment(comment("c1", ""));
    store.setCommentText("c1", "guardado");

    store.saveEditing();

    expect(store.getState().editing).toBeNull();
    expect(store.getState().comments[0].text).toBe("guardado");
  });

  it("editComment opens an existing comment without changing its anchor", () => {
    const store = createReviewStore();
    store.addComment(comment("c1", "texto anterior"));

    store.editComment("c1");

    expect(store.getState().editing).toBe("c1");
    expect(store.getState().comments[0]).toEqual(comment("c1", "texto anterior"));
  });

  it("editComment leaves the state alone when the id does not exist", () => {
    const store = createReviewStore();
    store.addComment(comment("c1"));
    const before = store.getState();

    store.editComment("missing");

    expect(store.getState()).toBe(before);
  });

  it("saving an edited comment keeps its new text", () => {
    const store = createReviewStore();
    store.addComment(comment("c1", "texto anterior"));
    store.editComment("c1");
    store.setCommentText("c1", "texto corregido");

    store.saveEditing();

    expect(store.getState().editing).toBeNull();
    expect(store.getState().comments[0].text).toBe("texto corregido");
  });

  it("cancelling an edit restores the previous text instead of deleting the comment", () => {
    const store = createReviewStore();
    store.addComment(comment("c1", "texto anterior"));
    store.editComment("c1");
    store.setCommentText("c1", "texto descartado");

    store.cancelEditing();

    expect(store.getState().editing).toBeNull();
    expect(store.getState().comments).toEqual([comment("c1", "texto anterior")]);
  });

  it("does not persist an existing comment draft until it is confirmed", () => {
    const store = createReviewStore();
    store.open(SCOPE, sampleFiles);
    store.addComment(comment("c1", "texto anterior"));
    store.editComment("c1");
    store.setCommentText("c1", "texto a medias");

    expect(persistableReview(store.getState())?.comments[0].text).toBe("texto anterior");

    store.saveEditing();

    expect(persistableReview(store.getState())?.comments[0].text).toBe("texto a medias");
  });

  it("saving an existing comment without text removes it", () => {
    const store = createReviewStore();
    store.addComment(comment("c1", "texto anterior"));
    store.editComment("c1");
    store.setCommentText("c1", "  \n ");

    store.saveEditing();

    expect(store.getState().comments).toEqual([]);
    expect(store.getState().editing).toBeNull();
  });

  it("saving a comment with nothing written in it throws it away", () => {
    const store = createReviewStore();
    store.addComment(comment("c1", "el de antes"));
    store.startComment(comment("c2", ""));

    store.saveEditing();

    expect(store.getState().comments.map((item) => item.id)).toEqual(["c1"]);
    expect(store.getState().editing).toBeNull();
  });

  it("a comment of nothing but blanks counts as written nothing", () => {
    const store = createReviewStore();
    store.startComment(comment("c1", "  \n\t "));

    store.saveEditing();

    expect(store.getState().comments).toEqual([]);
  });

  it("saveEditing with nobody writing changes nothing", () => {
    const store = createReviewStore();
    store.addComment(comment("c1"));
    const before = store.getState();

    store.saveEditing();

    expect(store.getState()).toBe(before);
  });

  it("cancelEditing throws the comment being written away", () => {
    const store = createReviewStore();
    store.addComment(comment("c1", "el de antes"));
    store.startComment(comment("c2", ""));

    store.cancelEditing();

    expect(store.getState().editing).toBeNull();
    expect(store.getState().comments.map((item) => item.id)).toEqual(["c1"]);
  });

  it("cancelEditing with nobody writing changes nothing", () => {
    const store = createReviewStore();
    store.addComment(comment("c1"));
    const before = store.getState();

    store.cancelEditing();

    expect(store.getState()).toBe(before);
  });

  it("removing the comment under edit closes the editor with it", () => {
    const store = createReviewStore();
    store.startComment(comment("c1", ""));

    store.removeComment("c1");

    expect(store.getState().editing).toBeNull();
  });
});

describe("folding a comment", () => {
  it("a comment starts unfolded and zc folds only that one", () => {
    const store = createReviewStore();
    store.addComment(comment("c1"));
    store.addComment(comment("c2"));

    store.toggleCommentFold("c1", false);

    expect(store.getState().foldedComments.has("c1")).toBe(true);
    expect(store.getState().foldedComments.has("c2")).toBe(false);
  });

  it("unfolding puts it back", () => {
    const store = createReviewStore();
    store.toggleCommentFold("c1", false);

    store.toggleCommentFold("c1", true);

    expect(store.getState().foldedComments.has("c1")).toBe(false);
  });

  it("opening another review forgets the folds and the editor", () => {
    const store = createReviewStore();
    store.startComment(comment("c1", ""));
    store.toggleCommentFold("c1", false);

    store.open(SCOPE, sampleFiles);

    expect(store.getState().foldedComments.size).toBe(0);
    expect(store.getState().editing).toBeNull();
  });
});

describe("jumping to the line of a comment", () => {
  it("openAt opens the file and lands on the row in one step", () => {
    const store = createReviewStore();
    store.open(SCOPE, sampleFiles);
    const listener = (): void => {
      seen += 1;
    };
    let seen = 0;
    store.subscribe(listener);

    store.openAt(sampleFiles[1].path, 4);

    expect(store.getState().selectedPath).toBe(sampleFiles[1].path);
    expect(store.getState().diffCursor).toBe(4);
    expect(seen).toBe(1);
  });
});

describe("restoring a saved review", () => {
  it("brings the comments back with their anchors", () => {
    const store = createReviewStore();
    store.open(SCOPE, sampleFiles);

    store.restoreComments([comment("c1", "de ayer"), comment("c2", "y esta")]);

    expect(store.getState().comments.map((item) => item.id)).toEqual(["c1", "c2"]);
    expect(store.getState().editing).toBeNull();
  });
});

describe("persistableReview", () => {
  it("is the scope, the comments and the view, and nothing of the cursors", () => {
    const store = createReviewStore();
    store.open(SCOPE, sampleFiles);
    store.addComment(comment("c1"));
    store.setDiffCursor(7);

    expect(persistableReview(store.getState())).toEqual({
      scope: SCOPE,
      comments: [comment("c1")],
      view: "unified",
    });
  });

  it("answers nothing while no review is open, so there is nowhere to save", () => {
    expect(persistableReview(createReviewStore().getState())).toBeNull();
  });
});

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import CommentsPanel from "@/panels/CommentsPanel";
import type { ReviewComment } from "@/state/review";

const stylesheet = readFileSync(resolve("src/styles.css"), "utf8");

const comment: ReviewComment = {
  id: "layout",
  path: `src/${"very-long-directory/".repeat(8)}CommentEditor.tsx`,
  side: "new",
  from: 12,
  to: 14,
  text: "",
};

function renderEditor(): {
  shell: HTMLElement;
  panel: HTMLElement;
  editor: HTMLElement;
  field: HTMLElement;
  title: HTMLElement;
} {
  render(
    <>
      <style>{stylesheet}</style>
      <div className="panels" data-testid="panels">
        <section className="panel" />
        <section className="panel" />
        <CommentsPanel
          comments={[comment]}
          cursor={0}
          active
          folded={new Set()}
          editing={comment}
          onEditorChange={() => undefined}
        />
      </div>
    </>,
  );

  const panel = screen.getByRole("region", { name: /^3 COMMENTS/ });
  const editor = panel.querySelector<HTMLElement>(".comment-editor");
  const title = panel.querySelector<HTMLElement>(".comment-editor-title");
  if (!editor || !title) throw new Error("the comment editor was not rendered");
  return {
    shell: screen.getByTestId("panels"),
    panel,
    editor,
    field: screen.getByRole("textbox"),
    title,
  };
}

describe("comments panel layout", () => {
  it("keeps the three tracks fixed when the editor appears", () => {
    const { shell, panel, editor } = renderEditor();

    expect(getComputedStyle(shell).gridTemplateColumns).toBe(
      "minmax(0, 1fr) minmax(0, 2fr) minmax(0, 1fr)",
    );
    expect(getComputedStyle(panel).minWidth).toBe("0");
    expect(getComputedStyle(editor).minWidth).toBe("0");
  });

  it("fits the textarea and a long editor title inside panel 3", () => {
    const { field, title } = renderEditor();

    expect(getComputedStyle(field).width).toBe("calc(100% - 1.5rem)");
    expect(getComputedStyle(field).minWidth).toBe("0");
    expect(getComputedStyle(title).textOverflow).toBe("ellipsis");
  });
});

import { describe, it, expect, afterEach } from "vitest";
import { act, render, screen } from "@testing-library/react";
import type { Scope } from "@/ipc/types";
import { reviewStore, useReviewState } from "@/state/review";
import { sampleFiles } from "../helpers/fixtures";

const SCOPE: Scope = { kind: "worktree", repo: "/home/dev/reviewv4" };

function FileList(): JSX.Element {
  const state = useReviewState();
  return (
    <ul>
      {state.files.map((file) => (
        <li key={file.path} aria-selected={file.path === state.selectedPath}>
          {file.path}
        </li>
      ))}
    </ul>
  );
}

function selected(): string | null {
  const marked = screen
    .getAllByRole("listitem")
    .find((item) => item.getAttribute("aria-selected") === "true");
  return marked?.textContent ?? null;
}

afterEach(() => act(() => reviewStore.open(SCOPE, [])));

describe("useReviewState", () => {
  it("starts on the empty state of the store", () => {
    render(<FileList />);

    expect(screen.queryAllByRole("listitem")).toEqual([]);
  });

  it("re-renders when the store takes in the files", () => {
    render(<FileList />);

    act(() => reviewStore.open(SCOPE, sampleFiles));

    expect(screen.getAllByRole("listitem").map((item) => item.textContent)).toEqual(
      sampleFiles.map((file) => file.path),
    );
    expect(selected()).toBe(sampleFiles[0].path);
  });

  it("re-renders when the selected file changes", () => {
    render(<FileList />);
    act(() => reviewStore.open(SCOPE, sampleFiles));

    act(() => reviewStore.selectFile(sampleFiles[2].path));

    expect(selected()).toBe(sampleFiles[2].path);
  });
});

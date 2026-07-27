/**
 * What the toolbar says after the fact, through the real app and real keys: the
 * clipboard is write-only, so the only proof the reviewer gets that `y` worked
 * is what the toolbar shows — and what it shows has to stop being true the
 * moment it stops being true.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { UserEvent } from "@testing-library/user-event";
import type { FileDiff, Scope } from "@/ipc/types";
import { COPY_PATH_KEY, EXPORT_KEY } from "@/keys/keymap";
import { restoreLayout, stubLayout } from "../helpers/diff-layout";

vi.mock("@/ipc/client", () => import("../helpers/ipc-mock"));

import App from "@/App";
import { clipboardText, configureIpc, copyToClipboard, exportReview } from "../helpers/ipc-mock";
import { reviewStore } from "@/state/review";

const SCOPE: Scope = { kind: "worktree", repo: "/home/dev/reviewv4" };
const FIRST_EXPORT = "/home/dev/.codex/reviews/review-2026-07-26.md";

const FILES: FileDiff[] = [
  {
    path: "src/a.ts",
    oldPath: null,
    status: "M",
    additions: 1,
    deletions: 0,
    hunks: [
      {
        header: "@@ -1,1 +1,2 @@",
        oldStart: 1,
        oldLines: 1,
        newStart: 1,
        newLines: 2,
        lines: [
          { kind: "context", oldNo: 1, newNo: 1, content: "const a = 1;" },
          { kind: "add", oldNo: null, newNo: 2, content: "const b = 2;" },
        ],
      },
    ],
  },
];

async function boot(): Promise<UserEvent> {
  configureIpc({ startup: { scope: SCOPE, home: "/home/dev" }, diff: FILES });
  render(<App />);
  await screen.findByRole("region", { name: /^1 ÁRBOL/ });
  const user = userEvent.setup();
  await act(async () => undefined);
  return user;
}

async function exportOnce(user: UserEvent): Promise<void> {
  const before = exportReview.mock.calls.length;
  await user.keyboard(EXPORT_KEY);
  await waitFor(() => expect(exportReview.mock.calls.length).toBe(before + 1));
}

function copySign(): HTMLElement | null {
  return screen.queryByText("copiada ✓");
}

beforeEach(() => {
  stubLayout();
});

afterEach(() => {
  restoreLayout();
  act(() => reviewStore.open(SCOPE, []));
});

describe("what the toolbar says once the path is in the clipboard", () => {
  it("says nothing about a copy nobody has asked for", async () => {
    const user = await boot();

    await exportOnce(user);

    await waitFor(() => expect(screen.getByText(FIRST_EXPORT)).toBeInTheDocument());
    expect(copySign()).toBeNull();
  });

  it("says the path is copied once it is", async () => {
    const user = await boot();
    await exportOnce(user);

    await user.keyboard(COPY_PATH_KEY);

    await waitFor(() => expect(copySign()).toBeInTheDocument());
    expect(clipboardText()).toBe(FIRST_EXPORT);
  });

  it("stops saying it the moment another export takes the place of that path", async () => {
    const user = await boot();
    await exportOnce(user);
    await user.keyboard(COPY_PATH_KEY);
    await waitFor(() => expect(copySign()).toBeInTheDocument());

    await exportOnce(user);

    await waitFor(() => expect(copySign()).toBeNull());
  });

  it("takes back the failure of a copy as soon as one works", async () => {
    const user = await boot();
    await exportOnce(user);
    copyToClipboard.mockRejectedValueOnce(new Error("sin portapapeles"));

    await user.keyboard(COPY_PATH_KEY);
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/no se pudo copiar/i));

    await user.keyboard(COPY_PATH_KEY);

    await waitFor(() => expect(copySign()).toBeInTheDocument());
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("keeps the path of the export that worked when the next one fails", async () => {
    const user = await boot();
    await exportOnce(user);
    await waitFor(() => expect(screen.getByText(FIRST_EXPORT)).toBeInTheDocument());
    exportReview.mockRejectedValueOnce(new Error("disco lleno"));

    await exportOnce(user);

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/disco lleno/));
    expect(screen.getByRole("alert")).toHaveTextContent(FIRST_EXPORT);
    expect(screen.getByText(FIRST_EXPORT)).toBeInTheDocument();

    await user.keyboard(COPY_PATH_KEY);

    await waitFor(() => expect(clipboardText()).toBe(FIRST_EXPORT));
  });
});

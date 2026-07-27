import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { FileDiff, Scope } from "@/ipc/types";
import { panel } from "../keys/helpers";
import { restoreLayout, stubLayout } from "../helpers/diff-layout";

vi.mock("@/ipc/client", () => import("../helpers/ipc-mock"));

import App from "@/App";
import { configureIpc, readBlob } from "../helpers/ipc-mock";
import { reviewStore } from "@/state/review";

const SCOPE: Scope = { kind: "worktree", repo: "/home/dev/reviewv4" };

const OLD_PATH = "src/old/Order.ts";
const NEW_PATH = "src/new/Order.ts";

const OLD_SOURCE = ["/* pedido", " * const ghost = 1;", " */", "const legacy = 1;"].join("\n");
const NEW_SOURCE = ["/* pedido", " * const ghost = 1;", " */", "const order = 2;"].join("\n");

const renamed: FileDiff = {
  path: NEW_PATH,
  oldPath: OLD_PATH,
  status: "R",
  additions: 1,
  deletions: 1,
  hunks: [
    {
      header: "@@ -2,3 +2,3 @@",
      oldStart: 2,
      oldLines: 3,
      newStart: 2,
      newLines: 3,
      lines: [
        { kind: "context", oldNo: 2, newNo: 2, content: " * const ghost = 1;" },
        { kind: "del", oldNo: 4, newNo: null, content: "const legacy = 1;" },
        { kind: "add", oldNo: null, newNo: 4, content: "const order = 2;" },
      ],
    },
  ],
};

function rowAt(index: number): HTMLElement {
  const row = panel("diff").querySelector<HTMLElement>(`[data-line-index="${index}"]`);
  if (!row) throw new Error(`la línea ${index} no está montada`);
  return row;
}

function coloursOf(index: number): string[] {
  const content = rowAt(index).querySelector<HTMLElement>("[data-line-content]");
  if (!content) throw new Error(`la línea ${index} no tiene [data-line-content]`);
  return Array.from(content.querySelectorAll<HTMLElement>("[style]"))
    .map((node) => node.style.color)
    .filter((colour) => colour !== "");
}

async function boot(): Promise<void> {
  configureIpc({
    startup: { scope: SCOPE, home: "/home/dev" },
    diff: [renamed],
    blobs: { [`old:${OLD_PATH}`]: OLD_SOURCE, [`new:${NEW_PATH}`]: NEW_SOURCE },
  });
  render(<App />);
  await screen.findByRole("region", { name: /^1 ÁRBOL/ });
  const user = userEvent.setup();
  await user.keyboard("2");
  await act(async () => undefined);
}

beforeEach(() => {
  stubLayout();
});

afterEach(() => {
  restoreLayout();
  act(() => reviewStore.open(SCOPE, []));
});

describe("a renamed file has two names, one per side", () => {
  it("reads the old side from the name the file had", async () => {
    await boot();

    expect(readBlob).toHaveBeenCalledWith(SCOPE, OLD_PATH, "old");
    expect(readBlob).toHaveBeenCalledWith(SCOPE, NEW_PATH, "new");
  });

  it("colours the deleted line with the old file it really came from", async () => {
    await boot();

    await waitFor(() => expect(coloursOf(1).length).toBeGreaterThan(1));
    expect(coloursOf(2).length).toBeGreaterThan(1);
    expect(new Set(coloursOf(0)).size).toBe(1);
  });
});

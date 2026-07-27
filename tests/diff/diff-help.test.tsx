/**
 * The footer of panel 2 is the only place the keys of the diff are written
 * down, so it has to name every family that answers there — and only those.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { UserEvent } from "@testing-library/user-event";
import type { FileDiff, Scope } from "@/ipc/types";
import { panel } from "../keys/helpers";
import { restoreLayout, stubLayout, VIEWPORT_HEIGHT } from "../helpers/diff-layout";

vi.mock("@/ipc/client", () => import("../helpers/ipc-mock"));

import App from "@/App";
import { configureIpc } from "../helpers/ipc-mock";
import { reviewStore } from "@/state/review";

const SCOPE: Scope = { kind: "worktree", repo: "/home/dev/local-reviewer" };

const SPLIT = "{Control>}w{/Control}v";

const FILE: FileDiff = {
  path: "src/a.ts",
  oldPath: null,
  status: "M",
  additions: 1,
  deletions: 1,
  hunks: [
    {
      header: "@@ -1,2 +1,2 @@",
      oldStart: 1,
      oldLines: 2,
      newStart: 1,
      newLines: 2,
      lines: [
        { kind: "context", oldNo: 1, newNo: 1, content: "const a = 1;" },
        { kind: "del", oldNo: 2, newNo: null, content: "const b = 2;" },
        { kind: "add", oldNo: null, newNo: 2, content: "const b = 3;" },
      ],
    },
  ],
};

function help(): string {
  return panel("diff").querySelector(".panel-help")?.textContent ?? "";
}

async function boot(): Promise<UserEvent> {
  configureIpc({ startup: { scope: SCOPE, home: "/home/dev" }, diff: [FILE], blobs: {} });
  render(<App />);
  await screen.findByRole("region", { name: /^1 FILES/ });
  const user = userEvent.setup();
  await user.keyboard("2");
  await act(async () => undefined);
  return user;
}

beforeEach(() => {
  stubLayout(VIEWPORT_HEIGHT);
});

afterEach(() => {
  restoreLayout();
  act(() => reviewStore.open(SCOPE, []));
});

describe("the help of panel 2 names the keys that answer in the view on show", () => {
  const MOVEMENT = [/j\/k/, /gg\/G/, /Ctrl\+d\/Ctrl\+u/, /\bv\b/, /\bc\b/];

  it("names them all in the unified view, and the key that splits it", async () => {
    await boot();

    for (const key of [...MOVEMENT, /Ctrl\+w v/]) expect(help()).toMatch(key);
    expect(help()).not.toMatch(/h\/l/);
  });

  it("names them all in the split view too, with the column keys and the way back", async () => {
    const user = await boot();

    await user.keyboard(SPLIT);

    for (const key of [...MOVEMENT, /h\/l/, /Ctrl\+w o/]) expect(help()).toMatch(key);
  });
});

/**
 * TS-42 — the toolbar: «Export Review» writes the Markdown and shows the
 * absolute path the backend answers; «Copy Path» leaves that very path in the
 * clipboard. Everything goes through `<App />`; the only thing stubbed is the
 * boundary the repo always stubs, `src/ipc/client.ts`.
 *
 * The DOM contract these tests assume (invented where the phase is silent, see
 * the phase report):
 *
 *   buttons   `role="button"` named `Export Review` and `Copy Path` — the two
 *             names the phase spells out, mockup included.
 *   shortcut  each button carries `data-shortcut` with the key id of its
 *             keymap row (`e`, `y`, `Ctrl+e`, `g e`, …). The tests press
 *             whatever it says: the phase asks for shortcuts «coherentes con
 *             la fase 2», not for two letters chosen here.
 *   path      `[data-export-path]` holds the absolute path of the last export,
 *             and is absent until something has been exported.
 *
 * The IPC surface this file pins:
 *
 *   exportReview(review, order): Promise<string>  →  invoke("export_review", { review, order })
 *   copyToClipboard(text): Promise<void>          →  the Tauri clipboard plugin
 *
 * `order` is the paths of the tree, in the order the tree shows them.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { UserEvent } from "@testing-library/user-event";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { FileDiff, Line, Review, Scope } from "@/ipc/types";
import { lineRangeLabel } from "@/comments/label";
import { headIndex, panel } from "../keys/helpers";
import { restoreLayout, stubLayout } from "../helpers/diff-layout";

const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

const writeTextMock = vi.fn();
vi.mock("@tauri-apps/plugin-clipboard-manager", () => ({
  writeText: (...args: unknown[]) => writeTextMock(...args),
}));

vi.mock("@/ipc/client", () => import("../helpers/ipc-mock"));

import App from "@/App";
import { clipboardText, configureIpc, copyToClipboard, exportReview } from "../helpers/ipc-mock";
import { reviewStore } from "@/state/review";
import type { ReviewComment } from "@/state/review";

const SCOPE: Scope = { kind: "worktree", repo: "/home/dev/reviewv4" };

const PHP_PATH = "src/UserService.php";
const ORDER_PATH = "src/order/Order.ts";
const ROOT_PATH = "README.md";

/** What the tree shows, which is neither the order of `FILES` nor the alphabet. */
const TREE_ORDER = [ORDER_PATH, PHP_PATH, ROOT_PATH];

const FIRST_EXPORT = "/home/dev/.codex/reviews/review-2026-07-26.md";
const SECOND_EXPORT = "/home/dev/.codex/reviews/review-2026-07-26-2.md";

function context(oldNo: number, newNo: number, content: string): Line {
  return { kind: "context", oldNo, newNo, content };
}

function add(newNo: number, content: string): Line {
  return { kind: "add", oldNo: null, newNo, content };
}

function file(path: string, lines: Line[]): FileDiff {
  return {
    path,
    oldPath: null,
    status: "M",
    additions: lines.filter((line) => line.kind === "add").length,
    deletions: 0,
    hunks: [
      {
        header: `@@ -33,2 +33,${lines.length} @@`,
        oldStart: 33,
        oldLines: 2,
        newStart: 33,
        newLines: lines.length,
        lines,
      },
    ],
  };
}

const FILES: FileDiff[] = [
  file(PHP_PATH, [
    context(33, 33, "  public function save(User $u) {"),
    context(34, 34, "    $this->validate($u);"),
    add(35, "    if (!$u->email) {"),
    add(36, "      throw new BadRequest('email');"),
    add(37, "    }"),
  ]),
  file(ROOT_PATH, [context(33, 33, "# reviewv4"), add(34, "Un revisor de escritorio.")]),
  file(ORDER_PATH, [context(33, 33, "export interface Order {"), add(34, "  id: string;")]),
];

// --- reaching into the DOM ---------------------------------------------------

function exportButton(): HTMLElement {
  return screen.getByRole("button", { name: /^Export Review/ });
}

function copyButton(): HTMLElement {
  return screen.getByRole("button", { name: /^Copy Path/ });
}

function shownPath(): string | null {
  const node = document.querySelector<HTMLElement>("[data-export-path]");
  return node === null ? null : (node.textContent ?? "").trim();
}

function treeFileOrder(): string[] {
  return within(panel("tree"))
    .getAllByRole("option")
    .filter((row) => row.getAttribute("data-kind") === "file")
    .map((row) => row.getAttribute("data-path") ?? "");
}

const MODIFIERS: Record<string, string> = {
  Ctrl: "Control",
  Control: "Control",
  Shift: "Shift",
  Alt: "Alt",
  Meta: "Meta",
};

/** Turns the key id a button advertises (`e`, `Ctrl+e`, `g e`) into keystrokes. */
function keystrokes(shortcut: string): string {
  return shortcut
    .split(" ")
    .filter((part) => part.length > 0)
    .map((keyId) => {
      const parts = keyId.split("+");
      const key = parts[parts.length - 1];
      const typed = key.length === 1 ? key : `{${key}}`;
      return parts.slice(0, -1).reduceRight((inner, name) => {
        const modifier = MODIFIERS[name];
        if (!modifier) throw new Error(`atajo con modificador desconocido: ${keyId}`);
        return `{${modifier}>}${inner}{/${modifier}}`;
      }, typed);
    })
    .join("");
}

function shortcutOf(button: HTMLElement): string {
  const raw = (button.getAttribute("data-shortcut") ?? "").trim();
  if (raw === "") {
    throw new Error(`el botón «${button.textContent ?? ""}» no anuncia ningún atajo de teclado`);
  }
  return raw;
}

// --- booting -----------------------------------------------------------------

async function boot(exportPaths: string[] = [FIRST_EXPORT]): Promise<UserEvent> {
  configureIpc({ startup: { scope: SCOPE, home: "/home/dev" }, diff: FILES, exportPaths });
  render(<App />);
  await screen.findByRole("region", { name: /^1 ÁRBOL/ });
  const user = userEvent.setup();
  await act(async () => undefined);
  return user;
}

function seeded(id: string, path: string, from: number, to: number, text: string): ReviewComment {
  return { id, path, side: "new", from, to, text };
}

const COMMENTS: ReviewComment[] = [
  seeded("c1", PHP_PATH, 35, 37, "El método tiene demasiadas responsabilidades."),
  seeded("c2", ORDER_PATH, 34, 34, "El nombre no refleja lo que hace."),
];

function seed(...comments: ReviewComment[]): void {
  act(() => {
    for (const item of comments) reviewStore.addComment(item);
  });
}

function expectedReview(): Review {
  return { scope: SCOPE, comments: COMMENTS, view: "unified" };
}

async function exportOnce(user: UserEvent): Promise<void> {
  const before = exportReview.mock.calls.length;
  await user.click(exportButton());
  await waitFor(() => expect(exportReview.mock.calls.length).toBe(before + 1));
}

beforeEach(() => {
  stubLayout();
  invokeMock.mockReset();
  writeTextMock.mockReset();
});

afterEach(() => {
  restoreLayout();
  act(() => reviewStore.open(SCOPE, []));
});

// -----------------------------------------------------------------------------
// TS-42 — Export Review
// -----------------------------------------------------------------------------

describe("Export Review writes the Markdown and shows where it landed", () => {
  it("TS-42: exports the review on screen, in the order of the tree", async () => {
    const user = await boot();
    seed(...COMMENTS);

    await exportOnce(user);

    expect(exportReview).toHaveBeenCalledTimes(1);
    const [review, order] = exportReview.mock.calls[0];
    expect(review).toEqual(expectedReview());
    expect(order).toEqual(TREE_ORDER);
    expect(order).toEqual(treeFileOrder());
  });

  it("TS-42: shows the absolute path the backend answers, not one built here", async () => {
    const user = await boot([SECOND_EXPORT]);
    seed(...COMMENTS);
    expect(shownPath()).toBeNull();

    await exportOnce(user);

    await waitFor(() => expect(shownPath()).toBe(SECOND_EXPORT));
    expect(screen.getByText(SECOND_EXPORT)).toBeInTheDocument();
  });

  it("TS-42: exporting again shows the new path and leaves the old one behind", async () => {
    const user = await boot([FIRST_EXPORT, SECOND_EXPORT]);
    seed(...COMMENTS);

    await exportOnce(user);
    await waitFor(() => expect(shownPath()).toBe(FIRST_EXPORT));

    await exportOnce(user);

    await waitFor(() => expect(shownPath()).toBe(SECOND_EXPORT));
    expect(screen.queryByText(FIRST_EXPORT)).toBeNull();
  });

  it("TS-42: the order handed over does not depend on which folders are folded", async () => {
    const user = await boot();
    seed(...COMMENTS);

    // `h` on the first row folds `src`, which hides two of the three files.
    await user.keyboard("1h");
    expect(treeFileOrder()).toEqual([ROOT_PATH]);

    await exportOnce(user);

    expect(exportReview.mock.calls[0][1]).toEqual(TREE_ORDER);
  });

  it("TS-42: a review with no comments is exported all the same", async () => {
    const user = await boot();

    await exportOnce(user);

    expect(exportReview.mock.calls[0][0]).toEqual({ scope: SCOPE, comments: [], view: "unified" });
    await waitFor(() => expect(shownPath()).toBe(FIRST_EXPORT));
  });

  it("TS-42: an export that fails says so and shows no path at all", async () => {
    const user = await boot();
    seed(...COMMENTS);
    exportReview.mockRejectedValueOnce(new Error("permiso denegado"));

    await exportOnce(user);

    await waitFor(() => expect(document.body).toHaveTextContent(/no se pudo/i));
    expect(shownPath()).toBeNull();
    await user.click(copyButton());
    expect(clipboardText()).toBeNull();
  });

  it("TS-42: the keyboard still owns the app after clicking a button", async () => {
    const user = await boot();
    seed(...COMMENTS);

    await exportOnce(user);

    await user.keyboard("1jj");
    expect(headIndex("tree")).toBe(2);
  });
});

// -----------------------------------------------------------------------------
// TS-42 — Copy Path
// -----------------------------------------------------------------------------

describe("Copy Path puts the exported path in the clipboard", () => {
  it("TS-42: copies the very path the toolbar shows", async () => {
    const user = await boot();
    seed(...COMMENTS);
    await exportOnce(user);
    await waitFor(() => expect(shownPath()).toBe(FIRST_EXPORT));

    await user.click(copyButton());

    await waitFor(() => expect(clipboardText()).toBe(FIRST_EXPORT));
    expect(clipboardText()).toBe(shownPath());
    expect(copyToClipboard).toHaveBeenCalledTimes(1);
    expect(exportReview).toHaveBeenCalledTimes(1);
  });

  it("TS-42: with nothing exported yet it copies nothing", async () => {
    const user = await boot();
    seed(...COMMENTS);

    await user.click(copyButton());
    await act(async () => undefined);

    expect(clipboardText()).toBeNull();
    expect(copyToClipboard).not.toHaveBeenCalled();
    expect(shownPath()).toBeNull();
  });

  it("TS-42: after a second export it copies the second path", async () => {
    const user = await boot([FIRST_EXPORT, SECOND_EXPORT]);
    seed(...COMMENTS);

    await exportOnce(user);
    await user.click(copyButton());
    await waitFor(() => expect(clipboardText()).toBe(FIRST_EXPORT));

    await exportOnce(user);
    await user.click(copyButton());

    await waitFor(() => expect(clipboardText()).toBe(SECOND_EXPORT));
  });
});

// -----------------------------------------------------------------------------
// TS-42 — keyboard first: the two buttons are two keymap rows
// -----------------------------------------------------------------------------

describe("both buttons answer the keyboard", () => {
  it("TS-42: the advertised shortcut of Export Review does what the click does", async () => {
    const user = await boot();
    seed(...COMMENTS);

    await user.keyboard(keystrokes(shortcutOf(exportButton())));

    await waitFor(() => expect(exportReview).toHaveBeenCalledTimes(1));
    expect(exportReview.mock.calls[0][0]).toEqual(expectedReview());
    await waitFor(() => expect(shownPath()).toBe(FIRST_EXPORT));
  });

  it("TS-42: the advertised shortcut of Copy Path copies the exported path", async () => {
    const user = await boot();
    seed(...COMMENTS);
    const copy = shortcutOf(copyButton());
    expect(copy).not.toBe(shortcutOf(exportButton()));

    await user.keyboard(keystrokes(copy));
    await act(async () => undefined);
    expect(clipboardText()).toBeNull();

    await exportOnce(user);
    await user.keyboard(keystrokes(copy));

    await waitFor(() => expect(clipboardText()).toBe(FIRST_EXPORT));
  });

  it("TS-42: neither shortcut fires while a comment is being written", async () => {
    const user = await boot();
    const exportKeys = keystrokes(shortcutOf(exportButton()));
    const copyKeys = keystrokes(shortcutOf(copyButton()));

    await user.keyboard("2ggvj");
    await user.keyboard("c");
    expect(screen.getByText("INSERT")).toBeInTheDocument();

    await user.keyboard(exportKeys);
    await user.keyboard(copyKeys);
    await act(async () => undefined);

    expect(exportReview).not.toHaveBeenCalled();
    expect(clipboardText()).toBeNull();
    expect(screen.getByText("INSERT")).toBeInTheDocument();
  });
});

// -----------------------------------------------------------------------------
// TS-42 — the boundary itself: what the client sends to the backend
// -----------------------------------------------------------------------------

describe("the ipc client is the only thing that talks to the system", () => {
  it("TS-42: exportReview invokes export_review with the review and the order", async () => {
    const client = await vi.importActual<typeof import("@/ipc/client")>("@/ipc/client");
    invokeMock.mockResolvedValue(FIRST_EXPORT);

    const review = expectedReview();
    const answered = await client.exportReview(review, TREE_ORDER);

    expect(invokeMock).toHaveBeenCalledWith("export_review", { review, order: TREE_ORDER });
    expect(answered).toBe(FIRST_EXPORT);
  });

  it("TS-42: copyToClipboard writes the text through the Tauri clipboard plugin", async () => {
    const client = await vi.importActual<typeof import("@/ipc/client")>("@/ipc/client");
    writeTextMock.mockResolvedValue(undefined);

    await client.copyToClipboard(FIRST_EXPORT);

    expect(writeTextMock).toHaveBeenCalledWith(FIRST_EXPORT);
  });
});

// -----------------------------------------------------------------------------
// TS-40 — the other half of the shared wording fixture
// -----------------------------------------------------------------------------

interface LabelCase {
  from: number;
  to: number;
  label: string;
}

/**
 * `src-tauri/tests/export.rs` asserts the Markdown against this very file: the
 * wording of an anchor lives twice, in TypeScript for the panel and in Rust for
 * the export, and this is what keeps the two copies from drifting apart.
 */
describe("the wording of a line range is shared with the exporter", () => {
  it("TS-40: lineRangeLabel answers exactly what the export fixture pins", () => {
    const raw = readFileSync(join(process.cwd(), "tests/fixtures/line-range-labels.json"), "utf8");
    const cases = JSON.parse(raw) as LabelCase[];
    expect(cases.length).toBeGreaterThanOrEqual(9);

    for (const { from, to, label } of cases) {
      expect(lineRangeLabel(from, to)).toBe(label);
    }
  });
});

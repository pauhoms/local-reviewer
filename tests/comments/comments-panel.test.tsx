/**
 * TS-31..TS-34 — panel 3: the comment cycle, the list, `dd` and resuming a
 * review. Everything goes through `<App />` and real keyboard events.
 *
 * The DOM contract these tests assume (invented where the spec is silent, see
 * the phase report):
 *
 *   panel 3   `role="region"` named `3 COMENTARIOS` (already the case).
 *   entry     `role="option"` inside it, with `data-comment-id`, `data-path`,
 *             `data-comment-side` (`old` / `new`), `aria-selected` +
 *             `data-cursor` for the cursor and `aria-expanded` for the fold.
 *   range     `[data-comment-range]` inside the entry: `Línea 35` for one line,
 *             `Líneas 35-37` for a range — the wording TS-40 fixes for the export.
 *   summary   `[data-comment-summary]` inside the entry, gone while it is folded.
 *   editor    a `textbox` (textarea) inside panel 3, mounted only while editing.
 *   resume    text matching /retomar/i naming how many comments are waiting;
 *             `Enter` accepts, `Esc` declines.
 *
 * Keys: `zc` / `zo` fold and unfold (the phase mockup's help line),
 * `Ctrl+Enter` saves and `Esc` cancels (the phase mockup's help line).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { UserEvent } from "@testing-library/user-event";
import type { Comment, FileDiff, Line, Review, Scope } from "@/ipc/types";
import { panel } from "../keys/helpers";
import { restoreLayout, stubLayout } from "../helpers/diff-layout";

vi.mock("@/ipc/client", () => import("../helpers/ipc-mock"));

import App from "@/App";
import { configureIpc, loadReview, saveReview } from "../helpers/ipc-mock";
import { reviewStore } from "@/state/review";
import type { ReviewComment } from "@/state/review";

const SCOPE: Scope = { kind: "worktree", repo: "/home/dev/reviewv4" };

function context(oldNo: number, newNo: number, content: string): Line {
  return { kind: "context", oldNo, newNo, content };
}

function add(newNo: number, content: string): Line {
  return { kind: "add", oldNo: null, newNo, content };
}

function del(oldNo: number, content: string): Line {
  return { kind: "del", oldNo, newNo: null, content };
}

const PHP_PATH = "src/UserService.php";
const TS_PATH = "web/Order.ts";
const GONE_PATH = "web/legacy.ts";

/**
 * Row index, old number and new number are three different numbers on purpose:
 * an anchor that stored the row index, or a jump that read the line number as
 * an index, would pass a fixture where they happen to agree.
 *
 *   idx  kind     old  new
 *    0   context   33   33
 *    1   context   34   34
 *    2   add        ·   35
 *    3   add        ·   36
 *    4   add        ·   37
 *    5   del       35    ·
 *    6   del       36    ·
 *    7   add        ·   38
 *    8   context   37   39
 *    9   context   98  100
 *   10   add        ·  101
 *   11   context   99  102
 */
const phpFile: FileDiff = {
  path: PHP_PATH,
  oldPath: null,
  status: "M",
  additions: 5,
  deletions: 2,
  hunks: [
    {
      header: "@@ -33,5 +33,7 @@ class UserService",
      oldStart: 33,
      oldLines: 5,
      newStart: 33,
      newLines: 7,
      lines: [
        context(33, 33, "  public function save(User $u) {"),
        context(34, 34, "    $this->validate($u);"),
        add(35, "    if (!$u->email) {"),
        add(36, "      throw new BadRequest('email');"),
        add(37, "    }"),
        del(35, "    $this->repo->persist($u);"),
        del(36, "    $this->repo->flush();"),
        add(38, "    $this->repo->save($u);"),
        context(37, 39, "  }"),
      ],
    },
    {
      header: "@@ -98,3 +100,4 @@ class UserService",
      oldStart: 98,
      oldLines: 3,
      newStart: 100,
      newLines: 4,
      lines: [
        context(98, 100, "  private function map(array $r) {"),
        add(101, "    $r['id'] = (int) $r['id'];"),
        context(99, 102, "    return new User($r);"),
      ],
    },
  ],
};

const tsFile: FileDiff = {
  path: TS_PATH,
  oldPath: null,
  status: "A",
  additions: 3,
  deletions: 0,
  hunks: [
    {
      header: "@@ -0,0 +1,3 @@",
      oldStart: 0,
      oldLines: 0,
      newStart: 1,
      newLines: 3,
      lines: [add(1, "export interface Order {"), add(2, "  id: string;"), add(3, "}")],
    },
  ],
};

const goneFile: FileDiff = {
  path: GONE_PATH,
  oldPath: null,
  status: "D",
  additions: 0,
  deletions: 2,
  hunks: [
    {
      header: "@@ -1,2 +0,0 @@",
      oldStart: 1,
      oldLines: 2,
      newStart: 0,
      newLines: 0,
      lines: [del(1, "export const legacy = true;"), del(2, "export const gone = 1;")],
    },
  ],
};

/** `src/UserService.php` is the first file of the tree, so it opens by itself. */
const FILES: FileDiff[] = [phpFile, tsFile];

// --- reaching into the DOM ---------------------------------------------------

function commentsPanel(): HTMLElement {
  return panel("comments");
}

function entries(): HTMLElement[] {
  return within(commentsPanel())
    .queryAllByRole("option")
    .filter((node) => node.hasAttribute("data-comment-id"));
}

function entryIds(): string[] {
  return entries().map((node) => node.getAttribute("data-comment-id") ?? "");
}

/** Comments on screen without asking for panel 3, which may not be up yet. */
function commentEntriesAnywhere(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>("[data-comment-id]"));
}

function entryOf(id: string): HTMLElement {
  const found = entries().find((node) => node.getAttribute("data-comment-id") === id);
  if (!found) throw new Error(`no hay entrada para ${id}; hay ${entryIds().join(", ")}`);
  return found;
}

function partOf(entry: HTMLElement, attribute: string): HTMLElement | null {
  return entry.querySelector<HTMLElement>(`[${attribute}]`);
}

function textOf(node: Element | null): string {
  return (node?.textContent ?? "").replace(/\s+/g, " ").trim();
}

function rangeOf(id: string): string {
  const node = partOf(entryOf(id), "data-comment-range");
  if (!node) throw new Error(`la entrada ${id} no expone [data-comment-range]`);
  return textOf(node);
}

function summaryOf(id: string): string | null {
  const node = partOf(entryOf(id), "data-comment-summary");
  return node === null ? null : node.textContent ?? "";
}

function sideOf(id: string): string | null {
  return entryOf(id).getAttribute("data-comment-side");
}

function pathOf(id: string): string | null {
  return entryOf(id).getAttribute("data-path");
}

function cursorId(): string | null {
  const marked = entries().filter((node) => node.getAttribute("data-cursor") === "true");
  if (marked.length > 1) {
    throw new Error(`hay ${marked.length} comentarios con cursor a la vez`);
  }
  return marked[0]?.getAttribute("data-comment-id") ?? null;
}

function editor(): HTMLTextAreaElement | null {
  const node = within(commentsPanel()).queryByRole("textbox");
  return node === null ? null : (node as HTMLTextAreaElement);
}

function requireEditor(): HTMLTextAreaElement {
  const node = editor();
  if (node === null) throw new Error("el panel 3 no tiene ningún editor montado");
  return node;
}

function diffPanel(): HTMLElement {
  return panel("diff");
}

function diffRows(): HTMLElement[] {
  return Array.from(diffPanel().querySelectorAll<HTMLElement>("[data-line-index]"));
}

function diffCursorIndex(): number {
  const marked = diffRows().filter((row) => row.getAttribute("data-cursor") === "true");
  if (marked.length > 1) throw new Error(`hay ${marked.length} líneas con cursor a la vez`);
  if (marked.length === 0) return -1;
  return Number(marked[0].getAttribute("data-line-index"));
}

function treeRowAt(path: string): HTMLElement {
  const row = within(panel("tree"))
    .getAllByRole("option")
    .find((node) => node.getAttribute("data-path") === path);
  if (!row) throw new Error(`el árbol no tiene fila para ${path}`);
  return row;
}

function activePanels(): string[] {
  return (["tree", "diff", "comments"] as const).filter(
    (name) => panel(name).getAttribute("data-active") === "true",
  );
}

function mode(): string {
  for (const name of ["NORMAL", "VISUAL", "INSERT"]) {
    if (screen.queryByText(name) !== null) return name;
  }
  throw new Error("la cabecera no muestra ningún modo");
}

function lastSaved(): Review {
  const calls = saveReview.mock.calls;
  if (calls.length === 0) throw new Error("nadie ha llamado a save_review todavía");
  return calls[calls.length - 1][0];
}

/** One task for the whole burst: the shape a key repeat takes, with no render in between. */
function burst(...keys: Array<string | KeyboardEventInit>): void {
  act(() => {
    for (const entry of keys) {
      const init = typeof entry === "string" ? { key: entry } : entry;
      document.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, ...init }));
    }
  });
}

// --- booting -----------------------------------------------------------------

function setUp(files: FileDiff[] = FILES, reviews: Review[] = []): void {
  configureIpc({
    startup: { scope: SCOPE, home: "/home/dev" },
    diff: files,
    reviews,
  });
}

async function boot(files: FileDiff[] = FILES): Promise<UserEvent> {
  setUp(files);
  render(<App />);
  await screen.findByRole("region", { name: /^1 ÁRBOL/ });
  const user = userEvent.setup();
  await act(async () => undefined);
  return user;
}

async function type(user: UserEvent, keys: string): Promise<void> {
  if (keys.length > 0) await user.keyboard(keys);
}

/** Walks the diff to `from`, selects down to `to` and presses `c`. */
async function select(user: UserEvent, from: number, to: number): Promise<void> {
  await user.keyboard("2");
  await user.keyboard("gg");
  await type(user, "j".repeat(from));
  await user.keyboard("v");
  await type(user, "j".repeat(to - from));
  await user.keyboard("c");
}

/** The whole cycle: select, `c`, write, `Ctrl+Enter`. Answers the new id. */
async function writeComment(
  user: UserEvent,
  from: number,
  to: number,
  text: string,
): Promise<string> {
  const before = entryIds();
  await select(user, from, to);
  await type(user, text);
  await user.keyboard("{Control>}{Enter}{/Control}");
  const fresh = entryIds().filter((id) => !before.includes(id));
  if (fresh.length !== 1) {
    throw new Error(`se esperaba un comentario nuevo, aparecieron ${fresh.length}`);
  }
  return fresh[0];
}

function seeded(id: string, path: string, from: number, to: number, text: string): ReviewComment {
  return { id, path, side: "new", from, to, text };
}

function seed(...comments: ReviewComment[]): void {
  act(() => {
    for (const item of comments) reviewStore.addComment(item);
  });
}

function storedReview(comments: Comment[]): Review {
  return { scope: SCOPE, comments, view: "unified" };
}

beforeEach(() => {
  stubLayout();
});

afterEach(() => {
  restoreLayout();
  act(() => reviewStore.open(SCOPE, []));
});

// -----------------------------------------------------------------------------
// TS-31 — the cycle: selection → c → editor → save → back to the diff
// -----------------------------------------------------------------------------

describe("c turns a visual selection into a comment", () => {
  it("TS-31: c anchors the range, moves the focus to the editor and enters insert", async () => {
    const user = await boot();

    await user.keyboard("2");
    await user.keyboard("gg");
    await user.keyboard("jjv");
    await user.keyboard("jj");
    expect(mode()).toBe("VISUAL");

    await user.keyboard("c");

    expect(mode()).toBe("INSERT");
    expect(activePanels()).toEqual(["comments"]);
    expect(entryIds()).toHaveLength(1);
    expect(rangeOf(entryIds()[0])).toBe("Líneas 35-37");
    expect(requireEditor()).toHaveFocus();
    expect(requireEditor()).toHaveValue("");
  });

  it("TS-31: what is typed lands in the editor and is kept when it is saved", async () => {
    const user = await boot();
    await select(user, 2, 4);

    await user.keyboard("Separar validación de persistencia.");
    expect(requireEditor()).toHaveValue("Separar validación de persistencia.");

    await user.keyboard("{Control>}{Enter}{/Control}");

    const id = entryIds()[0];
    expect(summaryOf(id)).toContain("Separar validación de persistencia.");
  });

  it("TS-31: saving goes back to the diff in normal mode and leaves no editor", async () => {
    const user = await boot();
    await select(user, 2, 4);
    await user.keyboard("un apunte");

    await user.keyboard("{Control>}{Enter}{/Control}");

    expect(mode()).toBe("NORMAL");
    expect(activePanels()).toEqual(["diff"]);
    expect(editor()).toBeNull();
    expect(commentsPanel().contains(document.activeElement)).toBe(false);

    // The diff answers the keyboard again, right where the selection was left.
    await user.keyboard("j");
    expect(diffCursorIndex()).toBe(5);
  });

  it("TS-31: the saved comment reaches the state file through save_review", async () => {
    const user = await boot();

    const id = await writeComment(user, 2, 4, "hay que separar esto");

    await waitFor(() => {
      const saved = lastSaved().comments.find((comment) => comment.id === id);
      expect(saved).toEqual({
        id,
        path: PHP_PATH,
        side: "new",
        from: 35,
        to: 37,
        text: "hay que separar esto",
      });
    });
    expect(lastSaved().scope).toEqual(SCOPE);
  });

  it("TS-31: Esc throws away the comment that was being written", async () => {
    const user = await boot();
    await select(user, 2, 4);
    await user.keyboard("esto no se guarda");
    expect(entryIds()).toHaveLength(1);
    expect(treeRowAt(PHP_PATH)).toHaveTextContent(/●\s*1/);

    await user.keyboard("{Escape}");

    expect(mode()).toBe("NORMAL");
    expect(entries()).toHaveLength(0);
    expect(editor()).toBeNull();
    expect(treeRowAt(PHP_PATH)).not.toHaveTextContent("●");
    // Cancelling leaves the reader where he was reading, same as saving does.
    expect(activePanels()).toEqual(["diff"]);
    await user.keyboard("j");
    expect(diffCursorIndex()).toBe(5);
  });

  it("TS-31: Esc with nothing written throws the comment away just the same", async () => {
    const user = await boot();
    await select(user, 5, 5);
    expect(entryIds()).toHaveLength(1);
    expect(requireEditor()).toHaveValue("");

    await user.keyboard("{Escape}");

    expect(entries()).toHaveLength(0);
    expect(mode()).toBe("NORMAL");
  });

  it("TS-31: c does nothing outside the diff, where there is no line to anchor to", async () => {
    const user = await boot();

    await user.keyboard("2v");
    await user.keyboard("3");
    await user.keyboard("c");

    expect(entries()).toHaveLength(0);
    expect(editor()).toBeNull();
    expect(mode()).toBe("VISUAL");

    await user.keyboard("2c");
    expect(entryIds()).toHaveLength(1);
    expect(mode()).toBe("INSERT");
  });

  it("TS-31: a whole burst of keys still lands in the editor with the right anchor", async () => {
    await boot();

    burst("2", "v", "j", "c");

    expect(mode()).toBe("INSERT");
    expect(entryIds()).toHaveLength(1);
    expect(rangeOf(entryIds()[0])).toBe("Líneas 33-34");
    expect(requireEditor()).toHaveFocus();
  });
});

describe("insert mode hands every key to the editor", () => {
  it("TS-31: letters that are shortcuts are typed instead of obeyed", async () => {
    const user = await boot();
    seed(seeded("seed", TS_PATH, 1, 1, "un comentario que ya estaba"));
    await select(user, 2, 4);
    const before = diffCursorIndex();

    await user.keyboard("jkdd gg 123 vc");

    expect(requireEditor()).toHaveValue("jkdd gg 123 vc");
    expect(mode()).toBe("INSERT");
    expect(activePanels()).toEqual(["comments"]);
    expect(diffCursorIndex()).toBe(before);
    expect(entryIds()).toContain("seed");
    expect(entryIds()).toHaveLength(2);
  });

  it("TS-31: dd while writing deletes nothing", async () => {
    const user = await boot();
    seed(
      seeded("a", PHP_PATH, 35, 35, "primero"),
      seeded("b", PHP_PATH, 36, 36, "segundo"),
    );
    await select(user, 9, 9);

    await user.keyboard("dd");

    expect(entryIds()).toEqual(expect.arrayContaining(["a", "b"]));
    expect(entries()).toHaveLength(3);
    expect(requireEditor()).toHaveValue("dd");
  });

  it("TS-31: a text with newlines, quotes and backslashes survives the round trip", async () => {
    const user = await boot();
    const text = 'Falta un "guard": si $u es null\npetará aquí \\ y allí. Año señal.';

    const id = await writeComment(user, 2, 4, text);

    await waitFor(() => {
      const saved = lastSaved().comments.find((comment) => comment.id === id);
      expect(saved?.text).toBe(text);
    });
    // The list is one line per comment: the second line must not break the row.
    expect(summaryOf(id)).not.toContain("\n");
  });
});

// -----------------------------------------------------------------------------
// TS-31 (cont.) — which side the anchor lands on and with which numbers
// -----------------------------------------------------------------------------

describe("the anchor takes the side of the lines it covers", () => {
  it("TS-31: a selection of added lines anchors to the new side with its numbers", async () => {
    const user = await boot();

    const id = await writeComment(user, 2, 4, "nota");

    expect(sideOf(id)).toBe("new");
    expect(rangeOf(id)).toBe("Líneas 35-37");
    await waitFor(() => {
      expect(lastSaved().comments[0]).toMatchObject({ side: "new", from: 35, to: 37 });
    });
  });

  it("TS-31: a selection of nothing but deletions anchors to the old side", async () => {
    const user = await boot();

    const id = await writeComment(user, 5, 6, "esto se va");

    expect(sideOf(id)).toBe("old");
    expect(rangeOf(id)).toBe("Líneas 35-36");
    await waitFor(() => {
      expect(lastSaved().comments[0]).toMatchObject({ side: "old", from: 35, to: 36 });
    });
  });

  it("TS-31: one deleted line alone is a single line anchor of the old side", async () => {
    const user = await boot();

    const id = await writeComment(user, 6, 6, "y esta también");

    expect(sideOf(id)).toBe("old");
    expect(rangeOf(id)).toBe("Línea 36");
    await waitFor(() => {
      expect(lastSaved().comments[0]).toMatchObject({ side: "old", from: 36, to: 36 });
    });
  });

  it("TS-31: a mixed selection takes the new side and only its new numbers", async () => {
    const user = await boot();

    // Rows 4..7: add(new 37), del(old 35), del(old 36), add(new 38).
    const id = await writeComment(user, 4, 7, "mezcla");

    expect(sideOf(id)).toBe("new");
    expect(rangeOf(id)).toBe("Líneas 37-38");
    await waitFor(() => {
      expect(lastSaved().comments[0]).toMatchObject({ side: "new", from: 37, to: 38 });
    });
  });

  it("TS-31: a context line anchors to the new side by its new number", async () => {
    const user = await boot();

    const id = await writeComment(user, 9, 9, "contexto");

    expect(sideOf(id)).toBe("new");
    expect(rangeOf(id)).toBe("Línea 100");
  });

  it("TS-31: a selection across two hunks keeps the ends of the new side", async () => {
    const user = await boot();

    const id = await writeComment(user, 7, 10, "de un hunk al otro");

    expect(sideOf(id)).toBe("new");
    expect(rangeOf(id)).toBe("Líneas 38-101");
  });

  it("TS-31: the first and the last line of a file are both anchorable", async () => {
    const user = await boot();

    await user.keyboard("1jjj{Enter}");
    expect(diffPanel()).toHaveTextContent(TS_PATH);

    const first = await writeComment(user, 0, 0, "la primera");
    expect(rangeOf(first)).toBe("Línea 1");

    const last = await writeComment(user, 2, 2, "la última");
    expect(rangeOf(last)).toBe("Línea 3");
    expect(pathOf(last)).toBe(TS_PATH);
  });

  it("TS-31: a file that is nothing but deletions anchors every comment to the old side", async () => {
    const user = await boot([goneFile]);

    const id = await writeComment(user, 0, 1, "adiós");

    expect(sideOf(id)).toBe("old");
    expect(rangeOf(id)).toBe("Líneas 1-2");
    expect(pathOf(id)).toBe(GONE_PATH);
  });
});

// -----------------------------------------------------------------------------
// TS-32 — the list
// -----------------------------------------------------------------------------

describe("the list shows every comment", () => {
  it("TS-32: says so when there is not a single comment yet", async () => {
    await boot();

    expect(entries()).toHaveLength(0);
    expect(commentsPanel()).toHaveTextContent(/sin comentarios|no hay comentarios/i);
  });

  it("TS-32: every entry carries its file, its line range and a short summary", async () => {
    await boot();
    seed(
      seeded("c1", PHP_PATH, 35, 48, "El método tiene demasiadas responsabilidades."),
      seeded("c2", PHP_PATH, 102, 102, "Evitar duplicación del try/catch."),
      seeded("c3", TS_PATH, 15, 26, "El nombre no refleja lo que hace."),
    );

    expect(entryIds()).toHaveLength(3);

    expect(pathOf("c1")).toBe(PHP_PATH);
    expect(entryOf("c1")).toHaveTextContent("UserService.php");
    expect(rangeOf("c1")).toBe("Líneas 35-48");
    expect(summaryOf("c1")).toContain("El método tiene demasiadas responsabilidades.");

    expect(rangeOf("c2")).toBe("Línea 102");
    expect(entryOf("c3")).toHaveTextContent("Order.ts");
    expect(rangeOf("c3")).toBe("Líneas 15-26");
  });

  it("TS-32: a long text is cut down to a summary, not shown whole", async () => {
    await boot();
    const long =
      "El método mezcla validación, persistencia y notificación, y además " +
      "abre la transacción por su cuenta, con lo que nadie puede reutilizarlo " +
      "desde otro caso de uso sin arrastrar todo lo demás detrás.";
    seed(seeded("c1", PHP_PATH, 35, 48, long));

    const shown = summaryOf("c1") ?? "";
    expect(shown.length).toBeLessThan(long.length);
    expect(shown.endsWith("…")).toBe(true);
    const head = shown.slice(0, -1).trimEnd();
    expect(head.length).toBeGreaterThan(0);
    expect(long.startsWith(head)).toBe(true);
  });

  it("TS-32: a text of several lines is summarised on one line", async () => {
    await boot();
    seed(seeded("c1", PHP_PATH, 35, 35, "primera línea\nsegunda línea\ntercera"));

    const shown = summaryOf("c1") ?? "";
    expect(shown).toContain("primera línea");
    expect(shown).not.toContain("\n");
  });

  it("TS-32: j and k walk the entries and the cursor marks one at a time", async () => {
    const user = await boot();
    seed(
      seeded("c1", PHP_PATH, 35, 35, "uno"),
      seeded("c2", PHP_PATH, 36, 36, "dos"),
      seeded("c3", TS_PATH, 1, 1, "tres"),
    );
    const ids = entryIds();
    expect(ids).toHaveLength(3);

    await user.keyboard("3");
    expect(cursorId()).toBe(ids[0]);

    await user.keyboard("jj");
    expect(cursorId()).toBe(ids[2]);

    await user.keyboard("j");
    expect(cursorId()).toBe(ids[2]);

    await user.keyboard("gg");
    expect(cursorId()).toBe(ids[0]);

    await user.keyboard("{Shift>}G{/Shift}");
    expect(cursorId()).toBe(ids[2]);
  });

  it("TS-32: Enter opens the file of the comment and lands on its line", async () => {
    const user = await boot();
    // New line 101 is row 10 of the diff and old line 36 is row 6: neither
    // number is its index, so a jump that confuses the two lands elsewhere.
    seed(
      seeded("c1", PHP_PATH, 101, 101, "en el segundo hunk"),
      { id: "c2", path: PHP_PATH, side: "old", from: 36, to: 36, text: "en el lado viejo" },
      seeded("c3", TS_PATH, 2, 2, "en el otro fichero"),
    );
    const row: Record<string, number> = { c1: 10, c2: 6, c3: 1 };
    const file: Record<string, string> = { c1: PHP_PATH, c2: PHP_PATH, c3: TS_PATH };

    await user.keyboard("3");
    for (let step = 0; step < 3; step += 1) {
      const id = cursorId() ?? "";
      expect(row[id]).toBeDefined();

      await user.keyboard("{Enter}");

      expect(diffPanel()).toHaveTextContent(file[id]);
      expect(diffCursorIndex()).toBe(row[id]);
      if (step < 2) await user.keyboard("j");
    }
  });

  it("TS-32: Enter on a comment whose file is gone says so instead of breaking", async () => {
    const user = await boot();
    seed(seeded("c1", "src/Borrado.php", 4, 4, "de una revisión anterior"));

    expect(pathOf("c1")).toBe("src/Borrado.php");

    await user.keyboard("3{Enter}");

    expect(diffPanel()).toHaveTextContent(/no está en los cambios/i);
    expect(entryIds()).toEqual(["c1"]);
  });

  it("TS-32: zc folds a comment and zo unfolds it", async () => {
    const user = await boot();
    seed(
      seeded("c1", PHP_PATH, 35, 48, "El método tiene demasiadas responsabilidades."),
      seeded("c2", TS_PATH, 15, 26, "El nombre no refleja lo que hace."),
    );

    await user.keyboard("3");
    expect(entryOf("c1")).toHaveAttribute("aria-expanded", "true");
    expect(entryOf("c1")).toHaveTextContent("▾");

    await user.keyboard("zc");

    expect(entryOf("c1")).toHaveAttribute("aria-expanded", "false");
    expect(entryOf("c1")).toHaveTextContent("▸");
    expect(summaryOf("c1")).toBeNull();
    // Folding hides the text, never the anchor: that is what identifies the row.
    expect(rangeOf("c1")).toBe("Líneas 35-48");
    expect(entryOf("c1")).toHaveTextContent("UserService.php");
    expect(summaryOf("c2")).toContain("El nombre no refleja lo que hace.");

    await user.keyboard("zo");

    expect(entryOf("c1")).toHaveAttribute("aria-expanded", "true");
    expect(summaryOf("c1")).toContain("El método tiene demasiadas responsabilidades.");
  });

  it("TS-32: folding one comment leaves the cursor and the others alone", async () => {
    const user = await boot();
    seed(
      seeded("c1", PHP_PATH, 35, 35, "uno"),
      seeded("c2", PHP_PATH, 36, 36, "dos"),
      seeded("c3", TS_PATH, 1, 1, "tres"),
    );
    const ids = entryIds();

    await user.keyboard("3j");
    expect(cursorId()).toBe(ids[1]);

    await user.keyboard("zc");

    expect(cursorId()).toBe(ids[1]);
    expect(entryIds()).toEqual(ids);
    expect(summaryOf(ids[0])).not.toBeNull();
    expect(summaryOf(ids[2])).not.toBeNull();

    await user.keyboard("j");
    expect(cursorId()).toBe(ids[2]);
  });
});

// -----------------------------------------------------------------------------
// TS-33 — dd
// -----------------------------------------------------------------------------

describe("dd deletes the comment under the cursor", () => {
  it("TS-33: the comment leaves the list and the counter of the tree", async () => {
    const user = await boot();
    seed(
      seeded("c1", PHP_PATH, 35, 35, "uno"),
      seeded("c2", PHP_PATH, 36, 36, "dos"),
      seeded("c3", TS_PATH, 1, 1, "tres"),
    );
    expect(treeRowAt(PHP_PATH)).toHaveTextContent(/●\s*2/);

    await user.keyboard("3");
    const target = cursorId();
    await user.keyboard("dd");

    expect(entryIds()).not.toContain(target);
    expect(entryIds()).toHaveLength(2);
    expect(treeRowAt(PHP_PATH)).toHaveTextContent(/●\s*1/);
    expect(treeRowAt(TS_PATH)).toHaveTextContent(/●\s*1/);
  });

  it("TS-33: deleting the last comment of a file takes its mark away", async () => {
    const user = await boot();
    seed(seeded("c1", TS_PATH, 1, 1, "solo uno"));
    expect(treeRowAt(TS_PATH)).toHaveTextContent(/●\s*1/);

    await user.keyboard("3dd");

    expect(entries()).toHaveLength(0);
    expect(treeRowAt(TS_PATH)).not.toHaveTextContent("●");
    expect(commentsPanel()).toHaveTextContent(/sin comentarios|no hay comentarios/i);
  });

  it("TS-33: the deletion reaches the state file", async () => {
    const user = await boot();
    const id = await writeComment(user, 2, 4, "esto lo borro luego");
    await waitFor(() => expect(lastSaved().comments).toHaveLength(1));

    await user.keyboard("3dd");

    await waitFor(() => {
      expect(lastSaved().comments.map((comment) => comment.id)).not.toContain(id);
    });
    expect(lastSaved().comments).toHaveLength(0);
  });

  it("TS-33: dd over an emptied list deletes nothing and breaks nothing", async () => {
    const user = await boot();
    seed(seeded("c1", PHP_PATH, 35, 35, "el único"));
    expect(entryIds()).toEqual(["c1"]);

    await user.keyboard("3dd");
    expect(entries()).toHaveLength(0);

    await user.keyboard("dddd");

    expect(entries()).toHaveLength(0);
    expect(mode()).toBe("NORMAL");
    expect(commentsPanel()).toHaveTextContent(/sin comentarios|no hay comentarios/i);
  });

  it("TS-33: a burst of dd deletes one comment per pair, not the same one twice", async () => {
    await boot();
    seed(
      seeded("c1", PHP_PATH, 35, 35, "uno"),
      seeded("c2", PHP_PATH, 36, 36, "dos"),
      seeded("c3", TS_PATH, 1, 1, "tres"),
    );
    const ids = entryIds();

    burst("3", "d", "d", "d", "d");

    expect(entryIds()).toEqual([ids[2]]);
  });

  it("TS-33: the key after a dd reads the list already short", async () => {
    await boot();
    seed(
      seeded("c1", PHP_PATH, 35, 35, "uno"),
      { id: "c2", path: PHP_PATH, side: "old", from: 36, to: 36, text: "dos" },
      seeded("c3", TS_PATH, 2, 2, "tres"),
    );
    const row: Record<string, number> = { c1: 2, c2: 6, c3: 1 };
    const file: Record<string, string> = { c1: PHP_PATH, c2: PHP_PATH, c3: TS_PATH };
    const before = entryIds();

    // Enter in the same task as the deletion: it must open the comment that
    // slid under the cursor, not the one that just left.
    burst("3", "d", "d", "Enter");

    const left = entryIds();
    expect(left).toHaveLength(2);
    expect(left).not.toContain(before[0]);
    expect(row[left[0]]).not.toBe(row[before[0]]);
    expect(diffPanel()).toHaveTextContent(file[left[0]]);
    expect(diffCursorIndex()).toBe(row[left[0]]);
  });

  it("TS-33: deleting the last entry leaves the cursor on the one before it", async () => {
    const user = await boot();
    seed(
      seeded("c1", PHP_PATH, 35, 35, "uno"),
      seeded("c2", PHP_PATH, 36, 36, "dos"),
      seeded("c3", TS_PATH, 1, 1, "tres"),
    );
    const ids = entryIds();

    await user.keyboard("3");
    await user.keyboard("{Shift>}G{/Shift}");
    expect(cursorId()).toBe(ids[2]);

    await user.keyboard("dd");

    expect(entryIds()).toEqual([ids[0], ids[1]]);
    expect(cursorId()).toBe(ids[1]);
  });
});

// -----------------------------------------------------------------------------
// TS-34 — resuming a review
// -----------------------------------------------------------------------------

describe("reopening the same scope offers to resume the review", () => {
  const SAVED: Comment[] = [
    {
      id: "c1",
      path: PHP_PATH,
      side: "new",
      from: 35,
      to: 37,
      text: "Separar validación de persistencia.",
    },
    { id: "c2", path: PHP_PATH, side: "old", from: 36, to: 36, text: "Esto ya no hace falta." },
  ];

  async function bootWithState(reviews: Review[]): Promise<UserEvent> {
    setUp(FILES, reviews);
    render(<App />);
    const user = userEvent.setup();
    await act(async () => undefined);
    return user;
  }

  it("TS-34: offers to resume and holds the comments back until it is accepted", async () => {
    await bootWithState([storedReview(SAVED)]);

    await screen.findByText(/retomar/i);
    expect(document.body).toHaveTextContent(/2 comentarios/i);
    expect(commentEntriesAnywhere()).toHaveLength(0);
    expect(loadReview).toHaveBeenCalledWith(SCOPE);
  });

  it("TS-34: accepting brings every comment back with its anchor", async () => {
    const user = await bootWithState([storedReview(SAVED)]);
    await screen.findByText(/retomar/i);

    await user.keyboard("{Enter}");

    await screen.findByRole("region", { name: /^1 ÁRBOL/ });
    expect(screen.queryByText(/retomar/i)).toBeNull();

    expect(entryIds()).toEqual(["c1", "c2"]);
    expect(rangeOf("c1")).toBe("Líneas 35-37");
    expect(sideOf("c1")).toBe("new");
    expect(summaryOf("c1")).toContain("Separar validación de persistencia.");
    expect(rangeOf("c2")).toBe("Línea 36");
    expect(sideOf("c2")).toBe("old");
    expect(treeRowAt(PHP_PATH)).toHaveTextContent(/●\s*2/);
  });

  it("TS-34: the comments that came back still jump to their line", async () => {
    const user = await bootWithState([storedReview(SAVED)]);
    await screen.findByText(/retomar/i);
    await user.keyboard("{Enter}");
    await screen.findByRole("region", { name: /^1 ÁRBOL/ });

    await user.keyboard("3{Enter}");
    expect(diffCursorIndex()).toBe(2);

    await user.keyboard("j{Enter}");
    expect(diffCursorIndex()).toBe(6);
  });

  it("TS-34: turning the offer down starts the review with no comments", async () => {
    const user = await bootWithState([storedReview(SAVED)]);
    await screen.findByText(/retomar/i);

    await user.keyboard("{Escape}");

    await screen.findByRole("region", { name: /^1 ÁRBOL/ });
    expect(screen.queryByText(/retomar/i)).toBeNull();
    expect(entries()).toHaveLength(0);
    expect(treeRowAt(PHP_PATH)).not.toHaveTextContent("●");
    expect(commentsPanel()).toHaveTextContent(/sin comentarios|no hay comentarios/i);
  });

  it("TS-34: a comment of a file that is no longer in the diff still comes back", async () => {
    const user = await bootWithState([
      storedReview([
        { id: "c9", path: "src/Borrado.php", side: "old", from: 12, to: 14, text: "ya no está" },
      ]),
    ]);
    await screen.findByText(/retomar/i);

    await user.keyboard("{Enter}");
    await screen.findByRole("region", { name: /^1 ÁRBOL/ });

    expect(entryIds()).toEqual(["c9"]);
    expect(pathOf("c9")).toBe("src/Borrado.php");
    expect(rangeOf("c9")).toBe("Líneas 12-14");
  });

  it("TS-34: another scope is not offered the comments of this one", async () => {
    const other: Scope = { kind: "commit", repo: "/home/dev/reviewv4", sha: "a1b2c3" };
    configureIpc({
      startup: { scope: other, home: "/home/dev" },
      diff: FILES,
      reviews: [storedReview(SAVED)],
    });
    render(<App />);

    await screen.findByRole("region", { name: /^1 ÁRBOL/ });
    await act(async () => undefined);

    expect(screen.queryByText(/retomar/i)).toBeNull();
    expect(entries()).toHaveLength(0);
    expect(loadReview).toHaveBeenCalledWith(other);
  });

  it("TS-34: a scope with nothing saved goes straight to the three panels", async () => {
    const user = await bootWithState([]);

    await screen.findByRole("region", { name: /^1 ÁRBOL/ });
    expect(screen.queryByText(/retomar/i)).toBeNull();
    expect(entries()).toHaveLength(0);
    expect(commentsPanel()).toHaveTextContent(/sin comentarios|no hay comentarios/i);

    // And the review is perfectly usable: a comment written now is the first one.
    const id = await writeComment(user, 2, 4, "el primero de la revisión");
    expect(entryIds()).toEqual([id]);
  });

  it("TS-34: a state file that cannot be read does not stop the review", async () => {
    setUp(FILES, []);
    loadReview.mockImplementationOnce(() => Promise.reject(new Error("estado ilegible")));
    render(<App />);

    await screen.findByRole("region", { name: /^1 ÁRBOL/ });
    await act(async () => undefined);

    expect(screen.queryByText(/retomar/i)).toBeNull();
    expect(diffPanel()).toHaveTextContent(PHP_PATH);
    expect(entries()).toHaveLength(0);
    expect(commentsPanel()).toHaveTextContent(/sin comentarios|no hay comentarios/i);
  });

  it("TS-34: what is written after resuming is saved next to what came back", async () => {
    const user = await bootWithState([storedReview(SAVED)]);
    await screen.findByText(/retomar/i);
    await user.keyboard("{Enter}");
    await screen.findByRole("region", { name: /^1 ÁRBOL/ });

    const id = await writeComment(user, 10, 10, "y esto también");

    await waitFor(() => {
      expect(lastSaved().comments.map((comment) => comment.id)).toEqual(["c1", "c2", id]);
    });
  });
});

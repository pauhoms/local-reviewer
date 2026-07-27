// @vitest-environment node
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { REPO_ROOT } from "../helpers/shell";
import { documentedKeys, keymapKeyIds, markdownTables, normalizeKey } from "../helpers/shortcuts";

const README = path.join(REPO_ROOT, "README.md");

function readme(): string {
  return fs.existsSync(README) ? fs.readFileSync(README, "utf8") : "";
}

describe("README.md shortcut tables against the real keyboard map", () => {
  it("README: reproduces the usage line the binary prints", () => {
    const text = readme();

    expect(text).toContain("reviewer [<commit>|<a>..<b>]");
    expect(text).toContain("no arguments");
    expect(text).toContain("<commit>");
    expect(text).toContain("<a>..<b>");
  });

  it("README: explains how to install it with deploy/install.sh", () => {
    expect(readme()).toMatch(/deploy\/install\.sh/);
  });

  it("README: carries at least one table with a key column", () => {
    const tables = markdownTables(readme()).filter((table) =>
      table.header.some((cell) => /key|shortcut/i.test(cell)),
    );

    expect(tables.length, "there is no table with a Key or Shortcut column").toBeGreaterThan(0);
    expect(tables.flatMap((table) => table.rows).length).toBeGreaterThan(0);
  });

  it("README: documents every shortcut the keyboard answers", () => {
    const documented = new Set(documentedKeys(readme()));
    const missing = [...keymapKeyIds()].filter((id) => !documented.has(id)).sort();

    expect(missing, `undocumented shortcuts from src/keys/keymap.ts: ${missing.join(", ")}`).toEqual([]);
  });

  it("README: documents no shortcut the keyboard does not answer", () => {
    const real = keymapKeyIds();
    const documented = [...new Set(documentedKeys(readme()))];
    const invented = documented.filter((key) => !real.has(key)).sort();

    expect(documented.length, "the shortcut table is empty").toBeGreaterThan(0);
    expect(invented, `the table documents unknown shortcuts: ${invented.join(", ")}`).toEqual([]);
  });

  it("README: the table names the export key and the copy-path key", async () => {
    const { COPY_PATH_KEY, EXPORT_KEY } = await import("@/keys/keymap");
    const documented = new Set(documentedKeys(readme()));

    expect(documented.has(normalizeKey(EXPORT_KEY)), `missing export key (${EXPORT_KEY})`).toBe(true);
    expect(documented.has(normalizeKey(COPY_PATH_KEY)), `missing copy-path key (${COPY_PATH_KEY})`).toBe(true);
  });

  it("README: tells the trip back to Codex with the exported Markdown", () => {
    const text = readme();

    expect(text).toMatch(/Codex/);
    expect(text).toMatch(/Markdown/i);
    expect(text, "the exported Markdown destination is not documented").toMatch(/~\/\.codex\/reviews/);
  });
});

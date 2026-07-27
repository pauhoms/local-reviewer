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

describe("README.md, la tabla de atajos frente al teclado real", () => {
  it("README: reproduces the usage line the binary prints", () => {
    const text = readme();

    expect(text).toContain("reviewer [<commit>|<a>..<b>]");
    expect(text).toContain("sin argumentos");
    expect(text).toContain("<commit>");
    expect(text).toContain("<a>..<b>");
  });

  it("README: explains how to install it with deploy/install.sh", () => {
    expect(readme()).toMatch(/deploy\/install\.sh/);
  });

  it("README: carries at least one table with a key column", () => {
    const tables = markdownTables(readme()).filter((table) =>
      table.header.some((cell) => /tecla|atajo/i.test(cell)),
    );

    expect(tables.length, "no hay ninguna tabla con columna «tecla» o «atajo»").toBeGreaterThan(0);
    expect(tables.flatMap((table) => table.rows).length).toBeGreaterThan(0);
  });

  it("README: documents every shortcut the keyboard answers", () => {
    const documented = new Set(documentedKeys(readme()));
    const missing = [...keymapKeyIds()].filter((id) => !documented.has(id)).sort();

    expect(missing, `atajos de src/keys/keymap.ts sin documentar: ${missing.join(", ")}`).toEqual([]);
  });

  it("README: documents no shortcut the keyboard does not answer", () => {
    const real = keymapKeyIds();
    const documented = [...new Set(documentedKeys(readme()))];
    const invented = documented.filter((key) => !real.has(key)).sort();

    expect(documented.length, "la tabla de atajos está vacía").toBeGreaterThan(0);
    expect(invented, `la tabla documenta teclas que no existen: ${invented.join(", ")}`).toEqual([]);
  });

  it("README: the table names the export key and the copy-path key", async () => {
    const { COPY_PATH_KEY, EXPORT_KEY } = await import("@/keys/keymap");
    const documented = new Set(documentedKeys(readme()));

    expect(documented.has(normalizeKey(EXPORT_KEY)), `falta la tecla de exportar (${EXPORT_KEY})`).toBe(true);
    expect(documented.has(normalizeKey(COPY_PATH_KEY)), `falta la tecla de copiar ruta (${COPY_PATH_KEY})`).toBe(true);
  });

  it("README: tells the trip back to Codex with the exported Markdown", () => {
    const text = readme();

    expect(text).toMatch(/Codex/);
    expect(text).toMatch(/Markdown/i);
    expect(text, "no dice dónde aterriza el Markdown exportado").toMatch(/~\/\.codex\/reviews/);
  });
});

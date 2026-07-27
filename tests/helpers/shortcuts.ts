import { DEFAULT_KEYMAPS, START_KEYMAPS, reviewKeymaps } from "@/keys/keymap";
import type { Keymaps } from "@/keys/keymap";

/**
 * Spellings a table may reasonably use for the same key. Everything else is
 * compared literally, case included: `g` and `G` are different keys.
 */
const NAMED: Record<string, string> = {
  esc: "Escape",
  escape: "Escape",
  enter: "Enter",
  intro: "Enter",
  return: "Enter",
  ret: "Enter",
};

function canonicalToken(token: string): string {
  const withModifier = token.replace(/^(?:ctrl|control|c)[-+]/i, "Ctrl+");
  const plus = withModifier.lastIndexOf("+");
  const modifier = plus === -1 ? "" : withModifier.slice(0, plus + 1);
  const rest = withModifier.slice(plus + 1);
  return modifier + (NAMED[rest.toLowerCase()] ?? rest);
}

/** `g g`, `gg`, `<C-w>v` and `Ctrl+w v` all collapse onto one id. */
export function normalizeKey(raw: string): string {
  return raw
    .replace(/[`<>]/g, "")
    .trim()
    .split(/\s+/)
    .filter((token) => token !== "")
    .map(canonicalToken)
    .join("");
}

const NO_ROWS = () => [];
const NO_METRICS = () => ({ lineCount: 0, pageSize: 0 });
const NO_COMMENTS = () => 0;

function idsOf(keymaps: Keymaps): string[] {
  const ids: string[] = [];
  for (const mode of Object.values(keymaps)) {
    ids.push(...Object.keys(mode.global));
    for (const panel of Object.values(mode.panels)) {
      ids.push(...Object.keys(panel ?? {}));
    }
  }
  return ids;
}

/** Every key the app answers to, normalized, from the tables themselves. */
export function keymapKeyIds(): Set<string> {
  const tables = [DEFAULT_KEYMAPS, START_KEYMAPS, reviewKeymaps(NO_ROWS, NO_METRICS, NO_COMMENTS)];
  return new Set(tables.flatMap(idsOf).map(normalizeKey));
}

interface MarkdownTable {
  header: string[];
  rows: string[][];
}

function cells(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

const SEPARATOR = /^:?-{3,}:?$/;

export function markdownTables(markdown: string): MarkdownTable[] {
  const tables: MarkdownTable[] = [];
  const lines = markdown.split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const next = lines[index + 1];
    if (!line?.trim().startsWith("|") || !next?.trim().startsWith("|")) continue;
    if (!cells(next).every((cell) => SEPARATOR.test(cell))) continue;

    const header = cells(line);
    const rows: string[][] = [];
    let cursor = index + 2;
    while (lines[cursor]?.trim().startsWith("|")) {
      rows.push(cells(lines[cursor]));
      cursor += 1;
    }
    tables.push({ header, rows });
    index = cursor;
  }
  return tables;
}

const KEY_COLUMN = /tecla|atajo/i;

/**
 * The keys a shortcut table documents: the column headed «tecla» or «atajo»,
 * one entry per backticked span so a row can list `j` / `k` together.
 */
export function documentedKeys(markdown: string): string[] {
  const documented: string[] = [];
  for (const table of markdownTables(markdown)) {
    const column = table.header.findIndex((cell) => KEY_COLUMN.test(cell));
    if (column === -1) continue;
    for (const row of table.rows) {
      const cell = row[column] ?? "";
      const spans = cell.match(/`[^`]+`/g);
      for (const span of spans ?? (cell === "" ? [] : [cell])) {
        documented.push(normalizeKey(span));
      }
    }
  }
  return documented;
}

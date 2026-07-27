import { spawnSync } from "node:child_process";
import { desktopValue } from "./shell";

/** The characters a backslash may escape inside a quoted Exec argument. */
const QUOTED = '"`$\\';

const STRING_ESCAPES: Record<string, string> = {
  s: " ",
  n: "\n",
  t: "\t",
  r: "\r",
  "\\": "\\",
};

function unescapeString(raw: string): string {
  let out = "";
  for (let at = 0; at < raw.length; at += 1) {
    if (raw[at] !== "\\") {
      out += raw[at];
      continue;
    }
    const escaped = STRING_ESCAPES[raw[at + 1] ?? ""];
    if (escaped === undefined) {
      throw new Error(`invalid escape \\${raw[at + 1] ?? "<end of line>"} in "${raw}"`);
    }
    out += escaped;
    at += 1;
  }
  return out;
}

function split(value: string): string[] {
  const args: string[] = [];
  let current = "";
  let started = false;
  let quoted = false;
  for (let at = 0; at < value.length; at += 1) {
    const char = value[at];
    if (quoted) {
      if (char === "\\" && QUOTED.includes(value[at + 1] ?? "")) {
        current += value[at + 1];
        at += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        current += char;
      }
    } else if (char === '"') {
      quoted = true;
      started = true;
    } else if (char === " " || char === "\t") {
      if (started) args.push(current);
      current = "";
      started = false;
    } else {
      current += char;
      started = true;
    }
  }
  if (quoted) throw new Error(`unclosed quote in "${value}"`);
  if (started) args.push(current);
  return args;
}

function expandFieldCodes(arg: string): string {
  let out = "";
  for (let at = 0; at < arg.length; at += 1) {
    if (arg[at] !== "%") {
      out += arg[at];
      continue;
    }
    if (arg[at + 1] !== "%") {
      throw new Error(`unescaped field code %${arg[at + 1] ?? "<end>"} in "${arg}"`);
    }
    out += "%";
    at += 1;
  }
  return out;
}

/**
 * The argv a desktop launcher ends up with: the spec unescapes the value as a
 * string, then applies the quoting rule, then expands field codes. Throws when
 * any of the three steps rejects the line, which is what a launcher does too.
 */
export function execArgv(entry: string): string[] {
  const raw = desktopValue(entry, "Exec");
  if (raw === undefined) throw new Error("the entry has no Exec key");
  return split(unescapeString(raw)).map(expandFieldCodes);
}

export interface Validation {
  ok: boolean;
  output: string;
}

/** `desktop-file-validate` when the system has it, `null` when it does not. */
export function validateDesktopFile(file: string): Validation | null {
  const probe = spawnSync("desktop-file-validate", ["--version"], { encoding: "utf8" });
  if (probe.error) return null;
  const run = spawnSync("desktop-file-validate", [file], { encoding: "utf8" });
  if (run.error) return null;
  return { ok: run.status === 0, output: (run.stdout ?? "") + (run.stderr ?? "") };
}

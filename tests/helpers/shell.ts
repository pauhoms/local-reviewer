import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/** Vitest runs from the project root, but a walk up survives being run elsewhere. */
function repoRoot(): string {
  let current = process.cwd();
  while (!fs.existsSync(path.join(current, "package.json"))) {
    const parent = path.dirname(current);
    if (parent === current) throw new Error(`could not find the repository root from ${process.cwd()}`);
    current = parent;
  }
  return current;
}

export const REPO_ROOT = repoRoot();
export const DEPLOY_DIR = path.join(REPO_ROOT, "deploy");
export const INSTALL_SH = path.join(DEPLOY_DIR, "install.sh");
export const UNINSTALL_SH = path.join(DEPLOY_DIR, "uninstall.sh");
export const DESKTOP_ENTRY = path.join(DEPLOY_DIR, "reviewer.desktop");

/** Shell rc files a script could reach for to put `~/.local/bin` on the PATH. */
export const RC_FILES = [".bashrc", ".bash_profile", ".profile", ".zshrc", ".zshenv"] as const;

export interface Sandbox {
  /** Everything the run may see: a fake home plus room for prefixes. */
  root: string;
  home: string;
  /** A path under the sandbox, created only when asked for. */
  path(name: string, create?: boolean): string;
}

export function sandbox(): Sandbox {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "local-reviewer-deploy-"));
  const home = path.join(root, "home");
  fs.mkdirSync(home);
  for (const rc of RC_FILES) {
    fs.writeFileSync(path.join(home, rc), `# ${rc} escrito por el test\n`);
  }
  return {
    root,
    home,
    path(name, create = false) {
      const target = path.join(root, name);
      if (create) fs.mkdirSync(target, { recursive: true });
      return target;
    },
  };
}

export interface ShellRun {
  code: number | null;
  stdout: string;
  stderr: string;
  /** Both streams: the mockup pins the text, not the stream it comes out of. */
  output: string;
  /** Set when the process could not be spawned or was killed on timeout. */
  failure: string | null;
}

export interface RunOptions {
  home: string;
  cwd?: string;
  /** Interpreter and its flags, when the point is how the script behaves under them. */
  interpreter?: string[];
  timeoutMs?: number;
}

/**
 * Every path the script could reach for is redirected into the sandbox: HOME,
 * the XDG data/bin homes, and a PATH that deliberately lacks `~/.local/bin`.
 */
export function runScript(script: string, args: string[], options: RunOptions): ShellRun {
  const { home, cwd = REPO_ROOT, interpreter, timeoutMs = 30_000 } = options;
  const command = interpreter ? interpreter[0] : script;
  const argv = interpreter ? [...interpreter.slice(1), script, ...args] : args;

  const result = spawnSync(command, argv, {
    cwd,
    env: {
      HOME: home,
      PATH: "/usr/local/bin:/usr/bin:/bin",
      XDG_DATA_HOME: path.join(home, ".local", "share"),
      XDG_BIN_HOME: path.join(home, ".local", "bin"),
      XDG_CONFIG_HOME: path.join(home, ".config"),
      XDG_CACHE_HOME: path.join(home, ".cache"),
      SHELL: "/bin/bash",
      LANG: "C.UTF-8",
      TERM: "dumb",
    },
    input: "",
    encoding: "utf8",
    timeout: timeoutMs,
  });

  const stdout = result.stdout ?? "";
  const stderr = result.stderr ?? "";
  return {
    code: result.status,
    stdout,
    stderr,
    output: stdout + stderr,
    failure: result.error ? `${result.error.message}` : result.signal ? `killed by ${result.signal}` : null,
  };
}

/** Every entry under `dir`, relative and sorted; directories end in `/`. */
export function entriesUnder(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const found: string[] = [];
  const walk = (current: string, prefix: string): void => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const relative = prefix + entry.name;
      if (entry.isDirectory()) {
        found.push(`${relative}/`);
        walk(path.join(current, entry.name), `${relative}/`);
      } else {
        found.push(relative);
      }
    }
  };
  walk(dir, "");
  return found.sort();
}

export interface HomeState {
  entries: string[];
  rc: Record<string, string>;
}

export function readHome(home: string): HomeState {
  const rc: Record<string, string> = {};
  for (const name of RC_FILES) {
    const file = path.join(home, name);
    rc[name] = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "<ausente>";
  }
  return { entries: entriesUnder(home), rc };
}

export function isExecutable(file: string): boolean {
  if (!fs.existsSync(file)) return false;
  return (fs.statSync(file).mode & 0o111) !== 0;
}

/** The `key=value` lines of a desktop entry, in file order. */
export function desktopEntries(text: string): Array<[string, string]> {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "" && !line.startsWith("#") && !line.startsWith("["))
    .map((line) => {
      const at = line.indexOf("=");
      return at === -1 ? ([line, ""] as [string, string]) : ([line.slice(0, at), line.slice(at + 1)] as [string, string]);
    });
}

export function desktopValue(text: string, key: string): string | undefined {
  return desktopEntries(text).find(([name]) => name === key)?.[1];
}

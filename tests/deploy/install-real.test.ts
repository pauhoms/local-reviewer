// @vitest-environment node
import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { execArgv, validateDesktopFile } from "../helpers/desktop-exec";
import { fakeRelease } from "../helpers/fake-release";
import {
  entriesUnder,
  isExecutable,
  readHome,
  runScript,
  sandbox,
  type Sandbox,
} from "../helpers/shell";

const boxes: Sandbox[] = [];

function box(): Sandbox {
  const created = sandbox();
  boxes.push(created);
  return created;
}

afterEach(() => {
  for (const created of boxes.splice(0)) {
    fs.rmSync(created.root, { recursive: true, force: true });
  }
});

interface Installation {
  repo: string;
  prefix: string;
  launcher: string;
  desktop: string;
  icon: string;
}

function target(sb: Sandbox, prefixName = "destino", withBinary = true): Installation {
  const prefix = sb.path(prefixName);
  return {
    repo: fakeRelease(sb.root, withBinary),
    prefix,
    launcher: path.join(prefix, "bin", "reviewer"),
    desktop: path.join(prefix, "share", "applications", "reviewer.desktop"),
    icon: path.join(prefix, "share", "icons", "hicolor", "128x128", "apps", "reviewer.png"),
  };
}

function install(where: Installation, sb: Sandbox, args: string[] = ["--prefix", where.prefix]) {
  return runScript(path.join(where.repo, "deploy", "install.sh"), args, {
    home: sb.home,
    cwd: where.repo,
  });
}

function modeOf(file: string): number {
  return fs.statSync(file).mode & 0o777;
}

describe("deploy/install.sh, a real installation", () => {
  it("leaves a launcher that answers for the built binary", () => {
    const sb = box();
    const where = target(sb);

    const run = install(where, sb);

    expect(run.failure).toBeNull();
    expect(run.code).toBe(0);
    expect(isExecutable(where.launcher)).toBe(true);
    const launched = runScript(where.launcher, ["--help"], { home: sb.home, cwd: sb.root });
    expect(launched.output).toContain("reviewer [<commit>|<a>..<b>]");
  });

  it("installs the launcher executable for everyone, whatever mode the build left", () => {
    const sb = box();
    const where = target(sb);

    install(where, sb);

    expect(modeOf(path.join(where.repo, "src-tauri", "target", "release", "reviewv4"))).toBe(0o700);
    expect(modeOf(where.launcher)).toBe(0o755);
  });

  it("writes the desktop entry pointing at the installed launcher", () => {
    const sb = box();
    const where = target(sb);

    install(where, sb);

    const entry = fs.readFileSync(where.desktop, "utf8");
    expect(execArgv(entry)).toEqual([where.launcher]);
    expect(entry).not.toContain("@PREFIX@");
  });

  it("resolves a relative prefix, so the desktop entry does not depend on the cwd", () => {
    const sb = box();
    const where = target(sb);
    const launcher = path.join(where.repo, "relativo", "bin", "reviewer");

    const run = install(where, sb, ["--prefix", "relativo"]);

    expect(run.code).toBe(0);
    const entry = fs.readFileSync(
      path.join(where.repo, "relativo", "share", "applications", "reviewer.desktop"),
      "utf8",
    );
    expect(execArgv(entry)).toEqual([launcher]);
  });

  it("installs the icon the desktop entry names", () => {
    const sb = box();
    const where = target(sb);

    install(where, sb);

    expect(fs.existsSync(where.icon)).toBe(true);
  });

  it("does not touch the home of whoever installs", () => {
    const sb = box();
    const where = target(sb);
    const before = readHome(sb.home);

    install(where, sb);

    expect(readHome(sb.home)).toEqual(before);
  });

  it("installed twice leaves the same prefix and exits 0 again", () => {
    const sb = box();
    const where = target(sb);

    const first = install(where, sb);
    const after = entriesUnder(where.prefix);
    const second = install(where, sb);

    expect([first.code, second.code]).toEqual([0, 0]);
    expect(entriesUnder(where.prefix)).toEqual(after);
  });

  it("installs the same under a prefix with spaces and accents, and says where", () => {
    const sb = box();
    const where = target(sb, "prefijo  con  espacios y ñ");

    const run = install(where, sb);

    expect(run.code).toBe(0);
    expect(isExecutable(where.launcher)).toBe(true);
    expect(run.output).toContain(where.launcher);
    expect(run.output).toContain(where.desktop);
  });

  it("refuses a launcher path taken by a directory instead of writing inside it", () => {
    const sb = box();
    const where = target(sb);
    fs.mkdirSync(where.launcher, { recursive: true });

    const run = install(where, sb);

    expect(run.code).not.toBe(0);
    expect(run.output).toContain(where.launcher);
    expect(entriesUnder(where.launcher)).toEqual([]);
    expect(entriesUnder(where.prefix).filter((entry) => entry.includes(".tmp"))).toEqual([]);
  });

  it("refuses a desktop path taken by a directory before installing the launcher", () => {
    const sb = box();
    const where = target(sb);
    fs.mkdirSync(where.desktop, { recursive: true });

    const run = install(where, sb);

    expect(run.code).not.toBe(0);
    expect(run.output).toContain(where.desktop);
    expect(fs.existsSync(where.launcher), "dejó media instalación").toBe(false);
    expect(entriesUnder(where.desktop)).toEqual([]);
  });

  it("refuses a target directory it cannot write into before installing the launcher", () => {
    const sb = box();
    const where = target(sb);
    const applications = path.join(where.prefix, "share", "applications");
    fs.mkdirSync(applications, { recursive: true });
    fs.chmodSync(applications, 0o500);

    const run = install(where, sb);
    fs.chmodSync(applications, 0o700);

    expect(run.code).not.toBe(0);
    expect(run.output).toContain(where.desktop);
    expect(fs.existsSync(where.launcher), "dejó media instalación").toBe(false);
  });

  it("refuses a dangling symlink in a target path before installing the launcher", () => {
    const sb = box();
    const where = target(sb);
    fs.mkdirSync(where.prefix, { recursive: true });
    fs.symlinkSync(sb.path("fuera/nunca-existió"), path.join(where.prefix, "share"));

    const run = install(where, sb);

    expect(run.code).not.toBe(0);
    expect(run.output).toContain("✗");
    expect(run.output, "el error crudo de mkdir en vez del aviso").not.toMatch(/^mkdir:/m);
    expect(fs.existsSync(where.launcher), "dejó media instalación").toBe(false);
  });

  it("refuses a --prefix that is a file, saying so, instead of leaking the mkdir error", () => {
    const sb = box();
    const where = target(sb, "fichero");
    // Executable, so that only the «this is not a directory» check can stop it.
    fs.writeFileSync(where.prefix, "#!/bin/sh\n", { mode: 0o755 });

    const run = install(where, sb);

    expect(run.code).not.toBe(0);
    expect(run.output).toContain("✗");
    expect(run.output).toContain(where.prefix);
    expect(run.output).toMatch(/no es un directorio/);
    expect(run.output, "el error crudo de mkdir en vez del aviso").not.toMatch(/^mkdir:/m);
    expect(fs.readFileSync(where.prefix, "utf8")).toBe("#!/bin/sh\n");
  });

  it("refuses a --prefix whose value is another option instead of installing into it", () => {
    const sb = box();
    const where = target(sb);

    const run = install(where, sb, ["--prefix", "--dry-run"]);

    expect(run.code).not.toBe(0);
    expect(run.output).toContain("--prefix");
    expect(fs.existsSync(path.join(where.repo, "--dry-run"))).toBe(false);
    expect(entriesUnder(where.prefix)).toEqual([]);
  });

  it("without a built binary says how to build it and installs nothing", () => {
    const sb = box();
    const where = target(sb, "destino", false);

    const run = install(where, sb);

    expect(run.code).not.toBe(0);
    expect(run.output).toContain("npm run tauri build");
    expect(entriesUnder(where.prefix)).toEqual([]);
  });
});

/** Every character the Desktop Entry Spec gives a meaning to inside an `Exec`. */
const HOSTILE_PREFIXES: Array<[string, string]> = [
  ["spaces and accents", "prefijo  con  espacios y ñ"],
  ["a percent sign", "cien%por%cien"],
  ["a single quote", "it's mine"],
  ["a backtick", "back`tick"],
  ["a dollar sign", "do$llar y ${HOME}"],
  ["an ampersand", "rock&roll"],
  ["a double quote", 'qu"ote'],
  ["a backslash", "back\\slash"],
  ["a newline", "salto\nde línea"],
];

describe.each(HOSTILE_PREFIXES)("deploy/install.sh, a prefix with %s", (_name, prefixName) => {
  it("leaves a desktop entry that launches the installed launcher", () => {
    const sb = box();
    const where = target(sb, prefixName);

    const run = install(where, sb);

    expect(run.code).toBe(0);
    expect(isExecutable(where.launcher)).toBe(true);
    const entry = fs.readFileSync(where.desktop, "utf8");
    expect(entry).not.toContain("@PREFIX@");
    expect(execArgv(entry)).toEqual([where.launcher]);
    const validated = validateDesktopFile(where.desktop);
    if (validated) expect(validated.output, validated.output).toBe("");
  });
});

describe("deploy/install.sh --help", () => {
  it("explains --prefix and --dry-run without installing anything", () => {
    const sb = box();
    const where = target(sb);

    const run = install(where, sb, ["--prefix", where.prefix, "--help"]);

    expect(run.code).toBe(0);
    expect(run.output).toContain("--prefix");
    expect(run.output).toContain("--dry-run");
    expect(fs.existsSync(where.prefix)).toBe(false);
  });
});

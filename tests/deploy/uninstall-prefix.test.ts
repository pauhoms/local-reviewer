// @vitest-environment node
import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { UNINSTALL_SH, entriesUnder, runScript, sandbox, type Sandbox } from "../helpers/shell";

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

function write(file: string, contents: string, mode = 0o644): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, contents, { mode });
}

/** A prefix as install.sh leaves it, with a neighbour of each kind alongside. */
function installedUnder(prefix: string): void {
  write(path.join(prefix, "bin", "reviewer"), "#!/bin/sh\n", 0o755);
  write(path.join(prefix, "share", "applications", "reviewer.desktop"), "[Desktop Entry]\n");
  write(path.join(prefix, "share", "icons", "hicolor", "128x128", "apps", "reviewer.png"), "png\n");
  write(path.join(prefix, "bin", "otra-herramienta"), "#!/bin/sh\n", 0o755);
  write(path.join(prefix, "share", "icons", "hicolor", "128x128", "apps", "otra.png"), "png\n");
}

function uninstall(sb: Sandbox, args: string[]) {
  return runScript(UNINSTALL_SH, args, { home: sb.home });
}

describe("deploy/uninstall.sh --prefix", () => {
  it("removes what was installed under the prefix and spares the neighbours", () => {
    const sb = box();
    const prefix = sb.path("destino");
    installedUnder(prefix);

    const run = uninstall(sb, ["--prefix", prefix]);

    expect(run.failure).toBeNull();
    expect(run.code).toBe(0);
    expect(entriesUnder(prefix)).toEqual([
      "bin/",
      "bin/otra-herramienta",
      "share/",
      "share/applications/",
      "share/icons/",
      "share/icons/hicolor/",
      "share/icons/hicolor/128x128/",
      "share/icons/hicolor/128x128/apps/",
      "share/icons/hicolor/128x128/apps/otra.png",
    ]);
  });

  it("in --dry-run announces what it would remove and removes nothing", () => {
    const sb = box();
    const prefix = sb.path("destino");
    installedUnder(prefix);
    const before = entriesUnder(prefix);

    const run = uninstall(sb, ["--dry-run", "--prefix", prefix]);

    expect(run.code).toBe(0);
    expect(run.output).toContain("[dry-run]");
    expect(run.output).toContain(path.join(prefix, "bin", "reviewer"));
    expect(entriesUnder(prefix)).toEqual(before);
  });

  it("an unknown option fails naming it and removes nothing", () => {
    const sb = box();
    const prefix = sb.path("destino");
    installedUnder(prefix);
    const before = entriesUnder(prefix);

    const run = uninstall(sb, ["--prefix", prefix, "--todo"]);

    expect(run.code).not.toBe(0);
    expect(run.output).toContain("--todo");
    expect(entriesUnder(prefix)).toEqual(before);
  });

  it("--prefix with no value fails naming the option", () => {
    const sb = box();

    const run = uninstall(sb, ["--prefix"]);

    expect(run.code).not.toBe(0);
    expect(run.output).toContain("--prefix");
  });

  it("refuses a --prefix whose value is another option instead of taking it as a directory", () => {
    const sb = box();
    const prefix = sb.path("destino");
    installedUnder(prefix);
    const before = entriesUnder(prefix);

    const run = uninstall(sb, ["--prefix", "--dry-run"]);

    expect(run.code).not.toBe(0);
    expect(run.output).toContain("--prefix");
    expect(entriesUnder(prefix)).toEqual(before);
  });

  it("removes a broken symlink sitting in an installed path", () => {
    const sb = box();
    const prefix = sb.path("destino");
    installedUnder(prefix);
    const launcher = path.join(prefix, "bin", "reviewer");
    fs.rmSync(launcher);
    fs.symlinkSync(sb.path("fuera/nunca-existió"), launcher);

    const run = uninstall(sb, ["--prefix", prefix]);

    expect(run.code).toBe(0);
    expect(run.output).toContain(launcher);
    expect(fs.lstatSync(launcher, { throwIfNoEntry: false })).toBeUndefined();
  });

  it("unlinks a symlink in an installed path and spares the file it points at", () => {
    const sb = box();
    const prefix = sb.path("destino");
    installedUnder(prefix);
    const victim = sb.path("fuera/importante.txt");
    write(victim, "no me toques\n");
    const desktop = path.join(prefix, "share", "applications", "reviewer.desktop");
    fs.rmSync(desktop);
    fs.symlinkSync(victim, desktop);

    const run = uninstall(sb, ["--prefix", prefix]);

    expect(run.code).toBe(0);
    expect(fs.lstatSync(desktop, { throwIfNoEntry: false })).toBeUndefined();
    expect(fs.readFileSync(victim, "utf8")).toBe("no me toques\n");
  });

  it("unlinks a symlink to a directory outside the prefix and spares the directory", () => {
    const sb = box();
    const prefix = sb.path("destino");
    installedUnder(prefix);
    const victim = sb.path("fuera/carpeta");
    write(path.join(victim, "importante.txt"), "no me toques\n");
    const icon = path.join(prefix, "share", "icons", "hicolor", "128x128", "apps", "reviewer.png");
    fs.rmSync(icon);
    fs.symlinkSync(victim, icon);

    const run = uninstall(sb, ["--prefix", prefix]);

    expect(run.code).toBe(0);
    expect(fs.lstatSync(icon, { throwIfNoEntry: false })).toBeUndefined();
    expect(entriesUnder(victim)).toEqual(["importante.txt"]);
  });

  it("skips an installed path taken by a directory and still removes the other two", () => {
    const sb = box();
    const prefix = sb.path("destino");
    installedUnder(prefix);
    const desktop = path.join(prefix, "share", "applications", "reviewer.desktop");
    fs.rmSync(desktop);
    fs.mkdirSync(desktop);
    fs.writeFileSync(path.join(desktop, "dentro"), "no me toques\n");

    const run = uninstall(sb, ["--prefix", prefix]);

    expect(run.failure).toBeNull();
    expect(run.output).toContain(desktop);
    expect(run.output, "el error crudo de rm en vez del aviso").not.toMatch(/^rm:/m);
    expect(fs.existsSync(path.join(prefix, "bin", "reviewer"))).toBe(false);
    expect(
      fs.existsSync(path.join(prefix, "share", "icons", "hicolor", "128x128", "apps", "reviewer.png")),
    ).toBe(false);
    expect(entriesUnder(desktop)).toEqual(["dentro"]);
  });

  it("uninstalls the same from a prefix with spaces and accents", () => {
    const sb = box();
    const prefix = sb.path("prefijo  con  espacios y ñ");
    installedUnder(prefix);

    const run = uninstall(sb, ["--prefix", prefix]);

    expect(run.code).toBe(0);
    expect(run.output).toContain(path.join(prefix, "bin", "reviewer"));
    expect(fs.existsSync(path.join(prefix, "bin", "reviewer"))).toBe(false);
    expect(fs.existsSync(path.join(prefix, "bin", "otra-herramienta"))).toBe(true);
  });
});

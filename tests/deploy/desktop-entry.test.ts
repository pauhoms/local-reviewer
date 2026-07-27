// @vitest-environment node
import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  DESKTOP_ENTRY,
  UNINSTALL_SH,
  desktopEntries,
  desktopValue,
  entriesUnder,
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

function entry(): string {
  return fs.readFileSync(DESKTOP_ENTRY, "utf8");
}

describe("deploy/reviewer.desktop", () => {
  it("TS-45: opens with the [Desktop Entry] header before any key", () => {
    const lines = entry()
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line !== "" && !line.startsWith("#"));

    expect(lines[0]).toBe("[Desktop Entry]");
  });

  it("TS-45: declares Type, Name, Exec, Icon and Categories", () => {
    const text = entry();

    expect(desktopValue(text, "Type")).toBe("Application");
    expect(desktopValue(text, "Name")).toMatch(/\S/);
    expect(desktopValue(text, "Exec")).toMatch(/\S/);
    expect(desktopValue(text, "Icon")).toMatch(/\S/);
    expect(desktopValue(text, "Categories")).toMatch(/Development/);
  });

  it("TS-45: closes Categories with a semicolon, as the format demands", () => {
    expect(desktopValue(entry(), "Categories")).toMatch(/;$/);
  });

  it("TS-45: repeats no key and carries no stray lines", () => {
    const keys = desktopEntries(entry()).map(([key]) => key);

    expect(keys).toEqual([...new Set(keys)]);
    for (const key of keys) {
      expect(key, `"${key}" is not a key=value key`).toMatch(/^[A-Za-z][A-Za-z0-9-]*(\[[^\]]+\])?$/);
    }
  });

  it("TS-45: the Exec launches the installed reviewer, never the build path", () => {
    const exec = desktopValue(entry(), "Exec") ?? "";
    const command = exec.split(/\s+/)[0].replace(/^"|"$/g, "");

    expect(path.basename(command)).toBe("reviewer");
    expect(exec).not.toMatch(/src-tauri|target\/(debug|release)|\/dist\/|cargo|npm|AppImage/);
  });
});

describe("deploy/uninstall.sh", () => {
  it("TS-45: removes the installed launcher and .desktop and nothing else", () => {
    const sb = box();
    const bin = path.join(sb.home, ".local", "bin");
    const applications = path.join(sb.home, ".local", "share", "applications");
    fs.mkdirSync(bin, { recursive: true });
    fs.mkdirSync(applications, { recursive: true });
    fs.writeFileSync(path.join(bin, "reviewer"), "#!/bin/sh\n", { mode: 0o755 });
    fs.writeFileSync(path.join(applications, "reviewer.desktop"), "[Desktop Entry]\n");
    fs.writeFileSync(path.join(bin, "otra-herramienta"), "#!/bin/sh\n", { mode: 0o755 });
    fs.writeFileSync(path.join(applications, "otra.desktop"), "[Desktop Entry]\n");

    const run = runScript(UNINSTALL_SH, [], { home: sb.home });

    expect(run.failure).toBeNull();
    expect(run.code).toBe(0);
    expect(entriesUnder(bin)).toEqual(["otra-herramienta"]);
    expect(entriesUnder(applications)).toEqual(["otra.desktop"]);
    expect(readHome(sb.home).rc[".bashrc"]).toBe("# .bashrc escrito por el test\n");
  });

  it("TS-45: with nothing installed it neither fails nor invents directories", () => {
    const sb = box();

    const run = runScript(UNINSTALL_SH, [], { home: sb.home });

    expect(run.code).toBe(0);
    expect(fs.existsSync(path.join(sb.home, ".local"))).toBe(false);
  });
});

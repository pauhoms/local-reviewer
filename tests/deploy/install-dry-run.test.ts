// @vitest-environment node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  DEPLOY_DIR,
  INSTALL_SH,
  RC_FILES,
  UNINSTALL_SH,
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
    fs.chmodSync(created.root, 0o700);
    fs.rmSync(created.root, { recursive: true, force: true });
  }
});

const PRISTINE_HOME = {
  entries: [...RC_FILES].sort(),
  rc: Object.fromEntries(RC_FILES.map((rc) => [rc, `# ${rc} escrito por el test\n`])),
};

/** A sandbox where nothing has been written yet: the fake home and nothing else. */
const PRISTINE_ROOT = ["home/", ...RC_FILES.map((rc) => `home/${rc}`)].sort();

function launcherIn(prefix: string): string {
  return path.join(prefix, "bin", "reviewer");
}

function desktopIn(prefix: string): string {
  return path.join(prefix, "share", "applications", "reviewer.desktop");
}

function install(args: string[], home: string, cwd?: string) {
  return runScript(INSTALL_SH, args, cwd ? { home, cwd } : { home });
}

describe("deploy/install.sh --dry-run --prefix", () => {
  it("TS-45: announces the launcher and the desktop entry under the prefix it was given", () => {
    const sb = box();
    const prefix = sb.path("destino");

    const run = install(["--dry-run", "--prefix", prefix], sb.home);

    expect(run.failure).toBeNull();
    expect(run.code).toBe(0);
    expect(run.output).toContain("[dry-run]");
    expect(run.output).toContain(launcherIn(prefix));
    expect(run.output).toContain(desktopIn(prefix));
  });

  it("TS-45: creates not one file, not even the prefix itself", () => {
    const sb = box();
    const prefix = sb.path("destino");

    const run = install(["--dry-run", "--prefix", prefix], sb.home);

    expect(run.code).toBe(0);
    expect(fs.existsSync(prefix)).toBe(false);
    expect(entriesUnder(sb.root)).toEqual(PRISTINE_ROOT);
  });

  it("TS-45: leaves a prefix that already existed untouched", () => {
    const sb = box();
    const prefix = sb.path("destino", true);
    fs.writeFileSync(path.join(prefix, "testigo"), "no me toques\n");

    const run = install(["--dry-run", "--prefix", prefix], sb.home);

    expect(run.code).toBe(0);
    expect(entriesUnder(prefix)).toEqual(["testigo"]);
    expect(fs.readFileSync(path.join(prefix, "testigo"), "utf8")).toBe("no me toques\n");
  });

  it("TS-45: touches neither ~/.local nor the shell startup files of the running home", () => {
    const sb = box();

    const run = install(["--dry-run", "--prefix", sb.path("destino")], sb.home);

    expect(run.code).toBe(0);
    expect(fs.existsSync(path.join(sb.home, ".local"))).toBe(false);
    expect(readHome(sb.home)).toEqual(PRISTINE_HOME);
  });

  it("TS-45: points at ~/.local with no --prefix, and in dry-run writes nothing there either", () => {
    const sb = box();

    const run = install(["--dry-run"], sb.home);

    expect(run.code).toBe(0);
    const homeLauncher = launcherIn(path.join(sb.home, ".local"));
    expect(
      run.output.includes(homeLauncher) || run.output.includes("~/.local/bin/reviewer"),
      `la salida no nombra ${homeLauncher}:\n${run.output}`,
    ).toBe(true);
    expect(fs.existsSync(path.join(sb.home, ".local"))).toBe(false);
    expect(readHome(sb.home)).toEqual(PRISTINE_HOME);
  });

  it("TS-45: warns that ~/.local/bin is off the PATH instead of fixing it", () => {
    const sb = box();

    const run = install(["--dry-run"], sb.home);

    expect(run.code).toBe(0);
    expect(run.output).toContain("PATH");
    expect(readHome(sb.home)).toEqual(PRISTINE_HOME);
  });

  it("TS-45: does not touch the real ~/.local of whoever runs the tests", () => {
    const real = os.homedir();
    const realLauncher = path.join(real, ".local", "bin", "reviewer");
    const realDesktop = path.join(real, ".local", "share", "applications", "reviewer.desktop");
    const before = [fs.existsSync(realLauncher), fs.existsSync(realDesktop)];

    const sb = box();
    const prefixed = install(["--dry-run", "--prefix", sb.path("destino")], sb.home);
    const plain = install(["--dry-run"], sb.home);

    expect([prefixed.code, plain.code]).toEqual([0, 0]);
    expect([fs.existsSync(realLauncher), fs.existsSync(realDesktop)]).toEqual(before);
  });

  it("TS-45: two runs in a row say the same thing and still write nothing", () => {
    const sb = box();
    const prefix = sb.path("destino");

    const first = install(["--dry-run", "--prefix", prefix], sb.home);
    const second = install(["--dry-run", "--prefix", prefix], sb.home);

    expect([first.code, second.code]).toEqual([0, 0]);
    expect(second.stdout).toBe(first.stdout);
    expect(entriesUnder(sb.root)).toEqual(PRISTINE_ROOT);
  });
});

describe("deploy/install.sh, prefijos hostiles", () => {
  it("TS-45: survives a prefix carrying spaces and accents", () => {
    const sb = box();
    // Dos espacios seguidos: un `echo $PREFIX` sin comillas los colapsa en uno.
    const prefix = sb.path("prefijo  con  espacios y ñ");

    const run = install(["--dry-run", "--prefix", prefix], sb.home);

    expect(run.code).toBe(0);
    expect(run.output).toContain(launcherIn(prefix));
    expect(run.output).toContain(desktopIn(prefix));
    expect(entriesUnder(sb.root)).toEqual(PRISTINE_ROOT);
  });

  it("TS-45: takes a relative prefix without writing in the working directory", () => {
    const sb = box();
    const cwd = sb.path("trabajo", true);

    const run = install(["--dry-run", "--prefix", "destino"], sb.home, cwd);

    expect(run.code).toBe(0);
    expect(run.output).toMatch(/destino\/bin\/reviewer/);
    expect(run.output).toMatch(/destino\/share\/applications\/reviewer\.desktop/);
    expect(entriesUnder(cwd)).toEqual([]);
  });

  it("TS-45: a read-only prefix is no obstacle, because it writes nothing", () => {
    const sb = box();
    const prefix = sb.path("destino", true);
    fs.chmodSync(prefix, 0o500);

    const run = install(["--dry-run", "--prefix", prefix], sb.home);
    fs.chmodSync(prefix, 0o700);

    expect(run.code).toBe(0);
    expect(run.output).toContain(launcherIn(prefix));
    expect(entriesUnder(prefix)).toEqual([]);
  });

  it("TS-45: --dry-run wins wherever it sits on the command line", () => {
    const sb = box();
    const prefix = sb.path("destino");

    const run = install(["--prefix", prefix, "--dry-run"], sb.home);

    expect(run.code).toBe(0);
    expect(run.output).toContain("[dry-run]");
    expect(entriesUnder(sb.root)).toEqual(PRISTINE_ROOT);
  });

});

describe("deploy/install.sh, líneas de órdenes mal escritas", () => {
  it("TS-45: fails naming the option when --prefix comes with no value, and writes nothing", () => {
    const sb = box();

    const run = install(["--dry-run", "--prefix"], sb.home);

    expect(run.code).not.toBe(0);
    expect(run.code).not.toBeNull();
    expect(run.output).toContain("--prefix");
    expect(entriesUnder(sb.root)).toEqual(PRISTINE_ROOT);
  });

  it("TS-45: fails naming an unknown option, and writes nothing", () => {
    const sb = box();
    const prefix = sb.path("destino");

    const run = install(["--dry-run", "--prefix", prefix, "--fuerza"], sb.home);

    expect(run.code).not.toBe(0);
    expect(run.code).not.toBeNull();
    expect(run.output).toContain("--fuerza");
    expect(entriesUnder(sb.root)).toEqual(PRISTINE_ROOT);
  });

  it("TS-45: refuses to install without a built binary instead of leaving half an install", () => {
    const sb = box();
    const isolated = sb.path("copia/deploy");
    fs.cpSync(DEPLOY_DIR, isolated, { recursive: true });
    fs.chmodSync(path.join(isolated, "install.sh"), 0o755);
    const prefix = sb.path("destino");

    const run = runScript(path.join(isolated, "install.sh"), ["--prefix", prefix], {
      home: sb.home,
      cwd: sb.path("copia"),
    });

    expect(run.failure, "install.sh no debe construir nada: instala el binario ya construido").toBeNull();
    expect(run.code).not.toBe(0);
    expect(fs.existsSync(launcherIn(prefix))).toBe(false);
    expect(fs.existsSync(desktopIn(prefix))).toBe(false);
    expect(readHome(sb.home)).toEqual(PRISTINE_HOME);
  });
});

describe("deploy/*.sh como ejecutables", () => {
  it("TS-45: install.sh and uninstall.sh both run as ./deploy/install.sh", () => {
    expect(isExecutable(INSTALL_SH), `${INSTALL_SH} no es ejecutable`).toBe(true);
    expect(isExecutable(UNINSTALL_SH), `${UNINSTALL_SH} no es ejecutable`).toBe(true);
  });
});

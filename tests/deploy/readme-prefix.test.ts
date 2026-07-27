// @vitest-environment node
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { REPO_ROOT } from "../helpers/shell";

/** The paragraph that documents `--prefix`, up to the next heading. */
function prefixSection(): string {
  const readme = fs.readFileSync(path.join(REPO_ROOT, "README.md"), "utf8");
  const from = readme.indexOf("`--prefix <dir>`");
  expect(from, "el README no documenta --prefix").toBeGreaterThan(-1);
  const to = readme.indexOf("\n## ", from);
  return readme.slice(from, to === -1 ? readme.length : to);
}

describe("README.md, what --prefix costs", () => {
  it("warns that outside ~/.local the icon needs XDG_DATA_DIRS", () => {
    const section = prefixSection();

    expect(section, "no nombra XDG_DATA_DIRS donde explica --prefix").toContain("XDG_DATA_DIRS");
    expect(section, "no dice que lo que se pierde es el icono").toMatch(/icono/i);
  });
});

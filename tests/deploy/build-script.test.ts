// @vitest-environment node
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { REPO_ROOT } from "../helpers/shell";

const SMOKE = "smoke:build";

function scripts(): Record<string, string> {
  const raw = fs.readFileSync(path.join(REPO_ROOT, "package.json"), "utf8");
  const parsed: unknown = JSON.parse(raw);
  const found =
    typeof parsed === "object" && parsed !== null
      ? (parsed as { scripts?: unknown }).scripts
      : undefined;
  return typeof found === "object" && found !== null ? (found as Record<string, string>) : {};
}

describe("package.json", () => {
  it(`runs the binary smoke through npm run ${SMOKE}`, () => {
    const command = scripts()[SMOKE] ?? "";
    const target = command.split(/\s+/).find((word) => word.endsWith(".sh")) ?? "";

    expect(target, `«${SMOKE}» runs no script: ${command}`).not.toBe("");
    expect(fs.existsSync(path.join(REPO_ROOT, target)), `${target} does not exist`).toBe(true);
  });

  it("the README points at the smoke the way package.json defines it", () => {
    const readme = fs.readFileSync(path.join(REPO_ROOT, "README.md"), "utf8");

    expect(readme).toContain(`npm run ${SMOKE}`);
  });
});

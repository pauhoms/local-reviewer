import { describe, expect, it } from "vitest";
import { tokenizeFile } from "@/highlight/shiki";
import type { Token } from "@/highlight/shiki";

function text(line: Token[]): string {
  return line.map((token) => token.content).join("");
}

function coloured(lines: Token[][]): boolean {
  return lines.flat().some((token) => token.color !== undefined);
}

describe("a file too big to colour goes through as plain text", () => {
  it("leaves a bundle packed into one enormous line alone", async () => {
    const packed = `const a=1;${"x".repeat(20_000)}`;

    const lines = await tokenizeFile(`${packed}\nconst b = 2;`, "typescript");

    expect(lines).toHaveLength(2);
    expect(text(lines[0])).toBe(packed);
    expect(text(lines[1])).toBe("const b = 2;");
    expect(coloured(lines)).toBe(false);
  });

  it("leaves a generated file of tens of thousands of lines alone", async () => {
    const generated = Array.from({ length: 20_001 }, (_, index) => `const l${index} = ${index};`);

    const lines = await tokenizeFile(generated.join("\n"), "typescript");

    expect(lines).toHaveLength(generated.length);
    expect(text(lines[0])).toBe("const l0 = 0;");
    expect(coloured(lines)).toBe(false);
  });

  it("still colours a long line of the length a person writes", async () => {
    const long = `const answer: string = "${"a".repeat(400)}";`;

    const lines = await tokenizeFile(long, "typescript");

    expect(text(lines[0])).toBe(long);
    expect(coloured(lines)).toBe(true);
  });
});

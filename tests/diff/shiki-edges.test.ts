import { describe, expect, it } from "vitest";
import { languageOf, tokenizeFile } from "@/highlight/shiki";
import type { Token } from "@/highlight/shiki";

function text(line: Token[]): string {
  return line.map((token) => token.content).join("");
}

describe("the extension is read the way a filesystem writes it", () => {
  it("answers the same for an upper case extension", () => {
    expect(languageOf("src/Order.TS")).toBe("typescript");
    expect(languageOf("src/UserService.PHP")).toBe("php");
  });

  it("does not take a dotfile for a source file", () => {
    expect(languageOf(".ts")).toBeNull();
    expect(languageOf("src/.php")).toBeNull();
  });
});

describe("a language shiki does not carry falls back to plain text", () => {
  it("returns the lines uncoloured instead of failing", async () => {
    const lines = await tokenizeFile("fn main() {}\nlet x = 1;", "rust");

    expect(lines.map(text)).toEqual(["fn main() {}", "let x = 1;"]);
    expect(lines.flat().every((token) => token.color === undefined)).toBe(true);
  });
});

describe("the line count is the one the diff maps against", () => {
  it("keeps a lone carriage return inside its line", async () => {
    const source = "const a = 1;\rconst b = 2;\nconst c = 3;";

    const lines = await tokenizeFile(source, "typescript");

    expect(lines).toHaveLength(2);
    expect(text(lines[1])).toBe("const c = 3;");
  });

  it("counts the trailing blank line of a file that ends in two newlines", async () => {
    const source = "const a = 1;\n\n";

    const lines = await tokenizeFile(source, "typescript");

    expect(lines).toHaveLength(3);
    expect(text(lines[2])).toBe("");
  });
});

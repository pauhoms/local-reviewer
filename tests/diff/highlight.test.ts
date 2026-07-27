import { describe, expect, it } from "vitest";
import { languageOf, tokenizeFile } from "@/highlight/shiki";
import type { Token } from "@/highlight/shiki";

const TS_SOURCE = [
  "const answer: number = 42;",
  "",
  "/**",
  " * public function ghost(): void",
  " * signal 🚀 with tab\tinside",
  " */",
  "export function real(): void {}",
].join("\n");

const PHP_SOURCE = [
  "<?php",
  "",
  "class UserService",
  "{",
  "    /* Maps the raw row.",
  "     * public function ghost(): void",
  "     * signal 🚀 inside the comment",
  "     */",
  "    private function map(array $row): User {",
  "        return new User($row);",
  "    }",
  "}",
].join("\n");

function text(line: Token[]): string {
  return line.map((token) => token.content).join("");
}

function colours(line: Token[]): Set<string | undefined> {
  return new Set(line.map((token) => token.color));
}

/** Themes merge the surrounding blanks into the token, so the word is what matters. */
function colourOf(line: Token[], word: string): string | undefined {
  const token = line.find((candidate) => candidate.content.trim() === word);
  if (!token) {
    throw new Error(`there is no "${word}" token in ${JSON.stringify(line.map((t) => t.content))}`);
  }
  return token.color;
}

describe("the language comes from the extension", () => {
  it("TS-25: reads typescript, php and nothing else out of the path", () => {
    expect(languageOf("src/order/Order.ts")).toBe("typescript");
    expect(languageOf("src/panels/DiffPanel.tsx")).toBe("typescript");
    expect(languageOf("src/UserService.php")).toBe("php");
    expect(languageOf("año/señal.tsx")).toBe("typescript");

    expect(languageOf("README.md")).toBeNull();
    expect(languageOf("Makefile")).toBeNull();
    expect(languageOf("src/main.rs")).toBeNull();
    expect(languageOf("src/a.ts.bak")).toBeNull();
    expect(languageOf("legacy.php5")).toBeNull();
    expect(languageOf("")).toBeNull();
  });

  it("TS-25: takes the extension of the file, not of a folder on the way", () => {
    expect(languageOf("vendor/lib.ts/readme.md")).toBeNull();
    expect(languageOf("vendor/lib.php/Order.ts")).toBe("typescript");
  });
});

describe("an unsupported file goes through as plain text", () => {
  it("TS-25: returns one line of uncoloured tokens per line, with no error", async () => {
    const source = ["# Notas", "", "\tcon tabulador", "señal año 🚀"].join("\n");

    const lines = await tokenizeFile(source, null);

    expect(lines).toHaveLength(4);
    expect(lines.map(text)).toEqual(["# Notas", "", "\tcon tabulador", "señal año 🚀"]);
    for (const line of lines) {
      for (const token of line) expect(token.color).toBeUndefined();
    }
  });

  it("TS-25: answers an empty file with a single empty line", async () => {
    const lines = await tokenizeFile("", null);

    expect(lines).toHaveLength(1);
    expect(text(lines[0])).toBe("");
  });
});

describe("typescript and php are highlighted with their own grammar", () => {
  it("TS-25: colours typescript keywords apart from identifiers", async () => {
    const lines = await tokenizeFile(TS_SOURCE, "typescript");

    const first = lines[0];
    expect(text(first)).toBe("const answer: number = 42;");
    const keyword = colourOf(first, "const");
    expect(keyword).toMatch(/^#[0-9a-fA-F]{3,8}$/);
    expect(colourOf(first, "answer")).not.toBe(keyword);
    expect(colourOf(lines[6], "function")).toBe(keyword);
  });

  it("TS-25: colours php with the php grammar, not the typescript one", async () => {
    const asPhp = await tokenizeFile(PHP_SOURCE, "php");
    const asTypescript = await tokenizeFile(PHP_SOURCE, "typescript");

    expect(text(asPhp[0])).toBe("<?php");
    expect(colourOf(asPhp[0], "<?")).toBe(colourOf(asPhp[2], "class"));
    expect(colourOf(asPhp[8], "function")).toBe(colourOf(asPhp[2], "class"));

    expect(asTypescript[0]).not.toEqual(asPhp[0]);
  });

  it("TS-25: keeps every line of the file, even the empty and the last one", async () => {
    const withTrailingNewline = `${TS_SOURCE}\n`;

    const lines = await tokenizeFile(withTrailingNewline, "typescript");

    expect(lines).toHaveLength(withTrailingNewline.split("\n").length);
    expect(text(lines[1])).toBe("");
    expect(text(lines[6])).toBe("export function real(): void {}");
  });

  it("TS-25: a CRLF file keeps its line count and carries no carriage return", async () => {
    const source = "const a = 1;\r\nconst b = 2;\r\n";

    const lines = await tokenizeFile(source, "typescript");

    expect(lines).toHaveLength(source.split("\n").length);
    expect(lines.map(text)).toEqual(["const a = 1;", "const b = 2;", ""]);
  });
});

describe("the whole file is tokenized at once, never line by line", () => {
  it("TS-24: keeps a typescript block comment coloured until it closes", async () => {
    const lines = await tokenizeFile(TS_SOURCE, "typescript");

    const opening = lines[2];
    const commentColour = colourOf(opening, "/**");
    expect(commentColour).toMatch(/^#[0-9a-fA-F]{3,8}$/);

    for (const index of [3, 4, 5]) {
      expect(text(lines[index])).toBe(TS_SOURCE.split("\n")[index]);
      expect(colours(lines[index])).toEqual(new Set([commentColour]));
    }

    expect(colourOf(lines[6], "function")).not.toBe(commentColour);
  });

  it("TS-24: the same line on its own is not coloured as a comment", async () => {
    const inside = " * public function ghost(): void";

    const whole = await tokenizeFile(TS_SOURCE, "typescript");
    const alone = await tokenizeFile(inside, "typescript");

    expect(text(whole[3])).toBe(inside);
    expect(text(alone[0])).toBe(inside);
    expect(colours(whole[3]).size).toBe(1);
    expect(colours(alone[0]).size).toBeGreaterThan(1);
    expect(colours(alone[0])).not.toEqual(colours(whole[3]));
  });

  it("TS-24: keeps a php block comment coloured until it closes", async () => {
    const lines = await tokenizeFile(PHP_SOURCE, "php");
    const rows = PHP_SOURCE.split("\n");

    const commentColour = colourOf(lines[4], "/* Maps the raw row.");

    for (const index of [5, 6, 7]) {
      expect(text(lines[index])).toBe(rows[index]);
      expect(colours(lines[index])).toEqual(new Set([commentColour]));
    }

    expect(colourOf(lines[8], "function")).not.toBe(commentColour);
    expect(colours(lines[8]).size).toBeGreaterThan(1);
  });
});

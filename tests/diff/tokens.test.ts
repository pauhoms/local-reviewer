import { describe, expect, it } from "vitest";
import { tokensForLine } from "@/diff/tokens";
import type { FileTokens } from "@/diff/tokens";
import type { Token } from "@/highlight/shiki";
import type { Line } from "@/ipc/types";

function tokens(...contents: Array<[string, string]>): Token[] {
  return contents.map(([content, color]) => ({ content, color }));
}

const OLD: Token[][] = [
  tokens(["const", "#f00"], [" viejo", "#0f0"]),
  tokens(["borrada", "#00f"]),
];

const NEW: Token[][] = [
  tokens(["const", "#f00"], [" nuevo", "#0f0"]),
  tokens(["añadida", "#0ff"]),
];

const BOTH: FileTokens = { old: OLD, new: NEW };

function line(kind: Line["kind"], oldNo: number | null, newNo: number | null, content: string): Line {
  return { kind, oldNo, newNo, content };
}

describe("each line takes the tokens of its own side of the file", () => {
  it("colours a deleted line with the old file", () => {
    const deleted = line("del", 2, null, "borrada");

    expect(tokensForLine(deleted, "borrada", BOTH)).toEqual(OLD[1]);
  });

  it("colours an added line with the new file", () => {
    const added = line("add", null, 2, "añadida");

    expect(tokensForLine(added, "añadida", BOTH)).toEqual(NEW[1]);
  });

  it("colours a context line with the new file", () => {
    const context = line("context", 1, 1, "const nuevo");

    expect(tokensForLine(context, "const nuevo", BOTH)).toEqual(NEW[0]);
  });

  it("falls back to the other side when the chosen one does not match", () => {
    const context = line("context", 1, 1, "const viejo");

    expect(tokensForLine(context, "const viejo", BOTH)).toEqual(OLD[0]);
  });
});

describe("a blob that does not answer to the diff colours nothing", () => {
  it("gives up when the body of the line is not the one of the blob", () => {
    const added = line("add", null, 1, "otra cosa");

    expect(tokensForLine(added, "otra cosa", BOTH)).toBeNull();
  });

  it("gives up when the file is shorter than the diff says", () => {
    const added = line("add", null, 99, "añadida");

    expect(tokensForLine(added, "añadida", BOTH)).toBeNull();
  });

  it("gives up while there are no tokens at all", () => {
    const added = line("add", null, 2, "añadida");

    expect(tokensForLine(added, "añadida", null)).toBeNull();
    expect(tokensForLine(added, "añadida", { old: null, new: null })).toBeNull();
  });

  it("gives up on a line with no number on either side", () => {
    const odd = line("context", null, null, "sin número");

    expect(tokensForLine(odd, "sin número", BOTH)).toBeNull();
  });

  it("ignores a number that is not a line of the file", () => {
    const added = line("add", null, 0, "añadida");

    expect(tokensForLine(added, "añadida", BOTH)).toBeNull();
  });
});

describe("an empty line still counts as a match", () => {
  it("takes the empty token list of its line", () => {
    const empty: Token[][] = [[]];
    const added = line("add", null, 1, "");

    expect(tokensForLine(added, "", { old: null, new: empty })).toEqual([]);
  });
});

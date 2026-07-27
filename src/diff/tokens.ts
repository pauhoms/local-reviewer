import type { Token } from "@/highlight/shiki";
import type { Line, Side } from "@/ipc/types";

export interface FileTokens {
  old: Token[][] | null;
  new: Token[][] | null;
}

function lineAt(tokens: Token[][] | null, number: number | null): Token[] | null {
  if (!tokens || number === null || number < 1 || number > tokens.length) return null;
  return tokens[number - 1];
}

function numberOn(line: Line, side: Side): number | null {
  return side === "old" ? line.oldNo : line.newNo;
}

function matches(tokens: Token[] | null, body: string): boolean {
  return tokens !== null && tokens.map((token) => token.content).join("") === body;
}

/**
 * The body on show always comes from the diff; the blob only lends its colours,
 * and only when both say the same thing — the file may have moved since.
 */
export function tokensForLine(line: Line, body: string, tokens: FileTokens | null): Token[] | null {
  if (!tokens) return null;
  const sides: Side[] = line.newNo !== null ? ["new", "old"] : ["old", "new"];
  for (const side of sides) {
    const candidate = lineAt(tokens[side], numberOn(line, side));
    if (matches(candidate, body)) return candidate;
  }
  return null;
}

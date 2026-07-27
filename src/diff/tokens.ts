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
 *
 * `preferred` is the column asking, when there is one: the same context line
 * shows on both sides of the split and a grammar that diverges between the two
 * blobs colours it differently, so each cell has to read its own file first.
 */
export function tokensForLine(
  line: Line,
  body: string,
  tokens: FileTokens | null,
  preferred?: Side,
): Token[] | null {
  if (!tokens) return null;
  const first = preferred ?? (line.newNo !== null ? "new" : "old");
  const sides: Side[] = first === "new" ? ["new", "old"] : ["old", "new"];
  for (const side of sides) {
    const candidate = lineAt(tokens[side], numberOn(line, side));
    if (matches(candidate, body)) return candidate;
  }
  return null;
}

import { createHighlighterCore } from "shiki/core";
import type { HighlighterCore } from "shiki/core";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";

export type Language = "typescript" | "php";

export interface Token {
  content: string;
  color?: string;
}

const THEME = "github-dark";

const BY_EXTENSION: Record<string, Language> = {
  ts: "typescript",
  tsx: "typescript",
  php: "php",
};

export function languageOf(path: string): Language | null {
  const name = path.slice(path.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return null;
  return BY_EXTENSION[name.slice(dot + 1).toLowerCase()] ?? null;
}

let loading: Promise<HighlighterCore> | null = null;

/**
 * Two grammars, one theme and the JavaScript engine: the full bundle drags in
 * hundreds of languages and the WASM engine, neither of which this viewer needs.
 */
function highlighter(): Promise<HighlighterCore> {
  if (!loading) {
    loading = createHighlighterCore({
      themes: [import("shiki/themes/github-dark.mjs")],
      langs: [import("shiki/langs/typescript.mjs"), import("shiki/langs/php.mjs")],
      engine: createJavaScriptRegexEngine(),
    })
      .then(warmUp)
      .catch((error: unknown) => {
        loading = null;
        throw error;
      });
  }
  return loading;
}

/**
 * Registering a grammar does not compile its patterns; the first file to be
 * tokenized pays for that, and the TextMate tokenizer underneath gives up on a
 * line it cannot finish in time — leaving it half coloured rather than failing.
 * Paying it here on one throwaway line keeps that cost off the first real file.
 */
async function warmUp(shiki: HighlighterCore): Promise<HighlighterCore> {
  // Enough shapes to reach the patterns a real file needs: keyword, annotated
  // binding, string, call and block comment.
  const samples: Record<Language, string> = {
    typescript: '/* c */\nconst a: number = f("s");\nexport function g(): void {}\n',
    php: '<?php\n/* c */\nclass A { public function g(string $s): int { return 1; } }\n',
  };
  for (const lang of ["typescript", "php"] as const) {
    shiki.codeToTokens(samples[lang], { lang, theme: THEME });
  }
  return shiki;
}

/**
 * Shiki walks the whole file with a regex engine on the main thread, and the
 * cost of one line grows far faster than its length: a bundle packed into a
 * single 20 000-character line freezes the panel for seconds. Nobody writes
 * source anywhere near these sizes by hand, and a generated file is not what
 * anyone reviews line by line, so above them the colour is not worth the freeze.
 */
const MAX_LINE_LENGTH = 2_000;
const MAX_LINES = 20_000;

function plainLines(source: string): Token[][] {
  return source.split("\n").map((content) => [{ content }]);
}

function tooBigToColour(lines: Token[][]): boolean {
  if (lines.length > MAX_LINES) return true;
  return lines.some(([{ content }]) => content.length > MAX_LINE_LENGTH);
}

function isSupported(language: string | null): language is Language {
  return language === "typescript" || language === "php";
}

/**
 * One entry per line of `source`, always: the diff maps tokens to lines by
 * number, so a shorter answer would colour the wrong lines. Highlighting is a
 * garnish, and a garnish that fails leaves the text alone.
 */
export async function tokenizeFile(source: string, language: string | null): Promise<Token[][]> {
  const text = source.replace(/\r\n/g, "\n");
  const plain = plainLines(text);
  if (!isSupported(language) || tooBigToColour(plain)) return plain;

  try {
    const shiki = await highlighter();
    const { tokens } = shiki.codeToTokens(text, { lang: language, theme: THEME });
    if (tokens.length !== plain.length) return plain;
    return tokens.map((line) => line.map(({ content, color }) => ({ content, color })));
  } catch {
    return plain;
  }
}

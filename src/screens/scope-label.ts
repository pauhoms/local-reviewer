import type { Scope } from "@/ipc/types";

const SHORT_SHA_LENGTH = 7;

export type ScopeMode = "worktree" | "commit" | "range";

export const SCOPE_MODES: ReadonlyArray<{ mode: ScopeMode; label: string }> = [
  { mode: "worktree", label: "Cambios sin commitear" },
  { mode: "commit", label: "Un commit" },
  { mode: "range", label: "Rango de commits" },
];

export function shortSha(reference: string): string {
  return reference.slice(0, SHORT_SHA_LENGTH);
}

/** What the header says the review is about, in the same words as the CLI. */
export function scopeLabel(scope: Scope): string {
  switch (scope.kind) {
    case "worktree":
      return "worktree";
    case "commit":
      return shortSha(scope.sha);
    case "range":
      return `${shortSha(scope.from)}..${shortSha(scope.to)}`;
  }
}

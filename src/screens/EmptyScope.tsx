import type { Scope } from "@/ipc/types";
import { START_KEYMAPS } from "@/keys/keymap";
import type { Command } from "@/keys/types";
import { NO_LISTS, useKeyboard } from "@/keys/useKeyboard";
import { scopeLabel } from "./scope-label";

interface EmptyScopeProps {
  scope: Scope;
  onBack: () => void;
}

function reason(scope: Scope): { headline: string; detail: string } {
  switch (scope.kind) {
    case "worktree":
      return {
        headline: "No hay cambios sin commitear en este repo.",
        detail: "(working tree limpio respecto a HEAD)",
      };
    case "commit":
      return {
        headline: "Este commit no toca ningún fichero.",
        detail: `(${scopeLabel(scope)} no trae cambios)`,
      };
    case "range":
      return {
        headline: "Este rango no acumula ningún cambio.",
        detail: `(${scopeLabel(scope)} no trae cambios)`,
      };
  }
}

export default function EmptyScope({ scope, onBack }: EmptyScopeProps): JSX.Element {
  useKeyboard(
    NO_LISTS,
    (commands: Command[]) => {
      if (commands.some((command) => command.type === "Confirm")) onBack();
    },
    START_KEYMAPS,
  );

  const { headline, detail } = reason(scope);

  return (
    <div className="app empty-scope">
      <p className="empty-headline">{headline}</p>
      <p className="empty-detail">{detail}</p>
      <p className="empty-hint">
        <kbd>Enter</kbd> elegir otro alcance
      </p>
    </div>
  );
}

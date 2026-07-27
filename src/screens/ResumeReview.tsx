import type { Scope } from "@/ipc/types";
import { START_KEYMAPS } from "@/keys/keymap";
import type { Command } from "@/keys/types";
import { NO_LISTS, useKeyboard } from "@/keys/useKeyboard";
import { scopeLabel } from "./scope-label";

interface ResumeReviewProps {
  scope: Scope;
  commentCount: number;
  onResume: () => void;
  onDiscard: () => void;
}

export default function ResumeReview({
  scope,
  commentCount,
  onResume,
  onDiscard,
}: ResumeReviewProps): JSX.Element {
  useKeyboard(
    NO_LISTS,
    (commands: Command[]) => {
      for (const command of commands) {
        if (command.type === "Confirm") onResume();
        else if (command.type === "Escape") onDiscard();
      }
    },
    START_KEYMAPS,
  );

  const comments =
    commentCount === 1 ? "1 comentario guardado" : `${commentCount} comentarios guardados`;

  return (
    <div className="app app-message resume-review">
      <h1>Revisión sin terminar</h1>
      <p role="status">¿Quieres retomar la revisión de este alcance?</p>
      <p className="resume-scope">{scopeLabel(scope)}</p>
      <p className="resume-count">{comments}</p>
      <p className="empty-hint">
        <kbd>Enter</kbd> continuar donde lo dejaste · <kbd>Esc</kbd> empezar de cero
      </p>
    </div>
  );
}

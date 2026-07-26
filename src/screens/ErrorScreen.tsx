import { START_KEYMAPS } from "@/keys/keymap";
import type { Command } from "@/keys/types";
import { NO_LISTS, useKeyboard } from "@/keys/useKeyboard";

interface ErrorScreenProps {
  message: string;
  onBack: () => void;
}

export default function ErrorScreen({ message, onBack }: ErrorScreenProps): JSX.Element {
  useKeyboard(
    NO_LISTS,
    (commands: Command[]) => {
      if (commands.some((command) => command.type === "Confirm")) onBack();
    },
    START_KEYMAPS,
  );

  return (
    <div className="app app-message">
      <p role="alert">{message}</p>
      <p className="empty-hint">
        <kbd>Enter</kbd> volver a elegir el alcance
      </p>
    </div>
  );
}

import { COPY_PATH_KEY, EXPORT_KEY } from "@/keys/keymap";

interface ToolbarProps {
  /** Where the last export landed, `null` while nothing has been exported. */
  path: string | null;
  error: string | null;
  /** Whether that path is what the clipboard holds right now. */
  copied: boolean;
  onExport: () => void;
  onCopy: () => void;
}

/** Keeps the click from focusing the button: a focused button answers `Enter`
 *  and `Space` on its own, outside the machine that owns every key. */
function keepFocus(event: { preventDefault: () => void }): void {
  event.preventDefault();
}

/**
 * These labels match the actions named throughout the product and README.
 */
export default function Toolbar({
  path,
  error,
  copied,
  onExport,
  onCopy,
}: ToolbarProps): JSX.Element {
  return (
    <div className="toolbar">
      <button
        type="button"
        className="toolbar-button"
        tabIndex={-1}
        data-shortcut={EXPORT_KEY}
        onMouseDown={keepFocus}
        onClick={onExport}
      >
        Export Review <kbd>{EXPORT_KEY}</kbd>
      </button>
      <button
        type="button"
        className="toolbar-button"
        tabIndex={-1}
        data-shortcut={COPY_PATH_KEY}
        onMouseDown={keepFocus}
        onClick={onCopy}
        disabled={path === null}
      >
        Copy Path <kbd>{COPY_PATH_KEY}</kbd>
      </button>
      {copied && (
        <span className="toolbar-copied" role="status">
          copied ✓
        </span>
      )}
      {path !== null && (
        <p className="toolbar-exported">
          Review exported:{" "}
          <code className="toolbar-path" data-export-path="">
            {path}
          </code>
        </p>
      )}
      {error !== null && (
        <p className="toolbar-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

import type { Scope } from "@/ipc/types";
import { selectionRange } from "@/keys/selection";
import type { Mode, Panel, Selection } from "@/keys/types";
import { useKeyboard } from "@/keys/useKeyboard";
import { basename } from "./paths";
import { scopeLabel } from "./scope-label";

const PANEL_ORDER: Panel[] = ["tree", "diff", "comments"];

const PANEL_TITLES: Record<Panel, string> = {
  tree: "1 ÁRBOL",
  diff: "2 DIFF",
  comments: "3 COMENTARIOS",
};

/** Placeholder lists until the real panels (fases 4-6) render actual review data. */
const PANEL_ITEMS: Record<Panel, string[]> = {
  tree: ["item 1", "item 2", "item 3", "item 4"],
  diff: ["línea 1", "línea 2", "línea 3", "línea 4", "línea 5"],
  comments: ["comentario 1", "comentario 2", "comentario 3"],
};

const MODE_LABELS: Record<Mode, string> = {
  normal: "NORMAL",
  visual: "VISUAL",
  insert: "INSERT",
};

interface ReviewShellProps {
  scope: Scope;
}

interface PanelView {
  name: Panel;
  cursor: number;
  active: boolean;
  range: Selection | null;
}

function isSelected(index: number, cursor: number, range: Selection | null): boolean {
  if (!range) return index === cursor;
  const { from, to } = selectionRange(range);
  return index >= from && index <= to;
}

function renderPanel({ name, cursor, active, range }: PanelView): JSX.Element {
  const title = PANEL_TITLES[name];
  return (
    <section
      key={name}
      className="panel"
      aria-label={title}
      aria-current={active}
      data-active={active}
    >
      <h2>{title}</h2>
      <ul role="listbox" className="panel-list">
        {PANEL_ITEMS[name].map((item, index) => (
          <li
            key={item}
            role="option"
            aria-selected={isSelected(index, cursor, range)}
            data-cursor={index === cursor}
          >
            {item}
          </li>
        ))}
      </ul>
    </section>
  );
}

export default function ReviewShell({ scope }: ReviewShellProps): JSX.Element {
  const state = useKeyboard({
    tree: { itemCount: PANEL_ITEMS.tree.length, pageSize: PANEL_ITEMS.tree.length },
    diff: { itemCount: PANEL_ITEMS.diff.length, pageSize: PANEL_ITEMS.diff.length },
    comments: { itemCount: PANEL_ITEMS.comments.length, pageSize: PANEL_ITEMS.comments.length },
  });

  const range = state.mode === "visual" ? state.selection : null;

  return (
    <div className="app">
      <header className="app-header">
        <h1>AI Code Reviewer</h1>
        <span className="scope-summary">
          {basename(scope.repo)} · {scopeLabel(scope)}
        </span>
        <span className="mode-indicator" data-mode={state.mode} aria-live="polite">
          {MODE_LABELS[state.mode]}
        </span>
      </header>
      <div className="panels">
        {PANEL_ORDER.map((name) => {
          const active = state.activePanel === name;
          return renderPanel({
            name,
            cursor: state.panels[name].cursor,
            active,
            range: active ? range : null,
          });
        })}
      </div>
    </div>
  );
}

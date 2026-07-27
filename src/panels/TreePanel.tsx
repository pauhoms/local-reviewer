import type { DiffTotals, FlatRow } from "@/tree/build-tree";

const TITLE = "1 ÁRBOL";

interface TreePanelProps {
  rows: FlatRow[];
  cursor: number;
  active: boolean;
  commentCounts: ReadonlyMap<string, number>;
  totals: DiffTotals;
}

function indentOf(depth: number): { paddingLeft: string } {
  return { paddingLeft: `calc(0.75rem + ${depth} * var(--tree-indent))` };
}

function treeRow(
  row: FlatRow,
  index: number,
  selected: boolean,
  commentCount: number,
): JSX.Element {
  const { node, depth } = row;
  // Two rows can share a path: a folder and the file it replaced, for one.
  const key = `${index}:${node.path}`;
  const shared = {
    role: "option",
    "aria-selected": selected,
    "data-cursor": selected,
    "data-path": node.path,
    style: indentOf(depth),
  };

  if (node.kind === "dir") {
    // `option` ignores aria-expanded, so the fold state also goes in the name;
    // otherwise a screen reader never hears whether the folder is open.
    return (
      <li
        key={key}
        {...shared}
        data-kind="dir"
        aria-expanded={row.expanded}
        aria-label={`${node.name}, ${row.expanded ? "desplegada" : "plegada"}`}
      >
        <span aria-hidden="true">{row.expanded ? "▾" : "▸"}</span>{" "}
        <span className="tree-name">{node.name}</span>
      </li>
    );
  }

  return (
    <li key={key} {...shared} data-kind="file">
      <span className="tree-status" data-status={node.file.status}>
        {node.file.status}
      </span>{" "}
      <span className="tree-name">{node.name}</span>{" "}
      <span className="tree-counts">
        +{node.file.additions} −{node.file.deletions}
      </span>
      {commentCount > 0 && <span className="tree-comments"> ●{commentCount}</span>}
    </li>
  );
}

export default function TreePanel({
  rows,
  cursor,
  active,
  commentCounts,
  totals,
}: TreePanelProps): JSX.Element {
  return (
    <section className="panel" aria-label={TITLE} aria-current={active} data-active={active}>
      <h2>
        {TITLE}{" "}
        <span className="tree-totals">
          {totals.files}f +{totals.additions} −{totals.deletions}
        </span>
      </h2>
      {rows.length === 0 ? (
        <p className="panel-empty">Ningún fichero cambiado.</p>
      ) : (
        <ul role="listbox" className="panel-list tree-list">
          {rows.map((row, index) =>
            treeRow(row, index, index === cursor, commentCounts.get(row.node.path) ?? 0),
          )}
        </ul>
      )}
      <footer className="panel-help">j/k mover · l expandir · h contraer/subir · Enter abrir</footer>
    </section>
  );
}

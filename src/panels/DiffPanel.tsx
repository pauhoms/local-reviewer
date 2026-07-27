import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { buildDiffRows } from "@/diff/rows";
import { splitLayout } from "@/diff/split-rows";
import type { FileTokens } from "@/diff/tokens";
import { DEFAULT_PAGE_SIZE, diffPage, mountedRows, OVERSCAN } from "@/diff/window";
import { languageOf, tokenizeFile } from "@/highlight/shiki";
import type { Token } from "@/highlight/shiki";
import { readBlob } from "@/ipc/client";
import type { DiffView, FileDiff, Scope, Side } from "@/ipc/types";
import type { Selection } from "@/keys/types";
import SplitDiff from "./SplitDiff";
import UnifiedDiff from "./UnifiedDiff";
import VirtualList from "./VirtualList";

const TITLE = "2 DIFF";

const NO_LINES = "Sin líneas que mostrar.";
const NOT_IN_DIFF = "El fichero seleccionado no está en los cambios.";

const SIDE_LABELS: Record<Side, string> = { old: "OLD", new: "NEW" };

/** Left to right, the way the mockup draws them. */
const COLUMNS: Side[] = ["old", "new"];

const HELP: Record<DiffView, string> = {
  unified:
    "j/k línea · gg/G extremos · Ctrl+d/Ctrl+u media página · v seleccionar · c comentar · Ctrl+w v partir",
  split:
    "j/k fila · h/l lado · gg/G extremos · Ctrl+d/Ctrl+u media página · v seleccionar · c comentar · Ctrl+w o unificado",
};

interface LoadedTokens extends FileTokens {
  path: string;
}

interface DiffPanelProps {
  scope: Scope;
  path: string | null;
  /** `null` when the selected path is not among the changes. */
  file: FileDiff | null;
  cursor: number;
  active: boolean;
  range: Selection | null;
  view: DiffView;
  /** Column the cursor is on; only the split view shows two. */
  side: Side;
  /** The geometry of the viewport, for whoever has to halve a page: rows it
   *  fits and row it is scrolled to. Both are read in rows on purpose — how
   *  many items that is depends on the view, and the view can change between
   *  this measurement and the key that uses it. */
  onViewport: (rows: number, topRow: number) => void;
}

function emptyMessage(file: FileDiff | null, itemCount: number): string | null {
  if (!file) return NOT_IN_DIFF;
  return itemCount === 0 ? NO_LINES : null;
}

export default function DiffPanel({
  scope,
  path,
  file,
  cursor,
  active,
  range,
  view,
  side,
  onViewport,
}: DiffPanelProps): JSX.Element {
  const [rowsPerPage, setRowsPerPage] = useState(DEFAULT_PAGE_SIZE);
  const [tokens, setTokens] = useState<LoadedTokens | null>(null);

  /** First row the scroll was left on; the cursor drags it when it walks out. */
  const offsetRef = useRef(0);
  const [, redraw] = useState(0);

  useEffect(() => {
    if (!file || path === null) {
      setTokens(null);
      return undefined;
    }

    let alive = true;
    // A rename has one name per side, and each name answers for its own grammar.
    const names: Record<Side, string> = { old: file.oldPath ?? path, new: path };
    const sideOf = (of: Side): Promise<Token[][] | null> => {
      const name = names[of];
      const language = languageOf(name);
      if (language === null) return Promise.resolve(null);
      return readBlob(scope, name, of)
        .then((source) => tokenizeFile(source, language))
        .catch(() => null);
    };

    void Promise.all([sideOf("old"), sideOf("new")]).then(([oldSide, newSide]) => {
      // The answer of a file that already left the panel colours nothing.
      if (alive) setTokens({ path, old: oldSide, new: newSide });
    });

    return () => {
      alive = false;
    };
  }, [scope, path, file]);

  const unified = useMemo(() => buildDiffRows(file), [file]);
  const split = useMemo(() => (view === "split" ? splitLayout(file) : null), [view, file]);

  const handleTopRow = useCallback((row: number): void => {
    offsetRef.current = row;
    redraw((tick) => tick + 1);
  }, []);

  // The cursor walks lines in one view and rows in the other, so everything
  // below counts items: the two views only differ in what an item holds.
  const rowCount = split ? split.rows.length : unified.rows.length;
  const itemRows = split ? split.itemRows : unified.lineRows;
  const itemCount = itemRows.length;
  const fileTokens = tokens && tokens.path === path ? tokens : null;

  const page = diffPage(itemRows, {
    rowCount,
    pageSize: rowsPerPage,
    cursor,
    offset: offsetRef.current,
  });
  const { visible, items } = page;
  // Written while rendering: where the window ends up is where the next one starts.
  offsetRef.current = visible.first;
  const mounted = mountedRows(itemRows, rowCount, items, OVERSCAN);

  useEffect(() => onViewport(rowsPerPage, visible.first), [rowsPerPage, visible.first, onViewport]);

  const empty = emptyMessage(file, itemCount);

  return (
    <section className="panel" aria-label={TITLE} aria-current={active} data-active={active}>
      <h2>
        {TITLE}
        {path !== null && <span className="panel-subtitle"> {path}</span>}
        {itemCount > 0 && (
          <span className="diff-position">
            {" "}
            {split ? "fila" : "línea"} {Math.min(cursor, itemCount - 1) + 1} de {itemCount}
          </span>
        )}
        {split && <span className="diff-view"> SPLIT · lado {SIDE_LABELS[side]}</span>}
      </h2>
      {empty !== null && <p className="panel-empty">{empty}</p>}
      {split && (
        <div className="split-columns">
          {COLUMNS.map((column) => (
            <span
              key={column}
              className="split-column"
              data-column={column}
              data-active={column === side}
            >
              {SIDE_LABELS[column]}
              {column === side && <span className="split-column-mark"> ◀ lado activo</span>}
            </span>
          ))}
        </div>
      )}
      <VirtualList
        rowCount={rowCount}
        firstRow={mounted.start}
        scrollRow={visible.first}
        items={items}
        itemsPerPage={page.itemCount}
        onRowsPerPage={setRowsPerPage}
        onTopRow={handleTopRow}
      >
        {split ? (
          <SplitDiff
            rows={split.rows}
            first={mounted.start}
            last={mounted.end}
            cursor={cursor}
            side={side}
            range={range}
            tokens={fileTokens}
          />
        ) : (
          <UnifiedDiff
            rows={unified.rows}
            first={mounted.start}
            last={mounted.end}
            cursor={cursor}
            range={range}
            tokens={fileTokens}
          />
        )}
      </VirtualList>
      <footer className="panel-help">{HELP[view]}</footer>
    </section>
  );
}

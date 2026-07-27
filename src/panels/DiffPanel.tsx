import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { buildDiffRows, lineBody } from "@/diff/rows";
import { tokensForLine } from "@/diff/tokens";
import type { FileTokens } from "@/diff/tokens";
import { DEFAULT_PAGE_SIZE, linesInWindow, mountedRows, OVERSCAN, rowWindow } from "@/diff/window";
import { languageOf, tokenizeFile } from "@/highlight/shiki";
import type { Token } from "@/highlight/shiki";
import { readBlob } from "@/ipc/client";
import type { FileDiff, Scope, Side } from "@/ipc/types";
import { selectionRange } from "@/keys/selection";
import type { Selection } from "@/keys/types";
import DiffLine from "./DiffLine";
import VirtualList from "./VirtualList";

const TITLE = "2 DIFF";

const NO_LINES = "Sin líneas que mostrar.";
const NOT_IN_DIFF = "El fichero seleccionado no está en los cambios.";

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
  /** Lines the viewport is showing, which is what half a page is half of. */
  onPageSize: (lines: number) => void;
}

function isSelected(index: number, cursor: number, range: Selection | null): boolean {
  if (!range) return index === cursor;
  const { from, to } = selectionRange(range);
  return index >= from && index <= to;
}

function emptyMessage(file: FileDiff | null, lineCount: number): string | null {
  if (!file) return NOT_IN_DIFF;
  return lineCount === 0 ? NO_LINES : null;
}

export default function DiffPanel({
  scope,
  path,
  file,
  cursor,
  active,
  range,
  onPageSize,
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
    const sideOf = (side: Side): Promise<Token[][] | null> => {
      const name = names[side];
      const language = languageOf(name);
      if (language === null) return Promise.resolve(null);
      return readBlob(scope, name, side)
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

  const { rows, lineRows } = useMemo(() => buildDiffRows(file), [file]);

  const handleTopRow = useCallback((row: number): void => {
    offsetRef.current = row;
    redraw((tick) => tick + 1);
  }, []);

  const lineCount = lineRows.length;
  const fileTokens = tokens && tokens.path === path ? tokens : null;

  const view = rowWindow(lineRows, {
    rowCount: rows.length,
    pageSize: rowsPerPage,
    cursor,
    offset: offsetRef.current,
  });
  // Written while rendering: where the window ends up is where the next one starts.
  offsetRef.current = view.first;
  const lines = linesInWindow(lineRows, view);
  const mounted = mountedRows(lineRows, rows.length, lines, OVERSCAN);
  const linesPerPage = lineCount === 0 ? 1 : lines.last - lines.first + 1;

  // Half a page is half of what the reader can see, and what he sees is lines:
  // the hunk headers in the window take rows off the count.
  useEffect(() => onPageSize(linesPerPage), [linesPerPage, onPageSize]);

  const shown: JSX.Element[] = [];
  for (let index = mounted.start; index <= mounted.end; index += 1) {
    const row = rows[index];
    if (row.kind === "header") {
      shown.push(
        <li key={index} className="diff-hunk-header" role="separator" data-hunk-header="">
          {row.header}
        </li>,
      );
      continue;
    }
    const body = lineBody(row.line.content);
    shown.push(
      <DiffLine
        key={index}
        line={row.line}
        index={row.index}
        cursor={row.index === cursor}
        selected={isSelected(row.index, cursor, range)}
        tokens={tokensForLine(row.line, body, fileTokens)}
      />,
    );
  }

  const empty = emptyMessage(file, lineCount);

  return (
    <section className="panel" aria-label={TITLE} aria-current={active} data-active={active}>
      <h2>
        {TITLE}
        {path !== null && <span className="panel-subtitle"> {path}</span>}
        {lineCount > 0 && (
          <span className="diff-position">
            {" "}
            línea {Math.min(cursor, lineCount - 1) + 1} de {lineCount}
          </span>
        )}
      </h2>
      {empty !== null && <p className="panel-empty">{empty}</p>}
      <VirtualList
        rowCount={rows.length}
        firstRow={mounted.start}
        scrollRow={view.first}
        lines={lines}
        linesPerPage={linesPerPage}
        onRowsPerPage={setRowsPerPage}
        onTopRow={handleTopRow}
      >
        {shown}
      </VirtualList>
      <footer className="panel-help">
        j/k línea · gg/G extremos · Ctrl+d/Ctrl+u media página · v seleccionar · c comentar
      </footer>
    </section>
  );
}

import { lineBody } from "@/diff/rows";
import type { SplitLayoutRow, SplitLine } from "@/diff/split-rows";
import { tokensForLine } from "@/diff/tokens";
import type { FileTokens } from "@/diff/tokens";
import type { Side } from "@/ipc/types";
import { isSelected } from "@/keys/selection";
import type { Selection } from "@/keys/types";
import SplitCell from "./SplitCell";

interface SplitDiffProps {
  rows: readonly SplitLayoutRow[];
  /** Rows mounted, both ends included; the rest is empty space in the sizer. */
  first: number;
  last: number;
  /** Row the cursor is on, counted the way the reader walks: headers apart. */
  cursor: number;
  /** Column the cursor and the range live on; the other one only shows. */
  side: Side;
  range: Selection | null;
  tokens: FileTokens | null;
}

export default function SplitDiff({
  rows,
  first,
  last,
  cursor,
  side,
  range,
  tokens,
}: SplitDiffProps): JSX.Element {
  const cell = (
    own: SplitLine | null,
    column: Side,
    active: boolean,
    chosen: boolean,
  ): JSX.Element => (
    <SplitCell
      cell={own}
      side={column}
      cursor={active && side === column}
      selected={chosen && side === column}
      tokens={
        own === null ? null : tokensForLine(own.line, lineBody(own.line.content), tokens, column)
      }
    />
  );

  const shown: JSX.Element[] = [];
  for (let at = first; at <= last; at += 1) {
    const row = rows[at];
    if (row === undefined) continue;
    if (row.kind === "header") {
      shown.push(
        <li
          key={at}
          className="diff-hunk-header"
          role="separator"
          data-split-row={at}
          data-hunk-header=""
        >
          {row.header}
        </li>,
      );
      continue;
    }
    const active = row.item === cursor;
    const chosen = isSelected(row.item, cursor, range);
    shown.push(
      // The row is only the frame that keeps the columns aligned: what the
      // reader chooses is the cell of the active side.
      <li key={at} className="split-row" role="presentation" data-split-row={at}>
        {cell(row.old, "old", active, chosen)}
        {cell(row.new, "new", active, chosen)}
      </li>,
    );
  }
  return <>{shown}</>;
}

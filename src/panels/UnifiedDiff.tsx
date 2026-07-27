import { lineBody } from "@/diff/rows";
import type { DiffRow } from "@/diff/rows";
import { tokensForLine } from "@/diff/tokens";
import type { FileTokens } from "@/diff/tokens";
import { isSelected } from "@/keys/selection";
import type { Selection } from "@/keys/types";
import DiffLine from "./DiffLine";

interface UnifiedDiffProps {
  rows: readonly DiffRow[];
  /** Rows mounted, both ends included; the rest is empty space in the sizer. */
  first: number;
  last: number;
  cursor: number;
  range: Selection | null;
  tokens: FileTokens | null;
}

export default function UnifiedDiff({
  rows,
  first,
  last,
  cursor,
  range,
  tokens,
}: UnifiedDiffProps): JSX.Element {
  const shown: JSX.Element[] = [];
  for (let at = first; at <= last; at += 1) {
    const row = rows[at];
    if (row === undefined) continue;
    if (row.kind === "header") {
      shown.push(
        <li key={at} className="diff-hunk-header" role="separator" data-hunk-header="">
          {row.header}
        </li>,
      );
      continue;
    }
    const body = lineBody(row.line.content);
    shown.push(
      <DiffLine
        key={at}
        line={row.line}
        index={row.index}
        cursor={row.index === cursor}
        selected={isSelected(row.index, cursor, range)}
        tokens={tokensForLine(row.line, body, tokens)}
      />,
    );
  }
  return <>{shown}</>;
}

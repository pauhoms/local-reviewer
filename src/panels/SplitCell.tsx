import { lineBody, lineMarker } from "@/diff/rows";
import type { SplitLine } from "@/diff/split-rows";
import type { Token } from "@/highlight/shiki";
import type { Side } from "@/ipc/types";
import TokenText from "./TokenText";

interface SplitCellProps {
  /** The line this column holds on this row, `null` when it is a gap. */
  cell: SplitLine | null;
  side: Side;
  cursor: boolean;
  selected: boolean;
  tokens: Token[] | null;
}

export default function SplitCell({
  cell,
  side,
  cursor,
  selected,
  tokens,
}: SplitCellProps): JSX.Element {
  // A gap holds nothing and is still there: without it the columns would drift.
  if (cell === null) {
    return (
      <div
        className="split-cell split-gap"
        data-side={side}
        data-cursor={cursor ? true : undefined}
      />
    );
  }

  const { line } = cell;
  const number = side === "old" ? line.oldNo : line.newNo;
  return (
    <div
      className="split-cell"
      role="option"
      aria-selected={selected}
      data-side={side}
      data-line-index={cell.index}
      data-kind={line.kind}
      data-cursor={cursor ? true : undefined}
    >
      <span
        className="diff-no"
        data-old-no={side === "old" ? "" : undefined}
        data-new-no={side === "new" ? "" : undefined}
      >
        {number ?? ""}
      </span>
      <span className="diff-marker" data-line-marker="">
        {lineMarker(line.kind)}
      </span>
      <code className="diff-content" data-line-content="">
        <TokenText tokens={tokens} text={lineBody(line.content)} />
      </code>
    </div>
  );
}

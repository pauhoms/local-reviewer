import { lineBody, lineMarker } from "@/diff/rows";
import type { Token } from "@/highlight/shiki";
import type { Line } from "@/ipc/types";
import TokenText from "./TokenText";

interface DiffLineProps {
  line: Line;
  index: number;
  cursor: boolean;
  selected: boolean;
  tokens: Token[] | null;
}

export default function DiffLine({
  line,
  index,
  cursor,
  selected,
  tokens,
}: DiffLineProps): JSX.Element {
  return (
    <li
      className="diff-line"
      role="option"
      aria-selected={selected}
      data-line-index={index}
      data-kind={line.kind}
      data-cursor={cursor ? true : undefined}
    >
      <span className="diff-no" data-old-no="">
        {line.oldNo ?? ""}
      </span>
      <span className="diff-no" data-new-no="">
        {line.newNo ?? ""}
      </span>
      <span className="diff-marker" data-line-marker="">
        {lineMarker(line.kind)}
      </span>
      <code className="diff-content" data-line-content="">
        <TokenText tokens={tokens} text={lineBody(line.content)} />
      </code>
    </li>
  );
}

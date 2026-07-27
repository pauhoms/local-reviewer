import { lineBody } from "@/diff/rows";
import type { Token } from "@/highlight/shiki";
import type { Line, LineKind } from "@/ipc/types";

const MARKERS: Record<LineKind, string> = {
  add: "+",
  del: "-",
  context: " ",
};

interface DiffLineProps {
  line: Line;
  index: number;
  cursor: boolean;
  selected: boolean;
  tokens: Token[] | null;
}

function body(tokens: Token[] | null, text: string): JSX.Element[] | string {
  if (!tokens) return text;
  return tokens.map((token, position) => (
    <span key={position} style={token.color ? { color: token.color } : undefined}>
      {token.content}
    </span>
  ));
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
        {MARKERS[line.kind]}
      </span>
      <code className="diff-content" data-line-content="">
        {body(tokens, lineBody(line.content))}
      </code>
    </li>
  );
}

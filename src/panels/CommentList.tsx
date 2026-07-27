import { useLayoutEffect, useRef } from "react";
import { lineRangeLabel, summarize } from "@/comments/label";
import { basename } from "@/screens/paths";
import type { ReviewComment } from "@/state/review";
import { revealCursor } from "./cursor-scroll";

interface CommentListProps {
  comments: readonly ReviewComment[];
  cursor: number;
  folded: ReadonlySet<string>;
}

function entry(comment: ReviewComment, onCursor: boolean, expanded: boolean): JSX.Element {
  const range = lineRangeLabel(comment.from, comment.to);
  return (
    <li
      key={comment.id}
      role="option"
      aria-selected={onCursor}
      aria-expanded={expanded}
      data-cursor={onCursor}
      data-comment-id={comment.id}
      data-comment-side={comment.side}
      data-path={comment.path}
      className="comment-entry"
    >
      <span className="comment-fold" aria-hidden="true">
        {expanded ? "▾" : "▸"}
      </span>{" "}
      <span className="comment-file">{basename(comment.path)}</span>{" "}
      <span className="comment-range" data-comment-range="">
        {range}
      </span>
      {expanded && (
        <span className="comment-summary" data-comment-summary="">
          {summarize(comment.text)}
        </span>
      )}
    </li>
  );
}

export default function CommentList({ comments, cursor, folded }: CommentListProps): JSX.Element {
  const listRef = useRef<HTMLUListElement>(null);

  useLayoutEffect(() => {
    const list = listRef.current;
    if (list) revealCursor(list);
  }, [comments, cursor, folded]);

  return (
    <ul ref={listRef} role="listbox" className="panel-list comment-list">
      {comments.map((comment, index) =>
        entry(comment, index === cursor, !folded.has(comment.id)),
      )}
    </ul>
  );
}

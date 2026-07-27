import type { ReviewComment } from "@/state/review";
import CommentEditor from "./CommentEditor";
import CommentList from "./CommentList";

const TITLE = "3 COMMENTS";

const EMPTY = "No comments yet.";

interface CommentsPanelProps {
  comments: readonly ReviewComment[];
  cursor: number;
  active: boolean;
  folded: ReadonlySet<string>;
  /** The comment being written, `null` when nobody is writing. */
  editing: ReviewComment | null;
  onEditorChange: (text: string) => void;
}

export default function CommentsPanel({
  comments,
  cursor,
  active,
  folded,
  editing,
  onEditorChange,
}: CommentsPanelProps): JSX.Element {
  return (
    <section className="panel" aria-label={TITLE} aria-current={active} data-active={active}>
      <h2>
        {TITLE}
        {comments.length > 0 && (
          <span className="comment-position">
            {" "}
            {Math.min(cursor, comments.length - 1) + 1} of {comments.length}
          </span>
        )}
      </h2>
      {comments.length === 0 ? (
        <p className="panel-empty">{EMPTY}</p>
      ) : (
        <CommentList comments={comments} cursor={cursor} folded={folded} />
      )}
      {editing !== null && <CommentEditor comment={editing} onChange={onEditorChange} />}
      <footer className="panel-help">
        j/k move · i edit · Enter jump to diff · dd delete · zc/zo fold
      </footer>
    </section>
  );
}

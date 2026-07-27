import { useEffect, useRef } from "react";
import { lineRangeLabel } from "@/comments/label";
import { basename } from "@/screens/paths";
import type { ReviewComment } from "@/state/review";

interface CommentEditorProps {
  comment: ReviewComment;
  onChange: (text: string) => void;
}

export default function CommentEditor({ comment, onChange }: CommentEditorProps): JSX.Element {
  const field = useRef<HTMLTextAreaElement>(null);

  // The whole cycle is keyboard-only: the key that opened this editor has to
  // leave the caret inside it, with nothing else to press first.
  useEffect(() => {
    field.current?.focus();
  }, []);

  const range = lineRangeLabel(comment.from, comment.to);

  return (
    <div className="comment-editor">
      <p className="comment-editor-title">
        editor · {basename(comment.path)} · {range}
      </p>
      <textarea
        ref={field}
        className="comment-editor-field"
        aria-label={`Comentario en ${basename(comment.path)}, ${range}`}
        value={comment.text}
        onChange={(event) => onChange(event.target.value)}
      />
      <p className="panel-help">Ctrl+Enter save · Esc cancel</p>
    </div>
  );
}

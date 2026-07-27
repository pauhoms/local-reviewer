import type { Token } from "@/highlight/shiki";

interface TokenTextProps {
  /** `null` when the file has no grammar, or the blob no longer says the same. */
  tokens: Token[] | null;
  text: string;
}

export default function TokenText({ tokens, text }: TokenTextProps): JSX.Element {
  if (!tokens) return <>{text}</>;
  return (
    <>
      {tokens.map((token, position) => (
        <span key={position} style={token.color ? { color: token.color } : undefined}>
          {token.content}
        </span>
      ))}
    </>
  );
}

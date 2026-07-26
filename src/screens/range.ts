import type { CommitInfo } from "@/ipc/types";

export interface CommitRange {
  from: string;
  to: string;
}

/**
 * The user marks two commits in whatever order they read them; git wants the
 * older end first. `commits` arrives newest first, so the older hash is the one
 * further down the list.
 */
export function orderedRange(
  commits: CommitInfo[],
  first: string,
  second: string,
): CommitRange | null {
  const firstIndex = commits.findIndex((commit) => commit.hash === first);
  const secondIndex = commits.findIndex((commit) => commit.hash === second);
  if (firstIndex < 0 || secondIndex < 0 || firstIndex === secondIndex) return null;

  return firstIndex > secondIndex
    ? { from: first, to: second }
    : { from: second, to: first };
}

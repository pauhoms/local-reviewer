import type { CommitInfo } from "@/ipc/types";
import type { Loadable } from "./loadable";
import { SCOPE_MODES } from "./scope-label";

interface ScopePickerProps {
  repo: string | null;
  modeIndex: number;
  commits: Loadable<CommitInfo[]>;
  /** Set only while the commit list holds the cursor; the modes hold it otherwise. */
  commitCursor: number | null;
  marked: string[];
  active: boolean;
}

export default function ScopePicker({
  repo,
  modeIndex,
  commits,
  commitCursor,
  marked,
  active,
}: ScopePickerProps): JSX.Element {
  return (
    <section
      className="start-panel start-scope"
      aria-label="3 Review scope"
      aria-current={active}
      data-active={active}
      data-repo={repo ?? ""}
    >
      <h2>3 Review scope</h2>
      {repo === null ? (
        <p className="start-empty">Choose a repository from Recent or Browse.</p>
      ) : (
        <>
          <p className="start-path">{repo}</p>
          <ul role="listbox" aria-label="Scope" className="start-list">
            {SCOPE_MODES.map(({ mode, label }, index) => (
              <li key={mode} role="option" aria-selected={index === modeIndex}>
                {label}
              </li>
            ))}
          </ul>
          <h3>Commits</h3>
          {commits.status === "loading" ? (
            <p className="start-empty">Loading commits…</p>
          ) : commits.status === "failed" ? (
            <p className="start-empty">{commits.message}</p>
          ) : commits.data.length === 0 ? (
            <p className="start-empty">This repository has no commits yet.</p>
          ) : (
            <ul role="listbox" aria-label="Commits" className="start-list">
              {commits.data.map((commit, index) => (
                <li
                  key={commit.hash}
                  role="option"
                  aria-selected={index === commitCursor}
                  data-marked={marked.includes(commit.hash)}
                >
                  <span className="commit-hash">{commit.shortHash}</span>
                  <span className="commit-subject">{commit.subject}</span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}

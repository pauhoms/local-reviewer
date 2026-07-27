import type { Loadable } from "./loadable";

interface RecentReposProps {
  repos: Loadable<string[]>;
  cursor: number;
  active: boolean;
}

export default function RecentRepos({ repos, cursor, active }: RecentReposProps): JSX.Element {
  return (
    <section
      className="start-panel"
      aria-label="1 Recent"
      aria-current={active}
      data-active={active}
    >
      <h2>1 Recent</h2>
      {repos.status === "loading" ? (
        <p className="start-empty">Loading recent repositories…</p>
      ) : repos.status === "failed" ? (
        <p className="start-empty">{repos.message}</p>
      ) : repos.data.length === 0 ? (
        <p className="start-empty">No repositories reviewed yet.</p>
      ) : (
        <ul role="listbox" aria-label="Recent repositories" className="start-list">
          {repos.data.map((repo, index) => (
            <li key={repo} role="option" aria-selected={index === cursor}>
              <span className="start-path">{repo}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

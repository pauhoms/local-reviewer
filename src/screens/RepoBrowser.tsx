import type { DirEntryInfo } from "@/ipc/types";
import type { Loadable } from "./loadable";

interface RepoBrowserProps {
  path: string;
  entries: Loadable<DirEntryInfo[]>;
  cursor: number;
  active: boolean;
}

export default function RepoBrowser({
  path,
  entries,
  cursor,
  active,
}: RepoBrowserProps): JSX.Element {
  return (
    <section
      className="start-panel"
      aria-label="2 Navegar"
      aria-current={active}
      data-active={active}
      data-path={path}
    >
      <h2>2 Navegar</h2>
      <p className="start-path">{path}</p>
      {entries.status === "loading" ? (
        <p className="start-empty">Leyendo el directorio…</p>
      ) : entries.status === "failed" ? (
        <p className="start-empty">{entries.message}</p>
      ) : entries.data.length === 0 ? (
        <p className="start-empty">No hay directorios aquí.</p>
      ) : (
        <ul role="listbox" aria-label="Directorios" className="start-list">
          {entries.data.map((entry, index) => (
            <li
              key={entry.path}
              role="option"
              aria-selected={index === cursor}
              data-git-repo={entry.isGitRepo}
            >
              <span className="start-name">{entry.name}/</span>
              {entry.isGitRepo && <span className="badge">git</span>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

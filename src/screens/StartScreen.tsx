import { useCallback, useEffect, useRef, useState } from "react";
import { browseDir, listCommits, listRecents } from "@/ipc/client";
import { errorMessage } from "@/ipc/errors";
import type { CommitInfo, DirEntryInfo, Scope } from "@/ipc/types";
import { START_KEYMAPS } from "@/keys/keymap";
import type { Command, Mode, Panel } from "@/keys/types";
import { useKeyboard } from "@/keys/useKeyboard";
import RecentRepos from "./RecentRepos";
import RepoBrowser from "./RepoBrowser";
import ScopePicker from "./ScopePicker";
import type { Loadable } from "./loadable";
import { loadedItems } from "./loadable";
import { isUnder, parentPath } from "./paths";
import { orderedRange } from "./range";
import { SCOPE_MODES } from "./scope-label";
import type { ScopeMode } from "./scope-label";

const RECENTS_LIMIT = 10;
const COMMITS_LIMIT = 50;

const MODE_LABELS: Record<Mode, string> = {
  normal: "NORMAL",
  visual: "VISUAL",
  insert: "INSERT",
};

interface StartScreenProps {
  home: string;
  /** The repo a review came back from, already chosen when the screen opens. */
  initialRepo: string | null;
  onOpen: (scope: Scope) => void;
}

interface Listing {
  path: string;
  entries: Loadable<DirEntryInfo[]>;
}

export default function StartScreen({ home, initialRepo, onOpen }: StartScreenProps): JSX.Element {
  const [recents, setRecents] = useState<Loadable<string[]>>({ status: "loading" });
  const [listing, setListing] = useState<Listing>({ path: home, entries: { status: "loading" } });
  const [repo, setRepo] = useState<string | null>(initialRepo);
  const [commits, setCommits] = useState<Loadable<CommitInfo[]>>({ status: "loading" });
  const [inCommits, setInCommits] = useState(false);
  const [mode, setMode] = useState<ScopeMode>("worktree");
  const [marked, setMarked] = useState<string[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  // Its own slot, not the notice: the next listing to land would wipe it and
  // leave the picker looking idle while the diff it asked for is still coming.
  const [opening, setOpening] = useState(false);

  const recentRepos = loadedItems(recents);
  const entries = loadedItems(listing.entries);
  const commitList = loadedItems(commits);

  // Only the answer to the last request may land: walking fast through
  // directories would otherwise leave whichever listing was slowest on screen.
  const listingRequest = useRef(0);
  const commitsRequest = useRef(0);

  const openDir = useCallback((path: string): void => {
    const request = (listingRequest.current += 1);
    browseDir(path)
      .then((listed) => {
        if (listingRequest.current !== request) return;
        setListing({ path, entries: { status: "ready", data: listed } });
        setNotice(null);
      })
      .catch((error: unknown) => {
        if (listingRequest.current !== request) return;
        // A failed walk leaves the previous directory on screen, but the very
        // first one has nothing to fall back to and must say what happened.
        setListing((current) =>
          current.entries.status === "loading"
            ? { path, entries: { status: "failed", message: "No se pudo leer este directorio." } }
            : current,
        );
        setNotice(`No se pudo abrir ${path}: ${errorMessage(error)}`);
      });
  }, []);

  const chooseRepo = useCallback((path: string): void => {
    setRepo(path);
    setInCommits(false);
    setMarked([]);
    setNotice(null);
    setCommits({ status: "loading" });

    const request = (commitsRequest.current += 1);
    listCommits(path, COMMITS_LIMIT)
      .then((list) => {
        if (commitsRequest.current !== request) return;
        setCommits({ status: "ready", data: list });
        setNotice(null);
      })
      .catch((error: unknown) => {
        if (commitsRequest.current !== request) return;
        setCommits({ status: "failed", message: "No se pudieron leer los commits." });
        setNotice(`No se pudieron leer los commits de ${path}: ${errorMessage(error)}`);
      });
  }, []);

  useEffect(() => {
    listRecents(RECENTS_LIMIT)
      .then((list) => setRecents({ status: "ready", data: list }))
      .catch(() =>
        setRecents({
          status: "failed",
          message: "No se pudo leer la lista de repos recientes.",
        }),
      );
  }, []);

  useEffect(() => {
    if (home === "") {
      setListing({
        path: "",
        entries: { status: "failed", message: "No se pudo determinar tu directorio personal." },
      });
      setNotice("No se pudo determinar tu directorio personal: no hay dónde navegar.");
      return;
    }
    openDir(home);
  }, [home, openDir]);

  useEffect(() => {
    if (initialRepo !== null) chooseRepo(initialRepo);
  }, [initialRepo, chooseRepo]);

  function walkUp(): void {
    const parent = parentPath(listing.path);
    if (parent === null || !isUnder(parent, home)) return;
    openDir(parent);
  }

  function openReview(scope: Scope): void {
    setNotice(null);
    setOpening(true);
    onOpen(scope);
  }

  function confirmScope(index: number): void {
    if (repo === null) return;

    if (!inCommits) {
      const picked = SCOPE_MODES[index];
      if (!picked) return;
      if (picked.mode === "worktree") {
        openReview({ kind: "worktree", repo });
        return;
      }
      if (commits.status === "loading") {
        setNotice("Todavía estoy leyendo los commits de este repo.");
        return;
      }
      if (commits.status === "failed") {
        setNotice("No se pudieron leer los commits de este repo.");
        return;
      }
      if (commits.data.length === 0) {
        setNotice("Este repo todavía no tiene commits que revisar.");
        return;
      }
      setMode(picked.mode);
      setMarked([]);
      setInCommits(true);
      return;
    }

    const commit = commitList[index];
    if (!commit) return;
    if (mode === "commit") {
      openReview({ kind: "commit", repo, sha: commit.hash });
      return;
    }

    const [first] = marked;
    if (first === undefined) {
      setMarked([commit.hash]);
      return;
    }
    const range = orderedRange(commitList, first, commit.hash);
    // Marking the same commit twice unmarks it instead of reviewing nothing.
    if (range === null) {
      setMarked([]);
      return;
    }
    openReview({ kind: "range", repo, ...range });
  }

  function confirmAt(panel: Panel, index: number): void {
    if (panel === "tree") {
      const recent = recentRepos[index];
      if (recent !== undefined) chooseRepo(recent);
      return;
    }
    if (panel === "diff") {
      const entry = entries[index];
      if (!entry) return;
      if (entry.isGitRepo) chooseRepo(entry.path);
      else openDir(entry.path);
      return;
    }
    confirmScope(index);
  }

  function handleCommands(commands: Command[]): void {
    for (const command of commands) {
      switch (command.type) {
        case "Confirm":
          confirmAt(command.panel, command.index);
          break;
        case "Descend": {
          const entry = command.panel === "diff" ? entries[command.index] : undefined;
          if (entry) openDir(entry.path);
          break;
        }
        case "Ascend":
          if (command.panel === "diff") walkUp();
          break;
        case "Escape":
          setInCommits(false);
          setMarked([]);
          break;
        default:
          break;
      }
    }
  }

  const scopeItems = repo === null ? 0 : inCommits ? commitList.length : SCOPE_MODES.length;

  const state = useKeyboard(
    {
      tree: { itemCount: recentRepos.length, pageSize: recentRepos.length, listId: "recents" },
      diff: {
        itemCount: entries.length,
        pageSize: entries.length,
        listId: listing.path,
      },
      comments: {
        itemCount: scopeItems,
        pageSize: scopeItems,
        listId: `${repo ?? ""}#${inCommits ? "commits" : "modes"}`,
      },
    },
    handleCommands,
    START_KEYMAPS,
  );

  const modeIndex = inCommits
    ? SCOPE_MODES.findIndex((entry) => entry.mode === mode)
    : state.panels.comments.cursor;

  return (
    <div className="app">
      <header className="app-header">
        <h1>AI Code Reviewer</h1>
        <span className="mode-indicator" data-mode={state.mode} aria-live="polite">
          {MODE_LABELS[state.mode]}
        </span>
      </header>
      <div className="start-panels">
        <RecentRepos
          repos={recents}
          cursor={state.panels.tree.cursor}
          active={state.activePanel === "tree"}
        />
        <RepoBrowser
          path={listing.path}
          entries={listing.entries}
          cursor={state.panels.diff.cursor}
          active={state.activePanel === "diff"}
        />
        <ScopePicker
          repo={repo}
          modeIndex={modeIndex}
          commits={commits}
          commitCursor={inCommits ? state.panels.comments.cursor : null}
          marked={marked}
          active={state.activePanel === "comments"}
        />
      </div>
      {opening && (
        <p className="start-notice" role="status">
          Abriendo la revisión…
        </p>
      )}
      {notice !== null && (
        <p className="start-notice" role="status">
          {notice}
        </p>
      )}
      <footer className="start-help">
        j/k mover · l entrar · h subir · Enter elegir · Esc volver · 1/2/3 paneles
      </footer>
    </div>
  );
}

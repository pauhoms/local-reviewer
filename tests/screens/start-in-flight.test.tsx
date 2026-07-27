import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { CommitInfo, DirEntryInfo, FileDiff } from "@/ipc/types";
import { reviewStore } from "@/state/review";
import { sampleFiles } from "../helpers/fixtures";

vi.mock("@/ipc/client", () => import("../helpers/ipc-mock"));

import * as ipc from "../helpers/ipc-mock";
import App from "@/App";

const HOME = "/home/dev";
const REPO = "/home/dev/reviewv4";
const OTHER_REPO = "/home/dev/prx/iprox-server";

const COMMITS: CommitInfo[] = [
  {
    hash: "a1b2c3d000000000000000000000000000000001",
    shortHash: "a1b2c3d",
    subject: "feat: add fleet map",
    author: "Jane Doe",
    date: "2026-07-20T10:00:00+00:00",
  },
  {
    hash: "d4e5f6a000000000000000000000000000000002",
    shortHash: "d4e5f6a",
    subject: "fix: marker crash",
    author: "Jane Doe",
    date: "2026-07-19T10:00:00+00:00",
  },
];

const STALE_COMMITS: CommitInfo[] = [
  {
    hash: "0ldc0mm000000000000000000000000000000009",
    shortHash: "0ldc0mm",
    subject: "chore: from the repo left behind",
    author: "Jane Doe",
    date: "2026-07-01T10:00:00+00:00",
  },
];

const DIRS: Record<string, DirEntryInfo[]> = {
  [HOME]: [
    { name: "prx", path: "/home/dev/prx", isGitRepo: false },
    { name: "reviewv4", path: REPO, isGitRepo: true },
    { name: "notas", path: "/home/dev/notas", isGitRepo: false },
  ],
  "/home/dev/prx": [{ name: "iprox-server", path: OTHER_REPO, isGitRepo: true }],
  "/home/dev/notas": [],
};

const WORKTREE_FILES: FileDiff[] = [
  { path: "sin-commitear.txt", oldPath: null, status: "M", additions: 1, deletions: 0, hunks: [] },
];

const RECENTS = /Recientes/;
const BROWSER = /Navegar/;
const SCOPE = /¿Qué revisamos\?/;

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

function region(name: RegExp): HTMLElement {
  return screen.getByRole("region", { name });
}

function optionsIn(container: HTMLElement): HTMLElement[] {
  return within(container).getAllByRole("option");
}

function banner(): HTMLElement {
  return screen.getByRole("banner");
}

function commitList(): HTMLElement {
  return within(region(SCOPE)).getByRole("listbox", { name: /commits/i });
}

async function settle<T>(pending: Deferred<T>, value: T): Promise<void> {
  await act(async () => {
    pending.resolve(value);
    await pending.promise;
  });
}

beforeEach(() => {
  ipc.configureIpc({
    startup: { scope: null, home: HOME },
    recents: [REPO, OTHER_REPO],
    dirs: DIRS,
    commits: COMMITS,
    diff: sampleFiles,
  });
});

describe("answers that arrive out of order", () => {
  it("keeps the directory the user walked into when a slower listing lands later", async () => {
    const slow = deferred<DirEntryInfo[]>();
    const user = userEvent.setup();
    render(<App />);
    await waitFor(() => expect(optionsIn(region(BROWSER))).toHaveLength(3));

    ipc.browseDir.mockImplementationOnce(() => slow.promise);
    await user.keyboard("2");
    await user.keyboard("{Enter}");
    await user.keyboard("jj");
    await user.keyboard("{Enter}");
    await waitFor(() => expect(region(BROWSER).getAttribute("data-path")).toBe("/home/dev/notas"));

    await settle(slow, DIRS["/home/dev/prx"]);

    expect(region(BROWSER).getAttribute("data-path")).toBe("/home/dev/notas");
    expect(within(region(BROWSER)).queryByText(/iprox-server/)).toBeNull();
  });

  it("keeps the commits of the repo chosen last when a slower list lands later", async () => {
    const slow = deferred<CommitInfo[]>();
    const user = userEvent.setup();
    render(<App />);
    await waitFor(() => expect(optionsIn(region(RECENTS))).toHaveLength(2));

    ipc.listCommits.mockImplementationOnce(() => slow.promise);
    await user.keyboard("1");
    await user.keyboard("{Enter}");
    await user.keyboard("j");
    await user.keyboard("{Enter}");
    await waitFor(() => expect(region(SCOPE).getAttribute("data-repo")).toBe(OTHER_REPO));
    await waitFor(() => expect(region(SCOPE)).toHaveTextContent("feat: add fleet map"));

    await settle(slow, STALE_COMMITS);

    expect(region(SCOPE).getAttribute("data-repo")).toBe(OTHER_REPO);
    expect(region(SCOPE)).toHaveTextContent("feat: add fleet map");
    expect(region(SCOPE)).not.toHaveTextContent("from the repo left behind");
  });

  it("keeps the scope the user confirmed last when a slower diff lands later", async () => {
    const slow = deferred<FileDiff[]>();
    const user = userEvent.setup();
    render(<App />);
    await waitFor(() => expect(optionsIn(region(RECENTS))).toHaveLength(2));

    await user.keyboard("1");
    await user.keyboard("{Enter}");
    await waitFor(() => expect(region(SCOPE).getAttribute("data-repo")).toBe(REPO));

    ipc.getDiff.mockImplementationOnce(() => slow.promise);
    await user.keyboard("3");
    await user.keyboard("{Enter}");

    await user.keyboard("j");
    await user.keyboard("{Enter}");
    await waitFor(() => expect(optionsIn(commitList())).toHaveLength(2));
    await user.keyboard("{Enter}");
    await waitFor(() => expect(banner()).toHaveTextContent("a1b2c3d"));

    await settle(slow, WORKTREE_FILES);

    expect(banner()).toHaveTextContent("a1b2c3d");
    expect(banner()).not.toHaveTextContent("worktree");
    expect(reviewStore.getState().files).toEqual(sampleFiles);
  });

  it("remembers only the repo whose review actually opened", async () => {
    const slow = deferred<FileDiff[]>();
    const user = userEvent.setup();
    render(<App />);
    await waitFor(() => expect(optionsIn(region(RECENTS))).toHaveLength(2));

    ipc.getDiff.mockImplementationOnce(() => slow.promise);
    await user.keyboard("1");
    await user.keyboard("{Enter}");
    await waitFor(() => expect(region(SCOPE).getAttribute("data-repo")).toBe(REPO));
    await user.keyboard("3");
    await user.keyboard("{Enter}");

    await user.keyboard("1");
    await user.keyboard("j");
    await user.keyboard("{Enter}");
    await waitFor(() => expect(region(SCOPE).getAttribute("data-repo")).toBe(OTHER_REPO));
    await user.keyboard("3");
    await user.keyboard("{Enter}");
    await screen.findByRole("region", { name: /2 DIFF/ });

    await settle(slow, WORKTREE_FILES);

    expect(ipc.recordRecent).toHaveBeenCalledWith(OTHER_REPO);
    expect(ipc.recordRecent).not.toHaveBeenCalledWith(REPO);
  });
});

describe("a screen that is still loading does not claim to be empty", () => {
  it("does not call a directory empty while its listing is in flight", async () => {
    const slow = deferred<DirEntryInfo[]>();
    ipc.browseDir.mockImplementationOnce(() => slow.promise);

    render(<App />);
    await screen.findByRole("region", { name: BROWSER });

    expect(within(region(BROWSER)).queryByText(/No hay directorios aquí/i)).toBeNull();
    expect(within(region(BROWSER)).getByText(/Leyendo el directorio/i)).toBeInTheDocument();

    await settle(slow, DIRS[HOME]);

    expect(optionsIn(region(BROWSER))).toHaveLength(3);
    expect(within(region(BROWSER)).queryByText(/Leyendo el directorio/i)).toBeNull();
  });

  it("stops claiming to read a directory whose listing failed", async () => {
    ipc.browseDir.mockRejectedValueOnce(new Error("permiso denegado"));

    render(<App />);
    await screen.findByRole("region", { name: BROWSER });

    expect(await screen.findByRole("status")).toHaveTextContent(/permiso denegado/);
    expect(within(region(BROWSER)).queryByText(/Leyendo el directorio/i)).toBeNull();
  });

  it("does not claim to be reading anything when there is nowhere to navigate", async () => {
    ipc.configureIpc({ startup: { scope: null, home: "" }, recents: [], dirs: DIRS });

    render(<App />);
    await screen.findByRole("region", { name: BROWSER });
    // The region exists before the effect settles it, so under load the panel
    // is caught mid-render still saying it reads. Wait for the settled state.
    await within(region(BROWSER)).findByText(/no se pudo determinar tu directorio personal/i);

    expect(within(region(BROWSER)).queryByText(/Leyendo el directorio/i)).toBeNull();
    expect(ipc.browseDir).not.toHaveBeenCalled();
  });

  it("stops claiming to read the commits of a repo whose log failed", async () => {
    ipc.listCommits.mockRejectedValueOnce(new Error("no es un repositorio git"));
    const user = userEvent.setup();
    render(<App />);
    await waitFor(() => expect(optionsIn(region(RECENTS))).toHaveLength(2));

    await user.keyboard("1");
    await user.keyboard("{Enter}");

    expect(await screen.findByRole("status")).toHaveTextContent(/no es un repositorio git/);
    expect(within(region(SCOPE)).queryByText(/Leyendo los commits/i)).toBeNull();
  });

  it("does not claim a repo has no commits while its list is in flight", async () => {
    const slow = deferred<CommitInfo[]>();
    const user = userEvent.setup();
    render(<App />);
    await waitFor(() => expect(optionsIn(region(RECENTS))).toHaveLength(2));

    ipc.listCommits.mockImplementationOnce(() => slow.promise);
    await user.keyboard("1");
    await user.keyboard("{Enter}");
    await waitFor(() => expect(region(SCOPE).getAttribute("data-repo")).toBe(REPO));

    await user.keyboard("3");
    await user.keyboard("j");
    await user.keyboard("{Enter}");

    expect(screen.queryByText(/no tiene commits/i)).toBeNull();
    expect(within(region(SCOPE)).queryByText(/Este repo todavía no tiene commits/i)).toBeNull();
    expect(await screen.findByRole("status")).toHaveTextContent(
      /leyendo los commits de este repo/i,
    );

    await settle(slow, COMMITS);

    expect(screen.queryByText(/no tiene commits/i)).toBeNull();
    expect(screen.queryByText(/leyendo los commits de este repo/i)).toBeNull();
    expect(region(SCOPE)).toHaveTextContent("feat: add fleet map");
  });
});

describe("while a review is being opened", () => {
  it("says the review is loading instead of leaving the picker looking idle", async () => {
    const slow = deferred<FileDiff[]>();
    const user = userEvent.setup();
    render(<App />);
    await waitFor(() => expect(optionsIn(region(RECENTS))).toHaveLength(2));

    await user.keyboard("1");
    await user.keyboard("{Enter}");
    await waitFor(() => expect(region(SCOPE).getAttribute("data-repo")).toBe(REPO));

    ipc.getDiff.mockImplementationOnce(() => slow.promise);
    await user.keyboard("3");
    await user.keyboard("{Enter}");

    expect(await screen.findByRole("status")).toHaveTextContent(/abriendo la revisión/i);

    await settle(slow, sampleFiles);

    expect(await screen.findByRole("region", { name: /2 DIFF/ })).toBeInTheDocument();
  });

  it("still says so after the user keeps walking the picker", async () => {
    const slow = deferred<FileDiff[]>();
    const user = userEvent.setup();
    render(<App />);
    await waitFor(() => expect(optionsIn(region(RECENTS))).toHaveLength(2));

    await user.keyboard("1");
    await user.keyboard("{Enter}");
    await waitFor(() => expect(region(SCOPE).getAttribute("data-repo")).toBe(REPO));

    ipc.getDiff.mockImplementationOnce(() => slow.promise);
    await user.keyboard("3");
    await user.keyboard("{Enter}");
    expect(await screen.findByText(/abriendo la revisión/i)).toBeInTheDocument();

    await user.keyboard("2");
    await user.keyboard("jj");
    await user.keyboard("{Enter}");
    await waitFor(() => expect(region(BROWSER).getAttribute("data-path")).toBe("/home/dev/notas"));

    expect(screen.getByText(/abriendo la revisión/i)).toBeInTheDocument();

    await settle(slow, sampleFiles);

    expect(await screen.findByRole("region", { name: /2 DIFF/ })).toBeInTheDocument();
  });
});

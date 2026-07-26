import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { CommitInfo, DirEntryInfo } from "@/ipc/types";
import { sampleFiles } from "../helpers/fixtures";

vi.mock("@/ipc/client", () => import("../helpers/ipc-mock"));

import * as ipc from "../helpers/ipc-mock";
import App from "@/App";

const HOME = "/home/dev";
const REPO = "/home/dev/prx/iprox-server";
const OTHER_REPO = "/home/dev/reviewv4";

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
  {
    hash: "789abc1000000000000000000000000000000003",
    shortHash: "789abc1",
    subject: "refactor: MapPanel",
    author: "Jane Doe",
    date: "2026-07-18T10:00:00+00:00",
  },
];

const DIRS: Record<string, DirEntryInfo[]> = {
  [HOME]: [
    { name: "prx", path: "/home/dev/prx", isGitRepo: false },
    { name: "reviewv4", path: OTHER_REPO, isGitRepo: true },
    { name: "notas", path: "/home/dev/notas", isGitRepo: false },
  ],
  "/home/dev/prx": [{ name: "iprox-server", path: REPO, isGitRepo: true }],
  [REPO]: [{ name: "src", path: `${REPO}/src`, isGitRepo: false }],
  [OTHER_REPO]: [{ name: "src", path: `${OTHER_REPO}/src`, isGitRepo: false }],
  "/home/dev/notas": [],
};

const RECENTS = /Recientes/;
const BROWSER = /Navegar/;
const SCOPE = /¿Qué revisamos\?/;
const TREE_PANEL = /1 ÁRBOL/;
const DIFF_PANEL = /2 DIFF/;
const COMMENTS_PANEL = /3 COMENTARIOS/;

function region(name: RegExp): HTMLElement {
  return screen.getByRole("region", { name });
}

function optionsIn(container: HTMLElement): HTMLElement[] {
  return within(container).getAllByRole("option");
}

function textsIn(container: HTMLElement): string[] {
  return optionsIn(container).map((option) => option.textContent ?? "");
}

function cursorIn(container: HTMLElement): string {
  const option = optionsIn(container).find(
    (candidate) => candidate.getAttribute("aria-selected") === "true",
  );
  if (!option) throw new Error("no option carries the cursor (aria-selected)");
  return option.textContent ?? "";
}

function markedIn(container: HTMLElement): string[] {
  return optionsIn(container)
    .filter((option) => option.getAttribute("data-marked") === "true")
    .map((option) => option.textContent ?? "");
}

function activePanels(): string[] {
  return screen
    .getAllByRole("region")
    .filter((panel) => panel.getAttribute("data-active") === "true")
    .map((panel) => panel.getAttribute("aria-label") ?? "");
}

function modeList(): HTMLElement {
  return within(region(SCOPE)).getByRole("listbox", { name: /Alcance/i });
}

function commitList(): HTMLElement {
  return within(region(SCOPE)).getByRole("listbox", { name: /commits/i });
}

async function renderStartScreen(): Promise<ReturnType<typeof userEvent.setup>> {
  const user = userEvent.setup();
  render(<App />);
  await screen.findByRole("region", { name: RECENTS });
  return user;
}

/** Picks the first recent, which is the shortest way to a chosen repo. */
async function chooseFirstRecent(
  user: ReturnType<typeof userEvent.setup>,
  repo: string,
): Promise<void> {
  await waitFor(() => expect(optionsIn(region(RECENTS)).length).toBeGreaterThan(0));
  await user.keyboard("1");
  await user.keyboard("{Enter}");
  await waitFor(() => expect(region(SCOPE).getAttribute("data-repo")).toBe(repo));
}

beforeEach(() => {
  ipc.configureIpc();
});

describe("start screen", () => {
  it("TS-16: lists the recent repos and the directories under $HOME, flagging the git ones", async () => {
    ipc.configureIpc({
      startup: { scope: null, home: HOME },
      recents: [REPO, "/home/dev/fleetcommander"],
      dirs: DIRS,
      commits: COMMITS,
    });

    await renderStartScreen();

    await waitFor(() => expect(optionsIn(region(RECENTS))).toHaveLength(2));
    expect(textsIn(region(RECENTS))).toEqual([
      expect.stringContaining(REPO),
      expect.stringContaining("/home/dev/fleetcommander"),
    ]);

    const browser = await screen.findByRole("region", { name: BROWSER });
    await waitFor(() => expect(optionsIn(browser)).toHaveLength(3));
    expect(ipc.browseDir).toHaveBeenCalledWith(HOME);
    expect(browser.getAttribute("data-path")).toBe(HOME);
    expect(browser).toHaveTextContent(HOME);
    expect(textsIn(browser)).toEqual([
      expect.stringContaining("prx"),
      expect.stringContaining("reviewv4"),
      expect.stringContaining("notas"),
    ]);
    expect(optionsIn(browser).map((entry) => entry.getAttribute("data-git-repo"))).toEqual([
      "false",
      "true",
      "false",
    ]);
    expect(within(optionsIn(browser)[1]).getByText(/git/i)).toBeInTheDocument();
  });

  it("TS-16: 1/2/3 pick the panel and j/k move only that panel's cursor", async () => {
    ipc.configureIpc({
      startup: { scope: null, home: HOME },
      recents: [REPO, "/home/dev/fleetcommander"],
      dirs: DIRS,
      commits: COMMITS,
    });

    const user = await renderStartScreen();
    await waitFor(() => expect(optionsIn(region(BROWSER))).toHaveLength(3));
    await waitFor(() => expect(optionsIn(region(RECENTS))).toHaveLength(2));

    await user.keyboard("1");
    expect(activePanels()).toEqual([expect.stringContaining("Recientes")]);
    expect(cursorIn(region(RECENTS))).toContain(REPO);

    await user.keyboard("j");
    expect(cursorIn(region(RECENTS))).toContain("/home/dev/fleetcommander");
    expect(cursorIn(region(BROWSER))).toContain("prx");

    await user.keyboard("k");
    expect(cursorIn(region(RECENTS))).toContain(REPO);

    await user.keyboard("2");
    expect(activePanels()).toEqual([expect.stringContaining("Navegar")]);

    await user.keyboard("j");
    expect(cursorIn(region(BROWSER))).toContain("reviewv4");
    expect(cursorIn(region(RECENTS))).toContain(REPO);
  });

  it("TS-16: Enter and l walk into a directory, h walks back up and never above $HOME", async () => {
    ipc.configureIpc({
      startup: { scope: null, home: HOME },
      recents: [],
      dirs: DIRS,
      commits: COMMITS,
    });

    const user = await renderStartScreen();
    await waitFor(() => expect(optionsIn(region(BROWSER))).toHaveLength(3));

    await user.keyboard("2");
    await user.keyboard("{Enter}");

    await waitFor(() => expect(region(BROWSER).getAttribute("data-path")).toBe("/home/dev/prx"));
    expect(ipc.browseDir).toHaveBeenCalledWith("/home/dev/prx");
    expect(textsIn(region(BROWSER))).toEqual([expect.stringContaining("iprox-server")]);
    expect(cursorIn(region(BROWSER))).toContain("iprox-server");

    await user.keyboard("h");
    await waitFor(() => expect(region(BROWSER).getAttribute("data-path")).toBe(HOME));
    expect(optionsIn(region(BROWSER))).toHaveLength(3);

    await user.keyboard("l");
    await waitFor(() => expect(region(BROWSER).getAttribute("data-path")).toBe("/home/dev/prx"));

    await user.keyboard("h");
    await waitFor(() => expect(region(BROWSER).getAttribute("data-path")).toBe(HOME));
    await user.keyboard("h");
    expect(region(BROWSER).getAttribute("data-path")).toBe(HOME);
    expect(ipc.browseDir).not.toHaveBeenCalledWith("/home");
  });

  it("TS-16: Enter on a git repo hands it to the scope selector without opening a review", async () => {
    ipc.configureIpc({
      startup: { scope: null, home: HOME },
      recents: [],
      dirs: DIRS,
      commits: COMMITS,
    });

    const user = await renderStartScreen();
    await waitFor(() => expect(optionsIn(region(BROWSER))).toHaveLength(3));

    await user.keyboard("2");
    await user.keyboard("j");
    expect(cursorIn(region(BROWSER))).toContain("reviewv4");

    await user.keyboard("{Enter}");

    await waitFor(() => expect(region(SCOPE).getAttribute("data-repo")).toBe(OTHER_REPO));
    expect(ipc.listCommits).toHaveBeenCalledWith(OTHER_REPO, expect.any(Number));
    expect(region(BROWSER).getAttribute("data-path")).toBe(HOME);
    expect(ipc.getDiff).not.toHaveBeenCalled();
    expect(screen.queryByRole("region", { name: DIFF_PANEL })).toBeNull();
  });

  it("TS-15: opening a review records the repo in the recents", async () => {
    ipc.configureIpc({
      startup: { scope: null, home: HOME },
      recents: ["/home/dev/fleetcommander"],
      dirs: DIRS,
      commits: COMMITS,
      diff: sampleFiles,
    });

    const user = await renderStartScreen();
    await waitFor(() => expect(optionsIn(region(BROWSER))).toHaveLength(3));

    await user.keyboard("2");
    await user.keyboard("j");
    await user.keyboard("{Enter}");
    await waitFor(() => expect(region(SCOPE).getAttribute("data-repo")).toBe(OTHER_REPO));

    await user.keyboard("3");
    await user.keyboard("{Enter}");

    await waitFor(() => expect(ipc.recordRecent).toHaveBeenCalledWith(OTHER_REPO));
    // The dedup itself lives in the store and is covered in src-tauri/tests/recents.rs;
    // asserting the mock's own bookkeeping here would only test the double.
  });

  it("TS-17: confirming the worktree mode opens the three panels for it", async () => {
    ipc.configureIpc({
      startup: { scope: null, home: HOME },
      recents: [REPO],
      dirs: DIRS,
      commits: COMMITS,
      diff: sampleFiles,
    });

    const user = await renderStartScreen();
    await chooseFirstRecent(user, REPO);

    await user.keyboard("3");
    expect(textsIn(modeList())).toEqual([
      expect.stringContaining("Cambios sin commitear"),
      expect.stringContaining("Un commit"),
      expect.stringContaining("Rango de commits"),
    ]);
    expect(cursorIn(modeList())).toContain("Cambios sin commitear");

    await user.keyboard("{Enter}");

    await waitFor(() =>
      expect(ipc.getDiff).toHaveBeenCalledWith({ kind: "worktree", repo: REPO }),
    );
    await screen.findByRole("region", { name: DIFF_PANEL });
    expect(screen.getByRole("region", { name: TREE_PANEL })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: COMMENTS_PANEL })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: RECENTS })).toBeNull();
    expect(screen.getByRole("banner")).toHaveTextContent("worktree");
    expect(screen.getByRole("banner")).toHaveTextContent("iprox-server");
  });

  it("TS-17: confirming a single commit opens the three panels for that commit", async () => {
    ipc.configureIpc({
      startup: { scope: null, home: HOME },
      recents: [REPO],
      dirs: DIRS,
      commits: COMMITS,
      diff: sampleFiles,
    });

    const user = await renderStartScreen();
    await chooseFirstRecent(user, REPO);

    await user.keyboard("3");
    await user.keyboard("j");
    expect(cursorIn(modeList())).toContain("Un commit");

    await user.keyboard("{Enter}");
    await waitFor(() => expect(optionsIn(commitList())).toHaveLength(3));
    expect(textsIn(commitList())).toEqual([
      expect.stringContaining("a1b2c3d"),
      expect.stringContaining("d4e5f6a"),
      expect.stringContaining("789abc1"),
    ]);
    expect(commitList()).toHaveTextContent("feat: add fleet map");
    expect(cursorIn(commitList())).toContain("a1b2c3d");

    await user.keyboard("j");
    expect(cursorIn(commitList())).toContain("d4e5f6a");

    await user.keyboard("{Enter}");

    await waitFor(() =>
      expect(ipc.getDiff).toHaveBeenCalledWith({
        kind: "commit",
        repo: REPO,
        sha: COMMITS[1].hash,
      }),
    );
    await screen.findByRole("region", { name: DIFF_PANEL });
    expect(screen.getByRole("banner")).toHaveTextContent("d4e5f6a");
  });

  it("TS-17: marking two commits reviews the range from the older one to the newer one", async () => {
    ipc.configureIpc({
      startup: { scope: null, home: HOME },
      recents: [REPO],
      dirs: DIRS,
      commits: COMMITS,
      diff: sampleFiles,
    });

    const user = await renderStartScreen();
    await chooseFirstRecent(user, REPO);

    await user.keyboard("3");
    await user.keyboard("jj");
    expect(cursorIn(modeList())).toContain("Rango de commits");

    await user.keyboard("{Enter}");
    await waitFor(() => expect(optionsIn(commitList())).toHaveLength(3));
    expect(cursorIn(commitList())).toContain("a1b2c3d");

    await user.keyboard("{Enter}");
    expect(markedIn(commitList())).toEqual([expect.stringContaining("a1b2c3d")]);
    expect(ipc.getDiff).not.toHaveBeenCalled();
    expect(screen.queryByRole("region", { name: DIFF_PANEL })).toBeNull();

    await user.keyboard("jj");
    expect(cursorIn(commitList())).toContain("789abc1");

    await user.keyboard("{Enter}");

    await waitFor(() =>
      expect(ipc.getDiff).toHaveBeenCalledWith({
        kind: "range",
        repo: REPO,
        from: COMMITS[2].hash,
        to: COMMITS[0].hash,
      }),
    );
    await screen.findByRole("region", { name: DIFF_PANEL });
    const header = screen.getByRole("banner");
    expect(header).toHaveTextContent("789abc1");
    expect(header).toHaveTextContent("a1b2c3d");
  });

  it("TS-18: a worktree with no changes shows the informative empty state", async () => {
    ipc.configureIpc({
      startup: { scope: { kind: "worktree", repo: REPO }, home: HOME },
      recents: [REPO],
      dirs: DIRS,
      commits: COMMITS,
      diff: [],
    });

    render(<App />);

    expect(await screen.findByText(/No hay cambios sin commitear/i)).toBeInTheDocument();
    expect(screen.getByText(/working tree limpio/i)).toBeInTheDocument();
    const hint = screen.getByText(/elegir otro alcance/i);
    expect(hint).toHaveTextContent(/Enter/);
    expect(screen.queryByRole("region", { name: DIFF_PANEL })).toBeNull();
    expect(screen.queryByRole("region", { name: RECENTS })).toBeNull();
  });

  it("TS-18: Enter on the empty state goes back to the scope selector for the same repo", async () => {
    ipc.configureIpc({
      startup: { scope: { kind: "worktree", repo: REPO }, home: HOME },
      recents: [REPO],
      dirs: DIRS,
      commits: COMMITS,
      diff: (scope) => (scope.kind === "worktree" ? [] : sampleFiles),
    });

    const user = userEvent.setup();
    render(<App />);
    await screen.findByText(/No hay cambios sin commitear/i);

    await user.keyboard("{Enter}");

    const scope = await screen.findByRole("region", { name: SCOPE });
    expect(scope.getAttribute("data-repo")).toBe(REPO);
    await waitFor(() => expect(optionsIn(commitList())).toHaveLength(3));
    expect(screen.queryByText(/No hay cambios sin commitear/i)).toBeNull();

    await user.keyboard("3");
    expect(cursorIn(modeList())).toContain("Cambios sin commitear");
    await user.keyboard("j");
    await user.keyboard("{Enter}");
    expect(cursorIn(commitList())).toContain("a1b2c3d");
    await user.keyboard("{Enter}");

    await waitFor(() =>
      expect(ipc.getDiff).toHaveBeenCalledWith({
        kind: "commit",
        repo: REPO,
        sha: COMMITS[0].hash,
      }),
    );
    await screen.findByRole("region", { name: DIFF_PANEL });
  });
});

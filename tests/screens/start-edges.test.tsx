import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { CommitInfo, DirEntryInfo } from "@/ipc/types";
import { sampleFiles } from "../helpers/fixtures";

vi.mock("@/ipc/client", () => import("../helpers/ipc-mock"));

import * as ipc from "../helpers/ipc-mock";
import App from "@/App";

const HOME = "/home/dev";
const REPO = "/home/dev/local-reviewer";

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
    { name: "local-reviewer", path: REPO, isGitRepo: true },
    { name: "notas", path: "/home/dev/notas", isGitRepo: false },
  ],
  "/home/dev/notas": [],
};

const RECENTS = /Recent/;
const BROWSER = /Browse/;
const SCOPE = /Review scope/;
const DIFF_PANEL = /2 DIFF/;

function region(name: RegExp): HTMLElement {
  return screen.getByRole("region", { name });
}

function optionsIn(container: HTMLElement): HTMLElement[] {
  return within(container).getAllByRole("option");
}

function cursorIn(container: HTMLElement): string {
  const option = optionsIn(container).find(
    (candidate) => candidate.getAttribute("aria-selected") === "true",
  );
  if (!option) throw new Error("no option carries the cursor (aria-selected)");
  return option.textContent ?? "";
}

function modeList(): HTMLElement {
  return within(region(SCOPE)).getByRole("listbox", { name: /Scope/i });
}

function commitList(): HTMLElement {
  return within(region(SCOPE)).getByRole("listbox", { name: /commits/i });
}

function markedIn(container: HTMLElement): string[] {
  return optionsIn(container)
    .filter((option) => option.getAttribute("data-marked") === "true")
    .map((option) => option.textContent ?? "");
}

async function pickTheRepo(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await waitFor(() => expect(optionsIn(region(RECENTS)).length).toBeGreaterThan(0));
  await user.keyboard("1");
  await user.keyboard("{Enter}");
  await waitFor(() => expect(region(SCOPE).getAttribute("data-repo")).toBe(REPO));
}

beforeEach(() => {
  ipc.configureIpc();
});

describe("the start screen survives what the system throws at it", () => {
  it("explains a startup that could not resolve and still lets the user pick", async () => {
    ipc.configureIpc({ recents: [REPO], dirs: DIRS, commits: COMMITS });
    ipc.getStartup.mockRejectedValueOnce("could not determine your home directory");

    const user = userEvent.setup();
    render(<App />);

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/could not determine your home directory/i);

    await user.keyboard("{Enter}");

    expect(await screen.findByRole("region", { name: RECENTS })).toBeInTheDocument();
    await waitFor(() => expect(optionsIn(region(RECENTS))).toHaveLength(1));
    expect(await screen.findByRole("status")).toHaveTextContent(
      /could not determine your home directory/i,
    );
    expect(ipc.browseDir).not.toHaveBeenCalled();
  });

  it("reports a recent repo whose commits can no longer be read", async () => {
    ipc.configureIpc({
      startup: { scope: null, home: HOME },
      recents: [REPO],
      dirs: DIRS,
      commits: COMMITS,
    });
    ipc.listCommits.mockRejectedValueOnce(new Error("/home/dev/local-reviewer is not a Git repository"));

    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole("region", { name: RECENTS });
    await pickTheRepo(user);

    const notice = await screen.findByRole("status");
    expect(notice).toHaveTextContent(REPO);
    expect(notice).toHaveTextContent(/is not a Git repository/);

    await user.keyboard("2");
    expect(region(BROWSER).getAttribute("data-active")).toBe("true");
  });

  it("keeps the browser where it was when a directory cannot be listed", async () => {
    ipc.configureIpc({
      startup: { scope: null, home: HOME },
      recents: [],
      dirs: DIRS,
      commits: COMMITS,
    });

    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole("region", { name: BROWSER });
    await waitFor(() => expect(optionsIn(region(BROWSER))).toHaveLength(3));

    await user.keyboard("2");
    await user.keyboard("{Enter}");

    const notice = await screen.findByRole("status");
    expect(notice).toHaveTextContent("/home/dev/prx");
    expect(region(BROWSER).getAttribute("data-path")).toBe(HOME);
    expect(optionsIn(region(BROWSER))).toHaveLength(3);
  });

  it("says a directory is empty instead of showing a bare box", async () => {
    ipc.configureIpc({
      startup: { scope: null, home: HOME },
      recents: [],
      dirs: DIRS,
      commits: COMMITS,
    });

    const user = userEvent.setup();
    render(<App />);
    await waitFor(() => expect(optionsIn(region(BROWSER))).toHaveLength(3));

    await user.keyboard("2");
    await user.keyboard("jj");
    expect(cursorIn(region(BROWSER))).toContain("notas");

    await user.keyboard("{Enter}");
    await waitFor(() =>
      expect(region(BROWSER).getAttribute("data-path")).toBe("/home/dev/notas"),
    );
    expect(within(region(BROWSER)).getByText(/No directories here/i)).toBeInTheDocument();

    await user.keyboard("{Enter}");
    expect(region(BROWSER).getAttribute("data-path")).toBe("/home/dev/notas");

    await user.keyboard("h");
    await waitFor(() => expect(region(BROWSER).getAttribute("data-path")).toBe(HOME));
  });

  it("says so when a repo has no commits to choose from", async () => {
    ipc.configureIpc({
      startup: { scope: null, home: HOME },
      recents: [REPO],
      dirs: DIRS,
      commits: [],
    });

    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole("region", { name: RECENTS });
    await pickTheRepo(user);

    await user.keyboard("3");
    await user.keyboard("j");
    await user.keyboard("{Enter}");

    expect(await screen.findByRole("status")).toHaveTextContent(/has no commits/i);
    expect(cursorIn(modeList())).toContain("Single commit");
    expect(ipc.getDiff).not.toHaveBeenCalled();
  });

  it("opens the review even when the repo cannot be remembered", async () => {
    ipc.configureIpc({
      startup: { scope: null, home: HOME },
      recents: [REPO],
      dirs: DIRS,
      commits: COMMITS,
      diff: sampleFiles,
    });
    ipc.recordRecent.mockRejectedValueOnce(new Error("no se pudo guardar recents.json"));

    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole("region", { name: RECENTS });
    await pickTheRepo(user);

    await user.keyboard("3");
    await user.keyboard("{Enter}");

    expect(await screen.findByRole("region", { name: DIFF_PANEL })).toBeInTheDocument();
  });

  it("keeps saying the commits could not be read once another panel succeeds", async () => {
    ipc.configureIpc({
      startup: { scope: null, home: HOME },
      recents: [REPO],
      dirs: DIRS,
      commits: COMMITS,
    });
    ipc.listCommits.mockRejectedValueOnce(new Error("is not a Git repository"));

    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole("region", { name: RECENTS });
    await pickTheRepo(user);
    expect(await screen.findByRole("status")).toHaveTextContent(/is not a Git repository/);

    await user.keyboard("2");
    await user.keyboard("jj");
    await user.keyboard("{Enter}");
    await waitFor(() => expect(region(BROWSER).getAttribute("data-path")).toBe("/home/dev/notas"));

    expect(screen.queryByRole("status")).toBeNull();
    expect(
      within(region(SCOPE)).getByText(/Could not read the commits/i),
    ).toBeInTheDocument();
    expect(within(region(SCOPE)).queryByText(/has no commits/i)).toBeNull();
  });

  it("does not offer a commit list it never managed to read", async () => {
    ipc.configureIpc({
      startup: { scope: null, home: HOME },
      recents: [REPO],
      dirs: DIRS,
      commits: COMMITS,
    });
    ipc.listCommits.mockRejectedValueOnce(new Error("is not a Git repository"));

    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole("region", { name: RECENTS });
    await pickTheRepo(user);

    await user.keyboard("3");
    await user.keyboard("j");
    await user.keyboard("{Enter}");

    const notice = await screen.findByRole("status");
    expect(notice).toHaveTextContent(/could not read.*commits/i);
    expect(notice).not.toHaveTextContent(/has no commits/i);
    expect(cursorIn(modeList())).toContain("Single commit");
    expect(ipc.getDiff).not.toHaveBeenCalled();
  });

  it("keeps saying the directory could not be read once another panel succeeds", async () => {
    ipc.configureIpc({
      startup: { scope: null, home: HOME },
      recents: [REPO],
      dirs: DIRS,
      commits: COMMITS,
    });
    ipc.browseDir.mockRejectedValueOnce(new Error("permission denied"));

    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole("region", { name: RECENTS });
    expect(await screen.findByRole("status")).toHaveTextContent(/permission denied/);

    await pickTheRepo(user);

    expect(screen.queryByRole("status")).toBeNull();
    expect(
      within(region(BROWSER)).getByText(/Could not read this directory/i),
    ).toBeInTheDocument();
    expect(within(region(BROWSER)).queryByText(/No directories here/i)).toBeNull();
  });

  it("keeps saying the recents could not be read once another panel succeeds", async () => {
    ipc.configureIpc({
      startup: { scope: null, home: HOME },
      recents: [REPO],
      dirs: DIRS,
      commits: COMMITS,
    });
    ipc.listRecents.mockRejectedValueOnce(new Error("no se pudo leer recents.json"));

    render(<App />);
    await waitFor(() => expect(optionsIn(region(BROWSER))).toHaveLength(3));

    expect(
      within(region(RECENTS)).getByText(/Could not read the recent repository list/i),
    ).toBeInTheDocument();
    expect(within(region(RECENTS)).queryByText(/No repositories reviewed yet/i)).toBeNull();
  });

  it("does not remember a repo whose review never opened", async () => {
    ipc.configureIpc({
      startup: { scope: null, home: HOME },
      recents: [],
      dirs: DIRS,
      commits: COMMITS,
    });
    ipc.getDiff.mockRejectedValueOnce(new Error("git falló: bad object"));

    const user = userEvent.setup();
    render(<App />);
    await waitFor(() => expect(optionsIn(region(BROWSER))).toHaveLength(3));

    await user.keyboard("2");
    await user.keyboard("j");
    await user.keyboard("{Enter}");
    await waitFor(() => expect(region(SCOPE).getAttribute("data-repo")).toBe(REPO));

    await user.keyboard("3");
    await user.keyboard("{Enter}");
    expect(await screen.findByRole("alert")).toHaveTextContent(/bad object/);

    await user.keyboard("{Enter}");
    await screen.findByRole("region", { name: RECENTS });
    await waitFor(() =>
      expect(
        within(region(RECENTS)).getByText(/No repositories reviewed yet/i),
      ).toBeInTheDocument(),
    );
    expect(ipc.recordRecent).not.toHaveBeenCalled();
  });

  it("reports a diff that could not be read and offers the picker back", async () => {
    ipc.configureIpc({
      startup: { scope: null, home: HOME },
      recents: [REPO],
      dirs: DIRS,
      commits: COMMITS,
    });
    ipc.getDiff.mockRejectedValueOnce(new Error("git falló: bad object"));

    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole("region", { name: RECENTS });
    await pickTheRepo(user);

    await user.keyboard("3");
    await user.keyboard("{Enter}");

    expect(await screen.findByRole("alert")).toHaveTextContent(/bad object/);

    await user.keyboard("{Enter}");
    await waitFor(() => expect(region(SCOPE).getAttribute("data-repo")).toBe(REPO));
  });
});

describe("the scope picker walks back as well as forward", () => {
  beforeEach(() => {
    ipc.configureIpc({
      startup: { scope: null, home: HOME },
      recents: [REPO],
      dirs: DIRS,
      commits: COMMITS,
      diff: sampleFiles,
    });
  });

  it("leaves the commit list on Esc and starts the modes over from the top", async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole("region", { name: RECENTS });
    await pickTheRepo(user);

    await user.keyboard("3");
    await user.keyboard("j");
    await user.keyboard("{Enter}");
    expect(cursorIn(commitList())).toContain("a1b2c3d");

    await user.keyboard("{Escape}");
    expect(cursorIn(modeList())).toContain("Uncommitted changes");

    await user.keyboard("j");
    expect(cursorIn(modeList())).toContain("Single commit");
    expect(ipc.getDiff).not.toHaveBeenCalled();
  });

  it("unmarks a commit marked twice instead of reviewing an empty range", async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole("region", { name: RECENTS });
    await pickTheRepo(user);

    await user.keyboard("3");
    await user.keyboard("jj");
    await user.keyboard("{Enter}");
    await waitFor(() => expect(optionsIn(commitList())).toHaveLength(3));

    await user.keyboard("{Enter}");
    expect(markedIn(commitList())).toEqual([expect.stringContaining("a1b2c3d")]);

    await user.keyboard("{Enter}");
    expect(markedIn(commitList())).toEqual([]);
    expect(ipc.getDiff).not.toHaveBeenCalled();
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

import {
  browseDir,
  getDiff,
  getStartup,
  listCommits,
  listRecents,
  readBlob,
  recordRecent,
} from "@/ipc/client";
import type { CommitInfo, DirEntryInfo, FileDiff, StartupInfo } from "@/ipc/types";

describe("ipc client", () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it("getDiff invokes get_diff with the scope and returns its result", async () => {
    const files: FileDiff[] = [];
    invokeMock.mockResolvedValue(files);

    const result = await getDiff({ kind: "worktree", repo: "/repo" });

    expect(invokeMock).toHaveBeenCalledWith("get_diff", {
      scope: { kind: "worktree", repo: "/repo" },
    });
    expect(result).toBe(files);
  });

  it("listCommits invokes list_commits with repo and limit", async () => {
    const commits: CommitInfo[] = [];
    invokeMock.mockResolvedValue(commits);

    const result = await listCommits("/repo", 20);

    expect(invokeMock).toHaveBeenCalledWith("list_commits", {
      repo: "/repo",
      limit: 20,
    });
    expect(result).toBe(commits);
  });

  it("browseDir invokes browse_dir with the path", async () => {
    const entries: DirEntryInfo[] = [];
    invokeMock.mockResolvedValue(entries);

    const result = await browseDir("/home/user");

    expect(invokeMock).toHaveBeenCalledWith("browse_dir", { path: "/home/user" });
    expect(result).toBe(entries);
  });

  it("getStartup invokes get_startup and returns the scope and the home", async () => {
    const info: StartupInfo = { scope: { kind: "worktree", repo: "/repo" }, home: "/home/dev" };
    invokeMock.mockResolvedValue(info);

    const result = await getStartup();

    expect(invokeMock).toHaveBeenCalledWith("get_startup");
    expect(result).toBe(info);
  });

  it("listRecents invokes list_recents with the limit", async () => {
    invokeMock.mockResolvedValue(["/repo"]);

    const result = await listRecents(5);

    expect(invokeMock).toHaveBeenCalledWith("list_recents", { limit: 5 });
    expect(result).toEqual(["/repo"]);
  });

  it("recordRecent invokes record_recent with the repo", async () => {
    invokeMock.mockResolvedValue(undefined);

    await recordRecent("/repo");

    expect(invokeMock).toHaveBeenCalledWith("record_recent", { repo: "/repo" });
  });

  it("readBlob invokes read_blob with scope, path and side", async () => {
    invokeMock.mockResolvedValue("const a = 1;\n");

    const result = await readBlob(
      { kind: "commit", repo: "/repo", sha: "abc" },
      "src/a.ts",
      "new",
    );

    expect(invokeMock).toHaveBeenCalledWith("read_blob", {
      scope: { kind: "commit", repo: "/repo", sha: "abc" },
      path: "src/a.ts",
      side: "new",
    });
    expect(result).toBe("const a = 1;\n");
  });
});

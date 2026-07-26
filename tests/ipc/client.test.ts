import { beforeEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

import { browseDir, getDiff, listCommits, readBlob } from "@/ipc/client";
import type { CommitInfo, DirEntryInfo, FileDiff } from "@/ipc/types";

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

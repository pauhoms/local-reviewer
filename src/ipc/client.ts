import { invoke } from "@tauri-apps/api/core";
import type { CommitInfo, DirEntryInfo, FileDiff, Scope, Side } from "./types";

/** The only module that knows about `invoke`: the whole git layer goes through here. */
export function getDiff(scope: Scope): Promise<FileDiff[]> {
  return invoke<FileDiff[]>("get_diff", { scope });
}

export function listCommits(repo: string, limit: number): Promise<CommitInfo[]> {
  return invoke<CommitInfo[]>("list_commits", { repo, limit });
}

export function browseDir(path: string): Promise<DirEntryInfo[]> {
  return invoke<DirEntryInfo[]>("browse_dir", { path });
}

export function readBlob(scope: Scope, path: string, side: Side): Promise<string> {
  return invoke<string>("read_blob", { scope, path, side });
}

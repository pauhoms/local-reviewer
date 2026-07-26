import { invoke } from "@tauri-apps/api/core";
import type { CommitInfo, DirEntryInfo, FileDiff, Scope, Side, StartupInfo } from "./types";

/** The only module that knows about `invoke`: the whole git layer goes through here. */
export function getStartup(): Promise<StartupInfo> {
  return invoke<StartupInfo>("get_startup");
}

export function listRecents(limit: number): Promise<string[]> {
  return invoke<string[]>("list_recents", { limit });
}

export function recordRecent(repo: string): Promise<void> {
  return invoke<void>("record_recent", { repo });
}

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

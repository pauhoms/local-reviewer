import { vi } from "vitest";
import type * as Client from "@/ipc/client";
import type {
  CommitInfo,
  DirEntryInfo,
  FileDiff,
  Review,
  Scope,
  Side,
  StartupInfo,
} from "@/ipc/types";

export interface IpcFixture {
  startup: StartupInfo;
  recents: string[];
  /** Directory listings keyed by absolute path; anything else is an error. */
  dirs: Record<string, DirEntryInfo[]>;
  /** Newest first, the way `list_commits` answers. */
  commits: CommitInfo[];
  diff: FileDiff[] | ((scope: Scope) => FileDiff[]);
  blobs: Record<string, string>;
  /** Reviews already on disk, one per scope, the way `.state/` holds them. */
  reviews: Review[];
}

function defaults(): IpcFixture {
  return {
    startup: { scope: null, home: "/home/dev" },
    recents: [],
    dirs: {},
    commits: [],
    diff: [],
    blobs: {},
    reviews: [],
  };
}

let fixture: IpcFixture = defaults();

export const getStartup = vi.fn((): Promise<StartupInfo> => Promise.resolve(fixture.startup));

export const listRecents = vi.fn(
  (limit: number): Promise<string[]> => Promise.resolve(fixture.recents.slice(0, limit)),
);

/** Mirrors the backend: no duplicates, most recent first. */
export const recordRecent = vi.fn((repo: string): Promise<void> => {
  fixture.recents = [repo, ...fixture.recents.filter((known) => known !== repo)];
  return Promise.resolve();
});

export const browseDir = vi.fn((path: string): Promise<DirEntryInfo[]> => {
  const entries = fixture.dirs[path];
  if (!entries) {
    return Promise.reject(new Error(`browse_dir fuera del fixture: ${path}`));
  }
  return Promise.resolve(entries);
});

export const listCommits = vi.fn(
  (_repo: string, limit: number): Promise<CommitInfo[]> =>
    Promise.resolve(fixture.commits.slice(0, limit)),
);

export const getDiff = vi.fn((scope: Scope): Promise<FileDiff[]> => {
  const { diff } = fixture;
  return Promise.resolve(typeof diff === "function" ? diff(scope) : diff);
});

export const readBlob = vi.fn(
  (_scope: Scope, path: string, side: Side): Promise<string> =>
    Promise.resolve(fixture.blobs[`${side}:${path}`] ?? ""),
);

/** The state file is one per scope, so the scope is the key of the fixture. */
function sameScope(one: Scope, other: Scope): boolean {
  return JSON.stringify(one) === JSON.stringify(other);
}

export const loadReview = vi.fn(
  (scope: Scope): Promise<Review | null> =>
    Promise.resolve(fixture.reviews.find((review) => sameScope(review.scope, scope)) ?? null),
);

export const saveReview = vi.fn((review: Review): Promise<void> => {
  fixture.reviews = [
    ...fixture.reviews.filter((known) => !sameScope(known.scope, review.scope)),
    review,
  ];
  return Promise.resolve();
});

const MOCKS = [
  getStartup,
  listRecents,
  recordRecent,
  browseDir,
  listCommits,
  getDiff,
  readBlob,
  loadReview,
  saveReview,
];

/** Resets every call log and replaces the fixture; call it before each render. */
export function configureIpc(patch: Partial<IpcFixture> = {}): void {
  fixture = { ...defaults(), ...patch };
  for (const mock of MOCKS) mock.mockClear();
}

export function recentsInFixture(): string[] {
  return [...fixture.recents];
}

/** What `.state/` holds right now, after whatever the app has autosaved. */
export function reviewsInFixture(): Review[] {
  return [...fixture.reviews];
}

/** Fails the typecheck if this mock ever drifts from the real IPC client. */
export const __clientContract: typeof Client = {
  getStartup,
  listRecents,
  recordRecent,
  browseDir,
  listCommits,
  getDiff,
  readBlob,
  loadReview,
  saveReview,
};

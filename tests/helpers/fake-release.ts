import fs from "node:fs";
import path from "node:path";
import { DEPLOY_DIR } from "./shell";

const STUB_BINARY = `#!/bin/sh
echo 'reviewer [<commit>|<a>..<b>]'
`;

/**
 * A throwaway copy of the repo with a stub where the release binary goes, so a
 * real installation can be exercised without a `npm run tauri build` behind it.
 * The stub is 0700, the way a build under a tight umask would leave it.
 */
export function fakeRelease(root: string, withBinary = true): string {
  const repo = path.join(root, "repo");
  fs.cpSync(DEPLOY_DIR, path.join(repo, "deploy"), { recursive: true });
  for (const script of ["install.sh", "uninstall.sh"]) {
    const file = path.join(repo, "deploy", script);
    if (fs.existsSync(file)) fs.chmodSync(file, 0o755);
  }
  const release = path.join(repo, "src-tauri", "target", "release");
  fs.mkdirSync(release, { recursive: true });
  if (withBinary) {
    fs.writeFileSync(path.join(release, "local-reviewer"), STUB_BINARY, { mode: 0o700 });
  }
  const icons = path.join(repo, "src-tauri", "icons");
  fs.mkdirSync(icons, { recursive: true });
  fs.writeFileSync(path.join(icons, "128x128.png"), "not really a png\n");
  return repo;
}

function trimTrailingSlash(path: string): string {
  return path.length > 1 ? path.replace(/\/+$/, "") : path;
}

export function basename(path: string): string {
  const trimmed = trimTrailingSlash(path);
  const cut = trimmed.lastIndexOf("/");
  if (cut < 0) return trimmed;
  return trimmed.slice(cut + 1) || "/";
}

export function parentPath(path: string): string | null {
  const trimmed = trimTrailingSlash(path);
  const cut = trimmed.lastIndexOf("/");
  if (trimmed === "" || trimmed === "/" || cut < 0) return null;
  return cut === 0 ? "/" : trimmed.slice(0, cut);
}

export function isUnder(path: string, root: string): boolean {
  const base = trimTrailingSlash(root);
  const target = trimTrailingSlash(path);
  return target === base || target.startsWith(base === "/" ? "/" : `${base}/`);
}

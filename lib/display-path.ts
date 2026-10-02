/**
 * Display-only path shortening for the settings panels. Nothing reads these
 * strings back: authorization and API calls always use the full path.
 */

/** A path with a macOS or Linux home folder shown as `~`. */
export function shortenPath(path: string): string {
  return path.replace(/^\/(?:Users|home)\/[^/]+/, "~");
}

/**
 * A path inside `root` as `./relative`, anything else as `shortenPath()`.
 * Only a whole leading folder counts, so `/repo-other/x` is not inside `/repo`.
 */
export function displayPathWithin(path: string, root: string): string {
  const base = root.replace(/[/\\]+$/, "");
  if (base && (path === base || path.startsWith(`${base}/`) || path.startsWith(`${base}\\`))) {
    return `./${path.slice(base.length).replace(/^[/\\]/, "")}`;
  }
  return shortenPath(path);
}

/**
 * Pure archive naming helpers, safe to import from client components.
 * The server-side spawner lives in lib/file-archives.ts.
 */

const DOUBLE_EXT_RE = /\.(tar\.gz|tgz|tar\.bz2|tbz2|tar\.xz|txz|tar\.zst|tzst)$/;
const SINGLE_EXT_RE = /\.(zip|tar)$/;

export function isArchivePath(name: string): boolean {
  const lower = name.toLowerCase();
  return DOUBLE_EXT_RE.test(lower) || SINGLE_EXT_RE.test(lower);
}

/** Directory name an archive extracts into by default. */
export function archiveStem(name: string): string {
  const double = DOUBLE_EXT_RE.exec(name.toLowerCase());
  if (double) {
    const stem = name.slice(0, -double[0].length);
    if (stem) return stem;
  }
  const single = SINGLE_EXT_RE.exec(name.toLowerCase());
  if (single) {
    const stem = name.slice(0, -single[0].length);
    if (stem) return stem;
  }
  return `${name}_extracted`;
}

export function buildExtractArgs(archive: string, destDir: string): string[] {
  return ["-xf", archive, "-C", destDir];
}

/** Build a zip containing exactly one top-level entry (the target's name). */
export function buildZipArgs(destZip: string, parentDir: string, entryName: string): string[] {
  return ["--format", "zip", "-cf", destZip, "-C", parentDir, "--", entryName];
}

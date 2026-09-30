import fs from "fs";
import os from "os";
import path from "path";
import { isExistingPathWithinRoots, isPathWithinRoots, resolveRealRoots } from "./path-security";
import { samePath } from "./paths";

/**
 * The canonical target of a directory link (a symlink, or a junction on
 * Windows) that resolves outside the roots, or null when the entry is
 * browsable as it is. `realRoots` are the roots after resolving links.
 */
export function getOutsideLinkTarget(linkPath: string, realRoots: Set<string>): string | null {
  let target: string;
  try {
    target = fs.realpathSync(linkPath);
  } catch {
    return null;
  }
  return isPathWithinRoots(target, realRoots) ? null : target;
}

/**
 * Whether allowing `target` would also open the project or the home folder, as
 * a link to `/`, `~` or a parent of the project would. Such a link can arrive
 * with a cloned repository, so the explorer confirms before allowing it.
 */
function enclosesProjectOrHome(target: string, realRoots: Set<string>): boolean {
  const enclosed = [...realRoots];
  try {
    enclosed.push(fs.realpathSync(os.homedir()));
  } catch {
    // No resolvable home folder to protect.
  }
  const targetRoot = new Set([target]);
  return enclosed.some((candidate) => isPathWithinRoots(candidate, targetRoot));
}

/**
 * Add `outsideLinkTarget` to the listed directories that lead outside the
 * roots. The file routes authorize the resolved path, so such a link is listed
 * but everything beneath it is refused until the operator allows its target
 * (#748). The listed directory was itself authorized after resolving links, so
 * only an entry that is a directory through stat alone (a link, a junction, or
 * an entry on a filesystem without type information) can lead outside.
 */
export function withOutsideLinkTargets<T extends { name: string; isDir: boolean }>(
  directory: string,
  entries: T[],
  dirents: Pick<fs.Dirent, "name" | "isDirectory">[],
  roots: Set<string>,
): Array<T & { outsideLinkTarget?: string; outsideLinkEncloses?: true }> {
  const statDirectories = new Set(dirents.filter((d) => !d.isDirectory()).map((d) => d.name));
  let realRoots: Set<string> | undefined;
  return entries.map((entry) => {
    if (!entry.isDir || !statDirectories.has(entry.name)) return entry;
    realRoots ??= resolveRealRoots(roots);
    const outsideLinkTarget = getOutsideLinkTarget(path.join(directory, entry.name), realRoots);
    if (!outsideLinkTarget) return entry;
    return enclosesProjectOrHome(outsideLinkTarget, realRoots)
      ? { ...entry, outsideLinkTarget, outsideLinkEncloses: true as const }
      : { ...entry, outsideLinkTarget };
  });
}

export type LinkedDirectoryApproval =
  | { ok: true; target: string; alreadyAllowed: boolean }
  | { ok: false; status: 400 | 403 | 404 | 409; error: string };

/**
 * Validate the operator's request to browse the target of a directory link.
 *
 * Repository content must never widen the allowed roots on its own, so this is
 * only reached from an explicit click, and it grants no more than
 * `/api/cwd/validate` already grants for any directory. The link itself must
 * sit in a directory that is inside the roots after resolving links: a link
 * reached through another link that was never allowed does not qualify. The
 * target must still be the one the listing showed the operator.
 */
export function checkLinkedDirectoryApproval(
  requestedPath: string,
  expectedTarget: string,
  roots: Set<string>,
): LinkedDirectoryApproval {
  // Collapse `..` first so the lexical check and the filesystem calls agree:
  // the filesystem resolves `root/link/..` from the link's target instead.
  const linkPath = path.resolve(requestedPath);
  if (
    !isPathWithinRoots(linkPath, roots)
    || !isExistingPathWithinRoots(path.dirname(linkPath), roots)
  ) {
    return { ok: false, status: 403, error: "Access denied" };
  }

  let linkStat: fs.Stats;
  try {
    linkStat = fs.lstatSync(linkPath);
  } catch {
    return { ok: false, status: 404, error: "Not found" };
  }
  // lstat reports Windows junctions as symbolic links too.
  if (!linkStat.isSymbolicLink()) {
    return { ok: false, status: 400, error: "Not a linked directory" };
  }

  let target: string;
  try {
    target = fs.realpathSync(linkPath);
    if (!fs.statSync(target).isDirectory()) {
      return { ok: false, status: 400, error: "Not a linked directory" };
    }
  } catch {
    return { ok: false, status: 404, error: "Link target not found" };
  }
  // The link may have been pointed elsewhere since it was listed.
  if (!samePath(target, expectedTarget)) {
    return { ok: false, status: 409, error: "Link target changed; refresh the file list" };
  }
  return {
    ok: true,
    target,
    alreadyAllowed: isPathWithinRoots(target, resolveRealRoots(roots)),
  };
}

/**
 * Default-directory shortcut rules (pi#18).
 *
 * The sidebar dropdown offers a "use default directory" shortcut
 * (POST /api/default-cwd → ~/pi-cwd-<YYYYMMDD>). Two affordance rules live
 * here as pure functions so they are trivially unit-testable without React:
 *
 * 1. Visibility — when the user has pinned projects and the default
 *    directory is NOT one of them, the shortcut would add a second,
 *    divergent entry point to the same explorer, so it is hidden. No pins
 *    (or a default directory that is itself pinned) keeps it visible. While
 *    the default directory is still unknown (fetch in flight) the button
 *    keeps its historical visible state rather than flashing.
 *
 * 2. Synthetic project fallback — clicking the shortcut must always move
 *    the explorer's trailing section, even when the default directory has
 *    no sessions and no validated identity. The fallback synthesizes a
 *    project entry from the bare directory string (root = key = cwd), the
 *    same shape projectFor() produces for unknown paths.
 *
 * Path comparison is deliberately loose (browser-side, no node:path): case
 * folded and separator normalized, because pinned display roots come from
 * localStorage/session data while the default directory comes from the
 * server, and the two may differ in casing or slash style.
 */

export interface PinnedProjectLike {
  key: string;
  root: string;
}

export interface ProjectSelectionLike {
  root: string;
  key: string;
}

function normalizeExplorerPath(path: string): string {
  return path.trim().replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
}

/** Loose client-side path equality (case-insensitive, separator-normalized). */
export function isSameExplorerPath(a: string, b: string): boolean {
  return normalizeExplorerPath(a) === normalizeExplorerPath(b);
}

/**
 * Whether the "use default directory" shortcut should render.
 *
 * - No pinned projects → always visible (nothing to diverge from).
 * - Default directory unknown (null/empty) → visible: no evidence it
 *   diverges, and the value arrives right after mount.
 * - Pinned projects exist → visible only when one of them IS the default
 *   directory (compared by display root, loosely).
 */
export function shouldShowDefaultCwdShortcut(
  pinned: readonly PinnedProjectLike[],
  defaultCwd: string | null,
): boolean {
  if (defaultCwd == null || defaultCwd === "") return true;
  if (pinned.length === 0) return true;
  return pinned.some((project) => isSameExplorerPath(project.root, defaultCwd));
}

/**
 * Fallback explorer-selection entry for a directory with no project
 * identity: root and key both degrade to the directory string, matching
 * the synthetic selection projectFor() builds for unknown paths.
 */
export function syntheticProjectFor(cwd: string): ProjectSelectionLike {
  return { root: cwd, key: cwd };
}

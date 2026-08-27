/**
 * Path projection helpers shared by the explorer rows: a path relative to
 * the session cwd (for the @-reference button and "copy relative path").
 * The fs-tree joins with '/' even on Windows, so both separators normalize
 * to '/' before comparison.
 *
 * This module is dependency-free (no node:path in the client bundle): the
 * host is the authority for path semantics, so this mirror deliberately
 * accepts a SUPERSET of absolute forms — anything a Windows host would emit
 * (drive letters, UNC) plus POSIX roots. A form the host would reject
 * (e.g. a backslash UNC path on a POSIX host) passes through here and then
 * fails loudly in the host's requireAbsolute instead of being silently
 * joined onto the cwd.
 */

/**
 * Mirror of the host's absolute-path notion (see fs-tree.requireAbsolute):
 * POSIX roots, Windows drive letters, and Windows UNC network shares in
 * both backslash (`\\server\share\...`) and forward-slash
 * (`//server/share/...`) form. Deliberately a superset — see the module
 * comment — so a produced UNC path is never joined onto the cwd.
 */
export function isAbsolutePath(path: string): boolean {
  return path.startsWith('/') || /^[A-Za-z]:[\\/]/.test(path) || /^[\\/]{2}[^\\/]/.test(path)
}

/**
 * The path relative to the session's working directory.
 * @param cwd - the explorer root (absolute).
 * @param path - an absolute entry path from the fs-tree.
 * @returns the relative path with '/' separators ('.' for the cwd itself),
 * or `path` unchanged when it lies outside the cwd.
 *
 * The prefix test is case-insensitive: Windows paths (and macOS's
 * case-insensitive volumes) may arrive with different casing than the cwd
 * row, and the containment decision must not depend on it. The returned
 * relative text keeps the caller's own casing.
 */
export function relativeTo(cwd: string, path: string): string {
  const base = cwd.replace(/[\\/]+$/, '')
  const norm = (value: string): string => value.replace(/\\/g, '/')
  const nBase = norm(base)
  const nPath = norm(path)
  if (nPath === nBase) return '.'
  if (nPath.toLowerCase().startsWith(`${nBase.toLowerCase()}/`)) return nPath.slice(nBase.length + 1)
  return path
}

/**
 * Whether `target` lies under `base` (or equals it), tolerant of separator
 * style and — on Windows-style drive paths — of letter case. A client-side
 * mirror of the host's `isWithin` (fs-tree.ts) used to decide whether a
 * git-derived path can be opened in the editor (a linked worktree outside
 * the session workspace cannot: the host's workspace fence would reject it).
 */
export function isWithinWorkspace(base: string, target: string): boolean {
  const norm = (value: string): string => value.replace(/[\\/]+/g, '/').replace(/\/$/, '')
  const b = norm(base)
  const t = norm(target)
  const lb = b.toLowerCase()
  const lt = t.toLowerCase()
  return lt === lb || lt.startsWith(`${lb}/`)
}

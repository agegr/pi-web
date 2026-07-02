import { homedir } from "os";
import { isAbsolute, resolve } from "path";

/**
 * Normalize a user-supplied working-directory path:
 * - expand a leading `~` / `~/` to the home directory
 * - resolve relative paths against the server process cwd
 *
 * Shared by cwd validation and worktree discovery so both apply the same rules.
 */
export function normalizeCwd(cwd: string): string {
  if (cwd === "~") return homedir();
  if (cwd.startsWith("~/")) return resolve(homedir(), cwd.slice(2));
  return isAbsolute(cwd) ? cwd : resolve(cwd);
}

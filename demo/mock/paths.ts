/** Fixed filesystem layout the demo pretends to run on. */
export const HOME = "/Users/demo";
export const AGENT_DIR = `${HOME}/.pi/agent`;
export const PROJECT_ROOT = `${HOME}/code/pi-web`;
export const PROJECT_BRANCH = "main";
export const SCRATCH_ROOT = `${HOME}/pi-cwd-20260918`;
/** A linked Git worktree of the project, listed in the worktree switcher. */
export const WORKTREE_ROOT = `${HOME}/code/pi-web-worktrees/feat-session-timer`;
export const WORKTREE_BRANCH = "feat/session-timer";

export function sessionDirFor(cwd: string): string {
  return `${AGENT_DIR}/sessions/--${cwd.replace(/^[/\\]/, "").replace(/[/\\:]/g, "-")}--`;
}

export function sessionFilePath(cwd: string, created: string, id: string): string {
  return `${sessionDirFor(cwd)}/${created.replace(/[:.]/g, "-")}_${id}.jsonl`;
}

export function relativeToProject(filePath: string, root = PROJECT_ROOT): string | null {
  if (filePath === root) return "";
  return filePath.startsWith(`${root}/`) ? filePath.slice(root.length + 1) : null;
}

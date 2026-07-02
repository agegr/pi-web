import { execFile } from "child_process";
import { normalizeCwd } from "@/lib/cwd";
import type { WorktreeInfo } from "@/lib/types";

export type { WorktreeInfo };

export interface WorktreeListResult {
  /** Root of the worktree that contains the requested cwd, or null if not a repo. */
  currentWorktreeRoot: string | null;
  worktrees: WorktreeInfo[];
}

/** Run git with argv (never a shell string) inside `cwd`. */
function runGit(cwd: string, args: string[]): Promise<{ ok: boolean; stdout: string }> {
  return new Promise((resolvePromise) => {
    execFile(
      "git",
      ["--no-optional-locks", "-C", cwd, ...args],
      { encoding: "utf8", maxBuffer: 10 * 1024 * 1024 },
      (error, stdout) => {
        resolvePromise({ ok: !error, stdout: stdout ?? "" });
      }
    );
  });
}

/**
 * Parse `git worktree list --porcelain -z` output.
 *
 * Records are separated by an empty line; with -z every attribute line and the
 * final record terminator are NUL-delimited. Each record starts with a
 * `worktree <path>` line, optionally followed by `HEAD <sha>`, `branch <ref>`,
 * `detached`, or `bare`.
 */
function parsePorcelain(stdout: string): Omit<WorktreeInfo, "current">[] {
  const worktrees: Omit<WorktreeInfo, "current">[] = [];
  // With -z, attributes are NUL-separated and records are separated by an
  // extra NUL (i.e. a blank field). Split on NUL and walk the fields.
  const fields = stdout.split("\0");
  let cur: Omit<WorktreeInfo, "current"> | null = null;

  const flush = () => {
    if (cur) worktrees.push(cur);
    cur = null;
  };

  for (const raw of fields) {
    if (raw === "") { flush(); continue; }
    const sp = raw.indexOf(" ");
    const key = sp === -1 ? raw : raw.slice(0, sp);
    const value = sp === -1 ? "" : raw.slice(sp + 1);
    switch (key) {
      case "worktree":
        flush();
        cur = { path: value, branch: null, head: null, detached: false, bare: false };
        break;
      case "HEAD":
        if (cur) cur.head = value || null;
        break;
      case "branch":
        // e.g. "refs/heads/main" -> "main"
        if (cur) cur.branch = value.replace(/^refs\/heads\//, "") || null;
        break;
      case "detached":
        if (cur) cur.detached = true;
        break;
      case "bare":
        if (cur) cur.bare = true;
        break;
      default:
        break;
    }
  }
  flush();
  return worktrees;
}

/**
 * Discover git worktrees for the repository containing `cwd`.
 * Returns an empty list (repoRoot: null) when cwd is not inside a git repo or
 * git is unavailable — the caller degrades gracefully.
 */
export async function listWorktrees(cwd: string): Promise<WorktreeListResult> {
  const normalized = normalizeCwd(cwd);

  const top = await runGit(normalized, ["rev-parse", "--show-toplevel"]);
  if (!top.ok) return { currentWorktreeRoot: null, worktrees: [] };
  const currentWorktreeRoot = top.stdout.trim() || null;

  const list = await runGit(normalized, ["worktree", "list", "--porcelain", "-z"]);
  if (!list.ok) return { currentWorktreeRoot, worktrees: [] };

  const parsed = parsePorcelain(list.stdout);
  const worktrees: WorktreeInfo[] = parsed.map((w) => ({
    ...w,
    current: currentWorktreeRoot !== null && w.path === currentWorktreeRoot,
  }));

  return { currentWorktreeRoot, worktrees };
}

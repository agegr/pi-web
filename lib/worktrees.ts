import { execFile } from "child_process";
import { existsSync, mkdirSync } from "fs";
import { homedir } from "os";
import { basename, join } from "path";
import { normalizeCwd } from "@/lib/cwd";
import type { WorktreeInfo } from "@/lib/types";

export type { WorktreeInfo };

export interface WorktreeListResult {
  /** Root of the worktree that contains the requested cwd, or null if not a repo. */
  currentWorktreeRoot: string | null;
  worktrees: WorktreeInfo[];
}

/** Run git with argv (never a shell string) inside `cwd`. */
function runGit(cwd: string, args: string[]): Promise<{ ok: boolean; stdout: string; stderr: string }> {
  return new Promise((resolvePromise) => {
    execFile(
      "git",
      ["--no-optional-locks", "-C", cwd, ...args],
      { encoding: "utf8", maxBuffer: 10 * 1024 * 1024 },
      (error, stdout, stderr) => {
        resolvePromise({ ok: !error, stdout: stdout ?? "", stderr: stderr ?? "" });
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
function parsePorcelain(stdout: string): Omit<WorktreeInfo, "current" | "isMain">[] {
  const worktrees: Omit<WorktreeInfo, "current" | "isMain">[] = [];
  // With -z, attributes are NUL-separated and records are separated by an
  // extra NUL (i.e. a blank field). Split on NUL and walk the fields.
  const fields = stdout.split("\0");
  let cur: Omit<WorktreeInfo, "current" | "isMain"> | null = null;

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
  // git lists the main worktree first; linked worktrees follow.
  const worktrees: WorktreeInfo[] = parsed.map((w, i) => ({
    ...w,
    isMain: i === 0,
    current: currentWorktreeRoot !== null && w.path === currentWorktreeRoot,
  }));

  return { currentWorktreeRoot, worktrees };
}

// ----------------------------------------------------------------------------
// Branch listing + worktree creation (Phase 2)
// ----------------------------------------------------------------------------

export interface BranchListResult {
  /** Local branch names, or empty if not a git repo. */
  branches: string[];
  /** Suggested default base branch: main/master if present, else current. */
  defaultBase: string | null;
}

/** List local branches for choosing a base to fork a new worktree from. */
export async function listBranches(cwd: string): Promise<BranchListResult> {
  const normalized = normalizeCwd(cwd);
  const res = await runGit(normalized, ["for-each-ref", "--format=%(refname:short)", "refs/heads"]);
  if (!res.ok) return { branches: [], defaultBase: null };

  const branches = res.stdout.split("\n").map((b) => b.trim()).filter(Boolean);
  if (branches.length === 0) return { branches: [], defaultBase: null };

  let defaultBase: string | null = null;
  if (branches.includes("main")) defaultBase = "main";
  else if (branches.includes("master")) defaultBase = "master";
  else {
    // Fall back to the currently checked-out branch, else the first branch.
    const cur = await runGit(normalized, ["symbolic-ref", "--quiet", "--short", "HEAD"]);
    const curBranch = cur.ok ? cur.stdout.trim() : "";
    defaultBase = (curBranch && branches.includes(curBranch)) ? curBranch : branches[0];
  }
  return { branches, defaultBase };
}

/** Turn a branch name into a filesystem-safe directory slug. */
export function branchSlug(branch: string): string {
  return branch.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "worktree";
}

export interface CreateWorktreeResult {
  ok: boolean;
  worktreePath?: string;
  branch?: string;
  mainRepo?: string;
  error?: string;
}

export interface CreateLocalBranchResult {
  ok: boolean;
  branch?: string;
  error?: string;
}

/** Create and switch to a local branch in the selected working tree. */
export async function createLocalBranch(
  cwd: string,
  opts: { branch: string; base?: string }
): Promise<CreateLocalBranchResult> {
  const normalized = normalizeCwd(cwd);
  const branch = opts.branch.trim();
  if (!branch) return { ok: false, error: "Branch name is required" };

  const check = await runGit(normalized, ["check-ref-format", "--branch", branch]);
  if (!check.ok) return { ok: false, error: `Invalid branch name: ${branch}` };

  const args = ["switch", "-c", branch];
  if (opts.base) args.push(opts.base);
  const res = await runGit(normalized, args);
  if (!res.ok) return { ok: false, error: (res.stderr || "git switch failed").trim() };

  return { ok: true, branch };
}

/**
 * Create a new worktree with a new branch, forked from `base`.
 *
 * Following codex's design, worktrees live entirely outside the user's repo,
 * under ~/.pi/worktrees/<branch-slug>/<repo-name>/. This keeps the original
 * working tree 100% clean — no .gitignore or .git/info/exclude hacks needed.
 */
export async function createWorktree(
  cwd: string,
  opts: { branch: string; base?: string }
): Promise<CreateWorktreeResult> {
  const normalized = normalizeCwd(cwd);
  const branch = opts.branch.trim();
  if (!branch) return { ok: false, error: "Branch name is required" };

  // Validate branch name via git's own checker (rejects invalid refs).
  const check = await runGit(normalized, ["check-ref-format", "--branch", branch]);
  if (!check.ok) return { ok: false, error: `Invalid branch name: ${branch}` };

  // Resolve the main worktree root (used as metadata + repo-name source).
  const cdup = await runGit(normalized, ["rev-parse", "--path-format=absolute", "--git-common-dir"]);
  if (!cdup.ok) return { ok: false, error: "Not a git repository" };
  const commonGitDir = cdup.stdout.trim();
  // commonGitDir is <mainRepo>/.git ; its parent is the main repo root.
  const mainRepo = commonGitDir.replace(/\/\.git\/?$/, "");
  const repoName = basename(mainRepo) || "repo";

  // Worktrees live under ~/.pi/worktrees/<slug>/<repo-name>/, outside the repo.
  const containerDir = join(homedir(), ".pi", "worktrees", branchSlug(branch));
  const worktreePath = join(containerDir, repoName);

  if (existsSync(worktreePath)) {
    return { ok: false, error: `Target directory already exists: ${worktreePath}` };
  }

  try {
    mkdirSync(containerDir, { recursive: true });
  } catch (e) {
    return { ok: false, error: `Cannot create worktrees dir: ${e instanceof Error ? e.message : String(e)}` };
  }

  const args = ["worktree", "add", "-b", branch, worktreePath];
  if (opts.base) args.push(opts.base);
  const add = await runGit(normalized, args);
  if (!add.ok) {
    return { ok: false, error: (add.stderr || "git worktree add failed").trim() };
  }

  return { ok: true, worktreePath, branch, mainRepo };
}

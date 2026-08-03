import { NextResponse } from "next/server";
import { execFile } from "child_process";
import { promisify } from "util";
import { existsSync } from "fs";

const execFileAsync = promisify(execFile);

export const dynamic = "force-dynamic";

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", ["-C", cwd, ...args], {
    timeout: 10_000,
    maxBuffer: 1024 * 1024,
    env: { ...process.env, LC_ALL: "C" },
  });
  return stdout.trim();
}

/** Parse `git diff --numstat` output and sum added/deleted columns. */
function sumNumstat(output: string): { added: number; deleted: number } {
  let added = 0;
  let deleted = 0;
  for (const line of output.split("\n")) {
    if (!line.trim()) continue;
    const parts = line.split("\t");
    const a = parseInt(parts[0], 10);
    const d = parseInt(parts[1], 10);
    // Binary files show "-" for counts — skip them.
    if (Number.isFinite(a)) added += a;
    if (Number.isFinite(d)) deleted += d;
  }
  return { added, deleted };
}

/** Parse `git diff --numstat` output into a path→{added,deleted} map. */
function numstatMap(output: string): Map<string, { added: number; deleted: number }> {
  const m = new Map<string, { added: number; deleted: number }>();
  for (const line of output.split("\n")) {
    if (!line.trim()) continue;
    const parts = line.split("\t");
    if (parts.length < 3) continue;
    const a = parseInt(parts[0], 10);
    const d = parseInt(parts[1], 10);
    m.set(parts[2], {
      added: Number.isFinite(a) ? a : 0,
      deleted: Number.isFinite(d) ? d : 0,
    });
  }
  return m;
}

interface GitFileEntry {
  path: string;
  status: string;
  where: "unstaged" | "staged" | "untracked";
  added: number;
  deleted: number;
}

// GET /api/git-diff?cwd=... — returns line-level diff stats + branch + file counts.
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const cwd = searchParams.get("cwd");
    if (!cwd || !existsSync(cwd)) {
      return NextResponse.json({ error: "Invalid cwd" }, { status: 400 });
    }

    // Check it's a git repo.
    try {
      await git(cwd, ["rev-parse", "--is-inside-work-tree"]);
    } catch {
      return NextResponse.json({
        isGit: false,
        branch: null,
        added: 0,
        deleted: 0,
        modified: 0,
        staged: 0,
        untracked: 0,
        files: [],
      });
    }

    // Get branch name.
    let branch: string | null = null;
    try {
      branch = await git(cwd, ["rev-parse", "--abbrev-ref", "HEAD"]);
      if (branch === "HEAD") branch = null; // detached
    } catch {
      /* detached or error */
    }

    // Unstaged changes (worktree vs index).
    let unstaged = { added: 0, deleted: 0 };
    try {
      unstaged = sumNumstat(await git(cwd, ["diff", "--numstat"]));
    } catch {
      /* no changes or error */
    }

    // Staged changes (index vs HEAD).
    let staged = { added: 0, deleted: 0 };
    try {
      staged = sumNumstat(await git(cwd, ["diff", "--cached", "--numstat"]));
    } catch {
      /* no changes or error */
    }

    // File counts from porcelain status.
    let modified = 0;
    let stagedCount = 0;
    let untracked = 0;
    // File-level list for click-to-expand in inspector. XY = index/worktree status.
    // ?? = untracked; R/C = rename/copy (path kept as-is, may contain " -> ").
    const files: GitFileEntry[] = [];
    try {
      const porcelain = await git(cwd, ["status", "--porcelain"]);
      const unstagedNS = numstatMap(await git(cwd, ["diff", "--numstat"]).catch(() => ""));
      const stagedNS = numstatMap(
        await git(cwd, ["diff", "--cached", "--numstat"]).catch(() => ""),
      );
      for (const line of porcelain.split("\n")) {
        if (line.length < 2) continue;
        const x = line[0];
        const y = line[1];
        if (x === "?" && y === "?") {
          untracked++;
          if (line.length >= 4) {
            files.push({
              path: line.slice(3),
              status: "??",
              where: "untracked",
              added: 0,
              deleted: 0,
            });
          }
          continue;
        }
        if (x !== " " && x !== "?") stagedCount++;
        if (y !== " " && y !== "?") modified++;
        // File-level (skip rows that are too short to contain a path)
        if (line.length >= 4) {
          const path = line.slice(3);
          if (x !== " " && x !== "?") {
            const n = stagedNS.get(path) ?? { added: 0, deleted: 0 };
            files.push({ path, status: x, where: "staged", ...n });
          } else if (y !== " " && y !== "?") {
            const n = unstagedNS.get(path) ?? { added: 0, deleted: 0 };
            files.push({ path, status: y, where: "unstaged", ...n });
          }
          // R/C rename/copy: status="R"/"C" with path possibly containing " -> " — kept as-is above.
        }
      }
    } catch {
      /* ignore file-level errors; aggregate counts still returned */
    }

    return NextResponse.json({
      isGit: true,
      branch,
      added: unstaged.added + staged.added,
      deleted: unstaged.deleted + staged.deleted,
      modified,
      staged: stagedCount,
      untracked,
      files,
    });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

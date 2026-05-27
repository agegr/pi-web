import { NextResponse } from "next/server";
import { execSync } from "child_process";
import { existsSync } from "fs";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const { cwd, action, commitMessage } = (await req.json()) as { cwd?: string; action?: string; commitMessage?: string };
    if (!cwd || !existsSync(cwd)) {
      return NextResponse.json({ error: "Invalid project path/CWD" }, { status: 400 });
    }

    // Run action
    if (action === "status") {
      try {
        const branchCmd = "git rev-parse --abbrev-ref HEAD";
        const branch = execSync(branchCmd, { cwd, encoding: "utf8" }).trim();

        const statusCmd = "git status -s";
        const statusOut = execSync(statusCmd, { cwd, encoding: "utf8" });
        const modifiedFiles = statusOut
          .split("\n")
          .map((line) => line.trim())
          .filter(Boolean)
          .map((line) => {
            const parts = line.split(/\s+/);
            const statusType = parts[0];
            const file = parts.slice(1).join(" ");
            return { status: statusType, file };
          });

        const logCmd = "git log --oneline -n 6";
        const logOut = execSync(logCmd, { cwd, encoding: "utf8" });
        const history = logOut
          .split("\n")
          .map((line) => line.trim())
          .filter(Boolean)
          .map((line) => {
            const hash = line.slice(0, 7);
            const msg = line.slice(8);
            return { hash, message: msg };
          });

        return NextResponse.json({
          branch,
          modifiedFiles,
          history,
          isClean: modifiedFiles.length === 0,
        });
      } catch (err: any) {
        return NextResponse.json({
          error: "Not a git repository or git is missing",
          details: err?.message || String(err),
        });
      }
    }

    if (action === "commit") {
      if (!commitMessage || !commitMessage.trim()) {
        return NextResponse.json({ error: "Commit message is required" }, { status: 400 });
      }
      try {
        // Stage modified/untracked files and commit
        execSync("git add -A", { cwd });
        const commitCmd = `git commit -m "${commitMessage.replace(/"/g, '\\"')}"`;
        const commitOut = execSync(commitCmd, { cwd, encoding: "utf8" });
        return NextResponse.json({ success: true, message: commitOut.trim() });
      } catch (err: any) {
        return NextResponse.json({ error: "Commit failed", details: err?.message || String(err) }, { status: 500 });
      }
    }

    if (action === "push") {
      try {
        const pushOut = execSync("git push", { cwd, encoding: "utf8" });
        return NextResponse.json({ success: true, message: pushOut.trim() });
      } catch (err: any) {
        return NextResponse.json({ error: "Push failed", details: err?.message || String(err) }, { status: 500 });
      }
    }

    return NextResponse.json({ error: "Unsupported action" }, { status: 400 });
  } catch (e: any) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

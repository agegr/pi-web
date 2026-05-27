import { NextResponse } from "next/server";
import { execSync } from "child_process";
import { existsSync, readFileSync, writeFileSync } from "fs";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const { cwd, action, commitMessage, branchName, targetBranch, filePath, rollbackFiles, resolveConflictMode } = (await req.json()) as {
      cwd?: string;
      action?: string;
      commitMessage?: string;
      branchName?: string;
      targetBranch?: string;
      filePath?: string;
      rollbackFiles?: string[];
      resolveConflictMode?: "mine" | "theirs";
    };

    if (!cwd || !existsSync(cwd)) {
      return NextResponse.json({ error: "Invalid project path/CWD" }, { status: 400 });
    }

    // 1. Get overall state (Local Changes tree, status, branch, logs)
    if (action === "status") {
      try {
        const branchCmd = "git rev-parse --abbrev-ref HEAD";
        const branch = execSync(branchCmd, { cwd, encoding: "utf8" }).trim();

        // Check if there's merge conflicts
        let isMerging = false;
        try {
          execSync("git rev-parse --merge-filter", { cwd, stdio: "ignore" });
        } catch {
          // If .git/MERGE_HEAD exists, we are merging and might have conflicts
          isMerging = existsSync(`${cwd}/.git/MERGE_HEAD`);
        }

        const statusOut = execSync("git status -s", { cwd, encoding: "utf8" });
        const modifiedFiles = statusOut
          .split("\n")
          .map((line) => line.trim())
          .filter(Boolean)
          .map((line) => {
            const statusType = line.slice(0, 2);
            const file = line.slice(3).trim().replace(/^"|"$/g, ""); // strip quotes
            const isConflict = statusType === "UU" || statusType === "AA" || statusType === "UD" || statusType === "DU";
            return { status: statusType, file, isConflict };
          });

        const logOut = execSync("git log --oneline -n 30", { cwd, encoding: "utf8" });
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
          isMerging,
          isClean: modifiedFiles.length === 0,
        });
      } catch (err: any) {
        return NextResponse.json({
          error: "Not a git repository or git missing",
          details: err?.message || String(err),
        });
      }
    }

    // 2. Fetch Lists of Local and Remote Branches
    if (action === "list-branches") {
      try {
        const localOut = execSync("git branch --format='%(refname:short)'", { cwd, encoding: "utf8" });
        const localBranches = localOut.split("\n").map((b) => b.trim()).filter(Boolean);

        // Fetch remote branches (filter out HEAD pointer)
        const remoteOut = execSync("git branch -r --format='%(refname:short)'", { cwd, encoding: "utf8" });
        const remoteBranches = remoteOut
          .split("\n")
          .map((b) => b.trim())
          .filter(Boolean)
          .filter((b) => !b.includes("/HEAD"));

        return NextResponse.json({ local: localBranches, remote: remoteBranches });
      } catch (err: any) {
        return NextResponse.json({ error: "Failed to load branches", details: err?.message }, { status: 500 });
      }
    }

    // 3. Checkout branch
    if (action === "checkout") {
      if (!branchName) {
        return NextResponse.json({ error: "Branch name is required" }, { status: 400 });
      }
      try {
        const out = execSync(`git checkout ${branchName}`, { cwd, encoding: "utf8" });
        return NextResponse.json({ success: true, message: out.trim() });
      } catch (err: any) {
        return NextResponse.json({ error: "Checkout failed. Make sure your working tree is clean.", details: err?.message }, { status: 500 });
      }
    }

    // 4. Merge action
    if (action === "merge") {
      if (!targetBranch) {
        return NextResponse.json({ error: "Target branch name to merge is required" }, { status: 400 });
      }
      try {
        const out = execSync(`git merge ${targetBranch}`, { cwd, encoding: "utf8" });
        return NextResponse.json({ success: true, message: out.trim() });
      } catch (err: any) {
        // If merge failed due to conflicts, send conflict status to UI
        const errMessage = err?.message || "";
        if (errMessage.toLowerCase().includes("conflict") || errMessage.toLowerCase().includes("failed")) {
          return NextResponse.json({
            error: "Merge conflict occurred! Please resolve conflicts inside the files.",
            conflicted: true,
            details: errMessage,
          });
        }
        return NextResponse.json({ error: "Merge failed", details: errMessage }, { status: 500 });
      }
    }

    // 5. Commit hook
    if (action === "commit") {
      if (!commitMessage || !commitMessage.trim()) {
        return NextResponse.json({ error: "Commit message is required" }, { status: 400 });
      }
      try {
        execSync("git add -A", { cwd });
        const cmd = `git commit -m "${commitMessage.replace(/"/g, '\\"')}"`;
        const out = execSync(cmd, { cwd, encoding: "utf8" });
        return NextResponse.json({ success: true, message: out.trim() });
      } catch (err: any) {
        return NextResponse.json({ error: "Commit failed", details: err?.message || String(err) }, { status: 500 });
      }
    }

    // 6. Rollback / Abort changes for specific files
    if (action === "rollback") {
      if (!rollbackFiles || rollbackFiles.length === 0) {
        return NextResponse.json({ error: "Provide at least one file to revert" }, { status: 400 });
      }
      try {
        for (const file of rollbackFiles) {
          // Checkout file from HEAD to discard edits
          execSync(`git checkout HEAD -- "${file}"`, { cwd });
          try {
            execSync(`git reset HEAD -- "${file}"`, { cwd });
          } catch {}
        }
        return NextResponse.json({ success: true });
      } catch (err: any) {
        return NextResponse.json({ error: "Rollback failed", details: err?.message }, { status: 500 });
      }
    }

    // 7. Push / Fetch / Pull
    if (action === "push") {
      try {
        const out = execSync("git push", { cwd, encoding: "utf8" });
        return NextResponse.json({ success: true, message: out.trim() });
      } catch (err: any) {
        return NextResponse.json({ error: "Push failed", details: err?.message }, { status: 500 });
      }
    }

    if (action === "pull") {
      try {
        const out = execSync("git pull", { cwd, encoding: "utf8" });
        return NextResponse.json({ success: true, message: out.trim() });
      } catch (err: any) {
        const errMessage = err?.message || "";
        if (errMessage.toLowerCase().includes("conflict")) {
          return NextResponse.json({ error: "Pull conflicts occurred! Please resolve conflicts.", conflicted: true });
        }
        return NextResponse.json({ error: "Pull failed", details: errMessage }, { status: 500 });
      }
    }

    if (action === "fetch") {
      try {
        const out = execSync("git fetch", { cwd, encoding: "utf8" });
        return NextResponse.json({ success: true, message: out.trim() });
      } catch (err: any) {
        return NextResponse.json({ error: "Fetch failed", details: err?.message }, { status: 500 });
      }
    }

    // 8. One-click Conflict Resolution
    if (action === "resolve-conflict") {
      if (!filePath || !resolveConflictMode) {
        return NextResponse.json({ error: "filePath and resolveConflictMode required" }, { status: 400 });
      }
      try {
        // Resolve using checkout --ours or --theirs
        const sideFlag = resolveConflictMode === "mine" ? "--ours" : "--theirs";
        execSync(`git checkout ${sideFlag} -- "${filePath}"`, { cwd });
        execSync(`git add "${filePath}"`, { cwd });
        return NextResponse.json({ success: true });
      } catch (err: any) {
        return NextResponse.json({ error: "Conflict resolution failed", details: err?.message }, { status: 500 });
      }
    }

    // 9. Read uncommitted file diff vs HEAD (Inline Diff API)
    if (action === "diff") {
      if (!filePath) {
        return NextResponse.json({ error: "filePath required" }, { status: 400 });
      }
      try {
        const isBinary = filePath.endsWith(".png") || filePath.endsWith(".jpg") || filePath.endsWith(".jpeg") || filePath.endsWith(".gif") || filePath.endsWith(".webp") || filePath.endsWith(".ico") || filePath.endsWith(".mp3") || filePath.endsWith(".wav");
        if (isBinary) {
          return NextResponse.json({ oldContent: "二进制文件无法预览 Diff\n(Binary file changes cannot be compared textually)", newContent: "二进制文件无法预览 Diff\n(Binary file)", filePath });
        }

        // Fetch original from HEAD
        let oldContent = "";
        try {
          oldContent = execSync(`git show HEAD:"${filePath}"`, { cwd, encoding: "utf8" });
        } catch {
          // File might be newly created untracked, thus empty under HEAD
        }

        let newContent = "";
        try {
          newContent = readFileSync(`${cwd}/${filePath}`, "utf8");
        } catch {
          // File might be deleted locally
        }

        return NextResponse.json({ oldContent, newContent, filePath });
      } catch (err: any) {
        return NextResponse.json({ error: "Diff fetch failed", details: err?.message }, { status: 500 });
      }
    }

    // 10. Get historical commit files listing
    if (action === "commit-files") {
      if (!branchName) { // double reuse parameter for commit SHA hash
        return NextResponse.json({ error: "Commit hash is required" }, { status: 400 });
      }
      try {
        const out = execSync(`git show --name-status --oneline ${branchName}`, { cwd, encoding: "utf8" });
        const lines = out.split("\n").filter(Boolean);
        // Skip first line representing commit title
        const list = lines.slice(1).map((line) => {
          const parts = line.split(/\s+/);
          return { status: parts[0], file: parts.slice(1).join(" ") };
        });
        return NextResponse.json({ files: list });
      } catch (err: any) {
        return NextResponse.json({ error: "Failed to load files for this commit", details: err?.message }, { status: 500 });
      }
    }

    return NextResponse.json({ error: "Unsupported action" }, { status: 400 });
  } catch (e: any) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

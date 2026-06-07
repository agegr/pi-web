import { NextResponse } from "next/server";
import { spawn, ChildProcess } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { getGitHubToken } from "@/lib/github-auth";
import { parseRepo } from "@/lib/parse-repo";
import { getAgentDir } from "@/lib/session-reader";

const CLONE_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

function waitForChild(child: ChildProcess, timeoutMs: number): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`Timed out after ${timeoutMs / 1000}s`));
    }, timeoutMs);

    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`Process exited with code ${code}`));
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

// POST /api/github/clone — clone a repo, stream progress via SSE
// Accepts: "owner/repo" or "https://github.com/owner/repo[.git]"
// Repos are stored under ~/.pi/agent/repos/ for easy Docker volume mapping
export async function POST(req: Request) {
  const token = getGitHubToken();
  if (!token) {
    return NextResponse.json({ error: "Not logged in to GitHub" }, { status: 401 });
  }

  const body = (await req.json()) as { repo?: string };
  const repoInput = body.repo?.trim();

  if (!repoInput) {
    return NextResponse.json({ error: "repo is required (e.g. owner/repo or full URL)" }, { status: 400 });
  }

  const repo = parseRepo(repoInput);
  if (!repo) {
    return NextResponse.json({ error: "Invalid repo. Use owner/repo or https://github.com/owner/repo" }, { status: 400 });
  }

  const agentDir = getAgentDir();
  const reposDir = join(agentDir, "repos");
  if (!existsSync(reposDir)) mkdirSync(reposDir, { recursive: true });

  const cloneDir = join(reposDir, repo.replace("/", "-"));

  const stream = new ReadableStream({
    async start(controller) {
      const encode = (data: unknown) => {
        controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(data)}\n\n`));
      };

      if (existsSync(cloneDir)) {
        encode({ type: "done", path: cloneDir, message: `Repo already exists at ${cloneDir}` });
        controller.close();
        return;
      }

      encode({ type: "progress", message: `Cloning ${repo}...` });

      const doClone = async (): Promise<void> => {
        // Try gh CLI first
        try {
          const child = spawn("gh", ["repo", "clone", repo, cloneDir], {
            env: { ...process.env, GH_TOKEN: token },
            stdio: ["ignore", "pipe", "pipe"],
          });

          child.stdout.on("data", (data: Buffer) => {
            for (const line of data.toString().split("\n").filter(Boolean)) {
              encode({ type: "progress", message: line });
            }
          });
          child.stderr.on("data", (data: Buffer) => {
            for (const line of data.toString().split("\n").filter(Boolean)) {
              encode({ type: "progress", message: line });
            }
          });

          await waitForChild(child, CLONE_TIMEOUT_MS);
          return;
        } catch {
          // Fallback to git clone
        }

        // Fallback: git clone with credential helper (no token in URL or on disk)
        encode({ type: "progress", message: "gh not available, falling back to git clone..." });

        const child = spawn("git", [
          "-c", `credential.helper=!f() { echo "username=x-access-token"; echo "password=${token}"; }; f`,
          "clone", `https://github.com/${repo}.git`, cloneDir,
        ], {
          stdio: ["ignore", "pipe", "pipe"],
        });

        child.stderr.on("data", (data: Buffer) => {
          for (const line of data.toString().split("\n").filter(Boolean)) {
            encode({ type: "progress", message: line });
          }
        });

        await waitForChild(child, CLONE_TIMEOUT_MS);
      };

      try {
        await doClone();
        encode({ type: "done", path: cloneDir, message: `Cloned ${repo} to ${cloneDir}` });
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Clone failed";
        encode({ type: "error", message: msg });
      }

      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
    },
  });
}

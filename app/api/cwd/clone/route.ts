import { NextResponse } from "next/server";
import { existsSync, rmSync, realpathSync } from "fs";
import { resolve, sep } from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import { allowFileRoot } from "@/lib/file-access";
import { normalizeDirectory } from "@/lib/directory-browser";

const execFileAsync = promisify(execFile);

const SAFE_URL_RE = /^https?:\/\/[^\s;|&$`'"]+$/;
const SAFE_REPO_NAME_RE = /^[a-zA-Z0-9._-]+$/;

function extractRepoName(url: string): string {
  const cleaned = url.replace(/\.git$/, "").replace(/\/$/, "");
  const parts = cleaned.split("/");
  return parts[parts.length - 1] || "repo";
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as Record<string, unknown>;
    const parent = typeof body.parent === "string" ? body.parent : "";
    const url = typeof body.url === "string" ? body.url.trim() : "";

    if (!parent || !url) {
      return NextResponse.json({ error: "parent and url are required" }, { status: 400 });
    }

    if (!SAFE_URL_RE.test(url) || url.length > 2048) {
      return NextResponse.json({ error: "Invalid repository URL" }, { status: 400 });
    }

    const repoName = extractRepoName(url);
    if (!SAFE_REPO_NAME_RE.test(repoName) || repoName.startsWith(".")) {
      return NextResponse.json({ error: "Invalid repository name derived from URL" }, { status: 400 });
    }

    const normalizedParent = normalizeDirectory(parent);
    let resolvedParent: string;
    try {
      resolvedParent = realpathSync(normalizedParent);
    } catch {
      resolvedParent = resolve(normalizedParent);
    }

    const targetPath = resolve(resolvedParent, repoName);
    const parentWithSep = resolvedParent.endsWith(sep) ? resolvedParent : resolvedParent + sep;

    if (targetPath !== resolvedParent + sep + repoName && !targetPath.startsWith(parentWithSep)) {
      return NextResponse.json(
        { error: "Invalid repository name" },
        { status: 400 },
      );
    }

    if (existsSync(targetPath)) {
      return NextResponse.json({ error: "Target directory already exists" }, { status: 409 });
    }

    try {
      await execFileAsync("git", ["clone", url, targetPath], {
        timeout: 120_000,
        maxBuffer: 10 * 1024 * 1024,
        env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
      });
    } catch (gitErr: unknown) {
      try { rmSync(targetPath, { recursive: true, force: true }); } catch { /* ignore */ }
      const msg = (gitErr as { stderr?: string; message?: string })?.stderr
        || (gitErr as { message?: string })?.message
        || String(gitErr);
      return NextResponse.json({ error: `Clone failed: ${msg}` }, { status: 400 });
    }

    if (typeof globalThis !== "undefined") {
      (globalThis as Record<string, unknown>).__piAllowedRootsCache = undefined;
    }
    allowFileRoot(targetPath);

    return NextResponse.json({ path: targetPath });
  } catch (err: unknown) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

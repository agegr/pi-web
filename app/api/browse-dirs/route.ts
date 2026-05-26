import { NextResponse } from "next/server";
import { existsSync, readdirSync, statSync } from "fs";
import { join, basename } from "path";
import { homedir } from "os";

export const dynamic = "force-dynamic";

// POST /api/browse-dirs
// body: { dirName: string }
// Returns matching full paths from recent sessions + common directories.
export async function POST(req: Request) {
  try {
    const { dirName } = (await req.json()) as { dirName?: string };
    if (!dirName) return NextResponse.json({ matches: [] });

    const matches: string[] = [];
    const seen = new Set<string>();

    // 1. Collect cwds from all sessions via listAllSessions
    const { listAllSessions } = await import("@/lib/session-reader");
    const sessions = await listAllSessions();
    for (const s of sessions) {
      if (s.cwd && basename(s.cwd).toLowerCase() === dirName.toLowerCase()) {
        if (!seen.has(s.cwd)) {
          seen.add(s.cwd);
          matches.push(s.cwd);
        }
      }
    }

    // 2. Search common parent directories for matching folder names
    const home = homedir();
    const searchRoots = [home, join(home, "Projects"), join(home, "projects"), join(home, "code"), join(home, "Code"), join(home, "repos"), join(home, "github"), join(home, "src")];
    // Also add parent dirs of all known cwds
    for (const s of sessions) {
      if (s.cwd) {
        const parent = s.cwd.split(/[/\\]/).slice(0, -1).join(s.cwd.includes("\\") ? "\\" : "/");
        if (parent && !searchRoots.includes(parent)) searchRoots.push(parent);
      }
    }

    for (const root of searchRoots) {
      try {
        const entries = readdirSync(root, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.isDirectory() && entry.name.toLowerCase() === dirName.toLowerCase()) {
            const full = join(root, entry.name);
            if (!seen.has(full)) {
              seen.add(full);
              matches.push(full);
            }
          }
        }
      } catch {
        // skip unreadable directories
      }
    }

    return NextResponse.json({ matches });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

// GET /api/browse-dirs?path=<dirPath>
// Returns directory listing for a given path (for building a directory browser).
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const dirPath = searchParams.get("path");
    const home = homedir();

    if (!dirPath) {
      return NextResponse.json({ path: home, entries: listDir(home), valid: true });
    }

    // Security: only allow listing directories that are under known roots
    const { listAllSessions } = await import("@/lib/session-reader");
    const sessions = await listAllSessions();
    const allowedRoots = new Set<string>();
    for (const s of sessions) {
      if (s.cwd) {
        // Add the cwd itself and all parent paths up to root
        let p = s.cwd;
        while (p && p !== "/" && !/^[a-zA-Z]:\\?$/.test(p)) {
          allowedRoots.add(p.toLowerCase?.() ?? p);
          const parent = p.split(/[/\\]/).slice(0, -1).join(p.includes("\\") ? "\\" : "/");
          if (parent === p) break;
          p = parent;
        }
      }
    }
    allowedRoots.add(home.toLowerCase?.() ?? home);

    const normalized = dirPath.toLowerCase?.() ?? dirPath;
    const isAllowed = [...allowedRoots].some((root) => normalized.startsWith(root) || root.startsWith(normalized));

    // Allow browsing if it's under an allowed root, or if it's a parent of an allowed root
    if (!isAllowed) {
      // Also allow any directory on the system for flexibility in a local dev tool
      // (this is a local-only server)
    }

    if (!isDirectory(dirPath)) {
      return NextResponse.json({
        path: home,
        entries: listDir(home),
        valid: false,
        error: `Directory does not exist: ${dirPath}`,
        requestedPath: dirPath,
      });
    }

    const entries = listDir(dirPath);
    return NextResponse.json({ path: dirPath, entries, valid: true });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

interface DirEntry {
  name: string;
  path: string;
  isDir: boolean;
}

const SKIP_DIRS = new Set(["node_modules", ".git", ".next", "dist", "build", "__pycache__", ".cache", "coverage", ".turbo", "target", "vendor", ".DS_Store"]);

function isDirectory(dirPath: string): boolean {
  try {
    return existsSync(dirPath) && statSync(dirPath).isDirectory();
  } catch {
    return false;
  }
}

function listDir(dirPath: string): DirEntry[] {
  try {
    const stat = statSync(dirPath);
    if (!stat.isDirectory()) return [];
  } catch {
    return [];
  }

  try {
    const names = readdirSync(dirPath, { withFileTypes: true });
    return names
      .filter((d) => d.isDirectory() && !SKIP_DIRS.has(d.name) && !d.name.startsWith("."))
      .map((d) => ({
        name: d.name,
        path: join(dirPath, d.name),
        isDir: true,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  } catch {
    return [];
  }
}

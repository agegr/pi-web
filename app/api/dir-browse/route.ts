import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import os from "os";

const IGNORED_NAMES = new Set([
  "node_modules", ".git", ".next", "dist", "build", "__pycache__",
  ".turbo", ".cache", "coverage", ".pytest_cache", ".mypy_cache",
  "target", "vendor", ".DS_Store",
]);

interface DirEntry {
  name: string;
  isDir: boolean;
}

interface DriveInfo {
  name: string;
  path: string;
}

function isWindows(): boolean {
  return os.platform() === "win32";
}

function getAvailableDrives(): DriveInfo[] {
  if (!isWindows()) return [];
  const drives: DriveInfo[] = [];
  for (let i = 65; i <= 90; i++) {
    const letter = String.fromCharCode(i);
    const p = `${letter}:\\`;
    try {
      fs.statSync(p);
      drives.push({ name: `${letter}:`, path: p });
    } catch {
      // ignore unavailable
    }
  }
  return drives;
}

export async function GET(request: NextRequest) {
  try {
    const homeDir = os.homedir();
    let dirPath = request.nextUrl.searchParams.get("path") ?? "";

    if (!dirPath) {
      if (isWindows()) {
        return NextResponse.json({ drives: getAvailableDrives(), homePath: homeDir });
      }
      dirPath = "/";
    }

    // "/" on Windows means home directory
    if (isWindows() && (dirPath === "/" || dirPath === "~")) {
      dirPath = homeDir;
    }

    let stat: fs.Stats;
    try {
      stat = fs.statSync(dirPath);
    } catch (e: unknown) {
      return NextResponse.json({ error: "Path not accessible: " + String(e) }, { status: 404 });
    }

    if (!stat.isDirectory()) {
      return NextResponse.json({ error: "Not a directory" }, { status: 400 });
    }

    const parentDir = path.dirname(dirPath);
    const canGoUp = parentDir !== dirPath;

    let names: string[];
    try {
      names = fs.readdirSync(dirPath);
    } catch {
      return NextResponse.json({ error: "Cannot read directory contents (access denied)", path: dirPath, parentPath: canGoUp ? parentDir : null, entries: [] });
    }
    const entries: DirEntry[] = names
      .filter((name) => !IGNORED_NAMES.has(name) && !name.startsWith("."))
      .map((name): DirEntry | null => {
        const full = path.join(dirPath, name);
        try {
          const s = fs.statSync(full);
          return { name, isDir: s.isDirectory() };
        } catch {
          return null;
        }
      })
      .filter((e): e is DirEntry => e !== null && e.isDir)
      .sort((a, b) => a.name.localeCompare(b.name));

    return NextResponse.json({
      path: dirPath,
      parentPath: canGoUp ? parentDir : null,
      entries,
      drives: getAvailableDrives(),
      homePath: homeDir,
    });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

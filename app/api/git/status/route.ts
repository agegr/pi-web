import fs from "fs";
import { NextRequest, NextResponse } from "next/server";
import { getAllowedFileRoots, isExistingFilePathAllowed, isFilePathAllowed, isWindowsAbsolutePath } from "@/lib/file-access";
import { getGitStatus } from "@/lib/git-changes";
import { createServerTiming } from "@/lib/server-timing";

export async function GET(request: NextRequest) {
  const timing = createServerTiming();
  try {
    const cwd = request.nextUrl.searchParams.get("cwd")?.trim() ?? "";
    const force = request.nextUrl.searchParams.get("force") === "1";
    if (!cwd || (!cwd.startsWith("/") && !isWindowsAbsolutePath(cwd))) {
      return timing.finish(NextResponse.json({ error: "cwd must be an absolute path" }, { status: 400 }));
    }

    const allowedRoots = await timing.time("auth", () => getAllowedFileRoots());
    if (!isFilePathAllowed(cwd, allowedRoots)) {
      return timing.finish(NextResponse.json({ error: "Access denied" }, { status: 403 }));
    }

    let stat: fs.Stats;
    try {
      stat = timing.timeSync("stat", () => fs.statSync(cwd));
    } catch {
      return timing.finish(NextResponse.json({ error: "Directory not found" }, { status: 404 }));
    }
    if (!stat.isDirectory()) {
      return timing.finish(NextResponse.json({ error: "Not a directory" }, { status: 400 }));
    }
    if (!isExistingFilePathAllowed(cwd, allowedRoots)) {
      return timing.finish(NextResponse.json({ error: "Access denied" }, { status: 403 }));
    }

    const result = await timing.time("git", () => getGitStatus(cwd, { force }));
    const response = timing.timeSync("serialize", () => NextResponse.json(result));
    return timing.finish(response);
  } catch (error) {
    return timing.finish(NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    ));
  }
}

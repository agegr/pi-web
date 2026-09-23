import { spawn } from "child_process";
import { stat } from "fs/promises";
import { resolve } from "path";
import { NextResponse } from "next/server";
import { getAllowedFileRoots, isExistingFilePathAllowed } from "@/lib/file-access";
import { isLoopbackHost, openFolderCommand, revealFileCommand } from "@/lib/open-folder";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Spawn the file manager and resolve once the process has launched. */
function launch(command: string, args: string[]): Promise<void> {
  return new Promise<void>((resolveLaunch, rejectLaunch) => {
    // windowsHide must stay false on Windows: with SW_HIDE inherited from
    // STARTUPINFO, explorer.exe never shows the folder window (verified by
    // enumerating top-level windows before/after spawn). explorer.exe is a
    // GUI app, so no console flash needs hiding in the first place.
    const child = spawn(command, args, { detached: true, stdio: "ignore", windowsHide: false });
    child.once("spawn", () => resolveLaunch());
    child.once("error", rejectLaunch);
    child.unref();
  });
}

/** The host the request was addressed to (falling back to the request URL). */
function requestHost(req: Request): string | null {
  const header = req.headers.get("host");
  if (header) return header;
  try {
    return new URL(req.url).host;
  } catch {
    return null;
  }
}

export async function POST(req: Request) {
  try {
    // Opening a window is a desktop action: a phone or another computer on the
    // LAN must not raise windows on the host machine. See isLoopbackHost for
    // why this is a usability guard rather than access control.
    if (!isLoopbackHost(requestHost(req))) {
      return NextResponse.json(
        { error: "Only a browser on this machine can open the file manager" },
        { status: 403 },
      );
    }
    const body = await req.json() as { path?: unknown };
    if (typeof body.path !== "string" || !body.path.trim()) {
      return NextResponse.json({ error: "path required" }, { status: 400 });
    }
    const target = resolve(body.path);
    let targetStat;
    try {
      targetStat = await stat(target);
    } catch {
      return NextResponse.json({ error: "path not found" }, { status: 400 });
    }
    const roots = await getAllowedFileRoots();
    if (!isExistingFilePathAllowed(target, roots)) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }
    // A directory opens as-is; a file is revealed (parent folder opened with
    // the entry selected) so delivered files land next to their neighbours.
    const isDirectory = targetStat.isDirectory();
    const { command, args } = isDirectory ? openFolderCommand(target) : revealFileCommand(target);
    await launch(command, args);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}

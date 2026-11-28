import { stat } from "fs/promises";
import { resolve } from "path";
import { NextResponse } from "next/server";
import { getAllowedFileRoots, isExistingFilePathAllowed } from "@/lib/file-access";
import { fileManagerPlatform, isFileManagerSupported, isLoopbackHost, launchFileManager } from "@/lib/open-in-file-manager";
import { errorMessage } from "@/lib/errors";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Whether this request may raise a file-manager window on the server. */
function availabilityFor(request: Request): { supported: boolean; reason: string | null } {
  if (!isLoopbackHost(request.headers.get("host"))) return { supported: false, reason: "remote" };
  if (!isFileManagerSupported(process.platform)) return { supported: false, reason: "unsupported-platform" };
  return { supported: true, reason: null };
}

/** Lets the sidebar pick the button label and disable it when unavailable. */
export async function GET(request: Request) {
  const { supported, reason } = availabilityFor(request);
  // Under WSL this is "win32": Explorer answers, so the button names it.
  return NextResponse.json({ supported, reason, platform: fileManagerPlatform() });
}

/**
 * `{ cwd }` opens the session workspace in the OS file manager; `{ reveal }`
 * shows a file or folder selected in its folder (a file row's menu).
 */
export async function POST(request: Request) {
  try {
    const { supported, reason } = availabilityFor(request);
    if (!supported) {
      return NextResponse.json({ error: reason }, { status: 403 });
    }

    const body = await request.json() as { cwd?: unknown; reveal?: unknown };
    const reveal = typeof body.reveal === "string" && body.reveal.trim() !== "";
    const requested = reveal ? body.reveal : body.cwd;
    if (typeof requested !== "string" || !requested.trim()) {
      return NextResponse.json({ error: "cwd-required" }, { status: 400 });
    }
    const target = resolve(requested);
    // Authorize before touching the path, so a location outside the allowed
    // roots answers 403 whether or not it exists.
    const roots = await getAllowedFileRoots();
    if (!isExistingFilePathAllowed(target, roots)) {
      return NextResponse.json({ error: "access-denied" }, { status: 403 });
    }
    const isDirectory = (await stat(target)).isDirectory();
    if (!reveal && !isDirectory) {
      return NextResponse.json({ error: "not-a-directory" }, { status: 400 });
    }

    await launchFileManager(target, process.platform, process.env, reveal);
    return NextResponse.json({ opened: true });
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}

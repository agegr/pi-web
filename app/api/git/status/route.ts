import fs from "fs";
import { getAllowedFileRoots, isExistingFilePathAllowed, isFilePathAllowed, isWindowsAbsolutePath } from "@/lib/file-access";
import { getGitStatus } from "@/lib/git-changes";

export async function GET(request: Request) {
  try {
    const cwd = new URL(request.url).searchParams.get("cwd")?.trim() ?? "";
    if (!cwd || (!cwd.startsWith("/") && !isWindowsAbsolutePath(cwd))) {
      return Response.json({ error: "cwd must be an absolute path" }, { status: 400 });
    }

    const allowedRoots = await getAllowedFileRoots();
    if (!isFilePathAllowed(cwd, allowedRoots)) {
      return Response.json({ error: "Access denied" }, { status: 403 });
    }

    let stat: fs.Stats;
    try {
      stat = fs.statSync(cwd);
    } catch {
      return Response.json({ error: "Directory not found" }, { status: 404 });
    }
    if (!stat.isDirectory()) {
      return Response.json({ error: "Not a directory" }, { status: 400 });
    }
    if (!isExistingFilePathAllowed(cwd, allowedRoots)) {
      return Response.json({ error: "Access denied" }, { status: 403 });
    }

    return Response.json(await getGitStatus(cwd));
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}

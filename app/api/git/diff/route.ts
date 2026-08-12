import { getAllowedFileRoots, isExistingFilePathAllowed, isFilePathAllowed, isWindowsAbsolutePath } from "@/lib/file-access";
import { getGitFileDiff } from "@/lib/git-changes";

export async function GET(request: Request) {
  try {
    const cwd = new URL(request.url).searchParams.get("cwd")?.trim() ?? "";
    const filePath = new URL(request.url).searchParams.get("path")?.trim() ?? "";
    if (!cwd || (!cwd.startsWith("/") && !isWindowsAbsolutePath(cwd))) {
      return Response.json({ error: "cwd must be an absolute path" }, { status: 400 });
    }
    if (!filePath || (!filePath.startsWith("/") && !isWindowsAbsolutePath(filePath))) {
      return Response.json({ error: "path must be an absolute path" }, { status: 400 });
    }

    const allowedRoots = await getAllowedFileRoots();
    if (!isFilePathAllowed(cwd, allowedRoots) || !isFilePathAllowed(filePath, allowedRoots)) {
      return Response.json({ error: "Access denied" }, { status: 403 });
    }
    // The cwd must resolve inside an allowed root. The file itself may no
    // longer exist when Git reports it as deleted; getGitFileDiff verifies
    // that the requested path belongs to this repository and its status.
    if (!isExistingFilePathAllowed(cwd, allowedRoots)) {
      return Response.json({ error: "Access denied" }, { status: 403 });
    }

    return Response.json(await getGitFileDiff(cwd, filePath));
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}

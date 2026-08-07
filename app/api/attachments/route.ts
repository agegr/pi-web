import { NextRequest } from "next/server";
import fs from "fs";
import path from "path";
import { getAttachmentsDir } from "@/lib/attachments-dir";

/**
 * Serves an attachment from the persistent attachments directory. Used by
 * file cards in chat messages ("[附件] <path>") so the user can download the
 * file the agent was given.
 *
 * `?path=<absolutePath>` must resolve inside the attachments directory
 * (files live in <attachments>/<uuid>/<original-name>). `?name=<file>` is
 * kept for legacy files stored directly in the root.
 */

function encodeHeaderValue(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (ch) =>
    `%${ch.charCodeAt(0).toString(16).toUpperCase()}`
  );
}

export async function GET(request: NextRequest): Promise<Response> {
  const params = new URL(request.url).searchParams;
  const root = path.resolve(getAttachmentsDir());

  let filePath: string;
  const absPath = params.get("path");
  if (absPath) {
    if (absPath.includes("\0")) return Response.json({ error: "Invalid file path" }, { status: 400 });
    filePath = path.resolve(absPath);
    if (filePath !== root && !filePath.startsWith(root + path.sep)) {
      return Response.json({ error: "Access denied" }, { status: 403 });
    }
  } else {
    const name = params.get("name");
    if (!name || name !== path.basename(name) || name === "." || name === ".." || name.includes("\0")) {
      return Response.json({ error: "Invalid file name" }, { status: 400 });
    }
    filePath = path.join(root, name);
  }

  let stat: fs.Stats;
  try {
    stat = fs.statSync(filePath);
  } catch {
    return Response.json({ error: "Attachment not found" }, { status: 404 });
  }
  if (!stat.isFile()) {
    return Response.json({ error: "Attachment not found" }, { status: 404 });
  }

  const name = path.basename(filePath);
  const fallback = name.replace(/[^\x20-\x7E]|["\\;\r\n]/g, "_") || "download";
  return new Response(fs.readFileSync(filePath), {
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Length": String(stat.size),
      "Content-Disposition": `attachment; filename="${fallback}"; filename*=UTF-8''${encodeHeaderValue(name)}`,
    },
  });
}

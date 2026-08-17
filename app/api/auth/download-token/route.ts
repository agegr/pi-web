import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import {
 getAllowedFileRoots,
 isExistingFilePathAllowed,
 isFilePathAllowed,
 normalizeSlashes,
} from "@/lib/file-access";
import { encodeFilePathForApi } from "@/lib/file-paths";
import {
 DOWNLOAD_TOKEN_TTL_MS,
 createDownloadToken,
 getDownloadSecret,
} from "@/lib/download-auth";

export const dynamic = "force-dynamic";

/**
 * Issue a one-time signed download token for a file.
 *
 * The endpoint is protected by Basic Auth (enforced in proxy.ts). Wrapper apps
 * (e.g. Pake) replay download requests through their own HTTP client without
 * the page's Basic credentials, so they rely on the short-lived signed token
 * issued here to pass the proxy check.
 *
 * Query parameters:
 * - path: absolute path of the target file (URL-encoded)
 *
 * Returns `{ token, expiresAt }` on success, or a 4xx JSON error.
 *
 * @param request - GET request with the `path` query parameter
 * @returns JSON response carrying the download token
 */
export async function GET(request: NextRequest) {
 const rawPath = request.nextUrl.searchParams.get("path");
 if (!rawPath) {
  return NextResponse.json(
   { error: "Missing path parameter" },
   { status: 400 },
  );
 }

 let filePath: string;
 try {
  filePath = decodeURIComponent(rawPath);
 } catch {
  return NextResponse.json(
   { error: "Invalid path parameter" },
   { status: 400 },
  );
 }
 filePath = normalizeSlashes(filePath);

 const allowedRoots = await getAllowedFileRoots();
 if (!isFilePathAllowed(filePath, allowedRoots)) {
  return NextResponse.json({ error: "Access denied" }, { status: 403 });
 }

 let stat: fs.Stats;
 try {
  stat = fs.statSync(filePath);
 } catch {
  return NextResponse.json({ error: "File not found" }, { status: 404 });
 }
 if (!stat.isFile()) {
  return NextResponse.json({ error: "Not a file" }, { status: 400 });
 }

 // Re-check after resolving symlinks so a link cannot escape the allowed roots.
 if (!isExistingFilePathAllowed(filePath, allowedRoots)) {
  return NextResponse.json({ error: "Access denied" }, { status: 403 });
 }

 const pathname = `/api/files/${encodeFilePathForApi(filePath)}`;
 const token = createDownloadToken(getDownloadSecret(), pathname);
 return NextResponse.json({
  token,
  expiresAt: Date.now() + DOWNLOAD_TOKEN_TTL_MS,
 });
}

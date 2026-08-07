import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";
import { parseFormDataWithinLimit, RequestBodyTooLargeError } from "@/lib/bounded-form-data";
import { ensureAttachmentsDir } from "@/lib/attachments-dir";

/**
 * Receives dropped files that the browser could not provide a real path for
 * (e.g. drags where text/uri-list carries no file:// URI) and writes them to a
 * persistent local attachments directory, returning their absolute paths so
 * the agent can read them with its own tools.
 *
 * Each request gets its own <uuid>/ subdirectory so the original file name is
 * always preserved — uploading a second "a.pdf" never renames the first one.
 */

const MAX_DROP_FILE_BYTES = 25 * 1024 * 1024;
const MAX_DROP_TOTAL_BYTES = 100 * 1024 * 1024;
const MAX_DROP_REQUEST_BYTES = MAX_DROP_TOTAL_BYTES + 1024 * 1024;

export async function POST(request: NextRequest): Promise<NextResponse> {
  let formData: FormData;
  try {
    formData = await parseFormDataWithinLimit(request, MAX_DROP_REQUEST_BYTES);
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      return NextResponse.json({ error: "Dropped files must total 100MB or less" }, { status: 413 });
    }
    throw error;
  }

  const files = formData.getAll("files").filter((entry): entry is File => typeof entry !== "string");
  if (files.length === 0) {
    return NextResponse.json({ error: "No files provided" }, { status: 400 });
  }
  if (files.some((file) => file.size > MAX_DROP_FILE_BYTES)) {
    return NextResponse.json({ error: "Each dropped file must be 25MB or smaller" }, { status: 413 });
  }
  if (files.reduce((total, file) => total + file.size, 0) > MAX_DROP_TOTAL_BYTES) {
    return NextResponse.json({ error: "Dropped files must total 100MB or less" }, { status: 413 });
  }

  const fileNames = files.map((file) => file.name);
  for (const fileName of fileNames) {
    if (
      !fileName ||
      fileName === "." ||
      fileName === ".." ||
      fileName.includes("\0") ||
      fileName.includes("/") ||
      fileName.includes("\\") ||
      path.basename(fileName) !== fileName
    ) {
      return NextResponse.json({ error: `Invalid file name: ${fileName || "(empty)"}` }, { status: 400 });
    }
  }

  const paths: string[] = [];
  for (const file of files) {
    // One subdirectory per file: the original name is always preserved, so a
    // second upload of "a.pdf" or two same-named files in one batch never
    // overwrite each other and never need a "-1" suffix.
    const directory = path.join(ensureAttachmentsDir(), randomUUID());
    fs.mkdirSync(directory, { recursive: true });
    const destination = path.join(directory, file.name);
    const buffer = Buffer.from(await file.arrayBuffer());
    fs.writeFileSync(destination, buffer);
    paths.push(destination);
  }

  return NextResponse.json({ paths });
}

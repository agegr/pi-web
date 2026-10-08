import { createHash } from "crypto";
import fs from "fs";
import path from "path";
import { TEXT_EDIT_MAX_BYTES, type TextFileReadOnlyReason } from "./file-types";
import { replaceUploadFile } from "./file-upload";
import { serializeByKey } from "./key-serializer";
import { hasParentDirectorySegment, isExistingPathWithinRoots, isPathWithinRoots } from "./path-security";

// Editing in the file viewer: a whole-file read with a content hash, and a
// save that writes only when the file on disk still has the hash the editor
// started from. No lock covers other writers (the agent's tools write with
// `fs` directly), so a write landing between the hash check and the rename
// still wins; the check catches every change that happened before the save.

const SAVE_CHAINS = Symbol.for("pi-web:file-edit-save");
const SHA256_HEX = /^[0-9a-f]{64}$/;

export type TextFileLineSeparator = "\n" | "\r\n";

export interface EditableTextFile {
  content: string;
  hash: string;
  size: number;
  eol: TextFileLineSeparator;
  editable: boolean;
  readOnlyReason?: TextFileReadOnlyReason;
}

export type SaveTextFileResult =
  | { status: 200; hash: string; size: number; mtime: string }
  | { status: 400 | 403 | 404 | 409 | 413; error: string; currentHash?: string };

export function hashTextFileBytes(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function isTextFileHash(value: unknown): value is string {
  return typeof value === "string" && SHA256_HEX.test(value);
}

/**
 * The line separator an editor must keep to write `text` back unchanged, or
 * null when it mixes separators (or uses bare `\r`): an editor normalizes
 * those, so saving would rewrite lines nobody touched.
 */
export function detectLineSeparator(text: string): TextFileLineSeparator | null {
  const crlf = text.split("\r\n").length - 1;
  const lf = text.split("\n").length - 1 - crlf;
  const cr = text.split("\r").length - 1 - crlf;
  if (cr > 0 || (crlf > 0 && lf > 0)) return null;
  return crlf > 0 ? "\r\n" : "\n";
}

/** Why `bytes` cannot round-trip through an editor's string, or null when they can. */
export function textContentReadOnlyReason(bytes: Buffer): "binary" | "encoding" | "line-endings" | null {
  if (bytes.includes(0)) return "binary";
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    return "encoding";
  }
  return detectLineSeparator(text) === null ? "line-endings" : null;
}

function canReplace(filePath: string): boolean {
  try {
    // The rename needs the directory, the staging file inherits the mode.
    fs.accessSync(filePath, fs.constants.W_OK);
    fs.accessSync(path.dirname(filePath), fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * The whole file for the editor, or null when it is larger than
 * `TEXT_EDIT_MAX_BYTES` (the caller then serves the chunked preview).
 * `writable` is the route's answer to whether the allowed roots, not only a
 * session reference, authorized the path.
 */
export function readTextFileForEditing(filePath: string, writable: boolean): EditableTextFile | null {
  const stat = fs.statSync(filePath);
  if (stat.size > TEXT_EDIT_MAX_BYTES) return null;
  const bytes = fs.readFileSync(filePath);
  if (bytes.length > TEXT_EDIT_MAX_BYTES) return null;

  const content = bytes.toString("utf8");
  const contentReason = textContentReadOnlyReason(bytes);
  const readOnlyReason: TextFileReadOnlyReason | null = !writable
    ? "outside-roots"
    : fs.lstatSync(filePath).isSymbolicLink()
      ? "symlink"
      : contentReason ?? (canReplace(filePath) ? null : "permission");

  return {
    content,
    hash: hashTextFileBytes(bytes),
    size: bytes.length,
    eol: detectLineSeparator(content) ?? "\n",
    editable: readOnlyReason === null,
    ...(readOnlyReason ? { readOnlyReason } : {}),
  };
}

/**
 * Replace an existing regular file inside the allowed roots with `content`,
 * provided its bytes still hash to `baseHash`. Saves of one file run one at a
 * time; a stale hash answers 409 with the current one.
 */
export async function saveTextFile(
  filePath: string,
  content: string,
  baseHash: string,
  allowedRoots: Set<string>,
): Promise<SaveTextFileResult> {
  if (hasParentDirectorySegment(filePath) || !isPathWithinRoots(filePath, allowedRoots)) {
    return { status: 403, error: "Access denied" };
  }
  let linkStat: fs.Stats;
  try {
    linkStat = fs.lstatSync(filePath);
  } catch {
    return { status: 404, error: "File not found" };
  }
  if (linkStat.isSymbolicLink()) return { status: 400, error: "Cannot save through a symbolic link" };
  if (!linkStat.isFile()) return { status: 400, error: "Not a file" };
  if (!isExistingPathWithinRoots(filePath, allowedRoots)) return { status: 403, error: "Access denied" };

  const bytes = Buffer.from(content, "utf8");
  if (bytes.length > TEXT_EDIT_MAX_BYTES) {
    return { status: 413, error: "Files larger than 2MB cannot be saved from the editor" };
  }

  // A directory link in the path is allowed when it resolves inside the
  // roots; write where it leads so the staging directory sits beside the file.
  const target = fs.realpathSync(filePath);
  return serializeByKey(SAVE_CHAINS, target, async (): Promise<SaveTextFileResult> => {
    let current: Buffer;
    try {
      current = fs.readFileSync(target);
    } catch {
      return { status: 404, error: "File not found" };
    }
    const currentHash = hashTextFileBytes(current);
    if (currentHash !== baseHash) {
      return { status: 409, error: "The file changed on disk", currentHash };
    }
    if (!current.equals(bytes)) replaceUploadFile(target, bytes, ".pi-save-");
    const stat = fs.statSync(target);
    return { status: 200, hash: hashTextFileBytes(bytes), size: stat.size, mtime: stat.mtime.toISOString() };
  });
}

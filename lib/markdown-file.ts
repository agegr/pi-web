import fs from "node:fs";

export const MAX_TEXT_EDIT_BYTES = 5 * 1024 * 1024;
// Kept as an alias for the existing Markdown editor and its tests.
export const MAX_MARKDOWN_EDIT_BYTES = MAX_TEXT_EDIT_BYTES;

export class MarkdownFileError extends Error {
  readonly status: number;
  constructor(message: string, status: number) { super(message); this.status = status; }
}

/** Compare and write synchronously on one existing descriptor. Never create a
 * missing file or truncate it before checking the user's baseline. */
export function writeTextFile(filePath: string, content: string, baseContent: string, authorize: () => boolean) {
  const bytes = Buffer.from(content, "utf8");
  if (bytes.length > MAX_TEXT_EDIT_BYTES) throw new MarkdownFileError("Text file is too large to edit", 413);
  const link = fs.lstatSync(filePath);
  if (!link.isFile() || link.isSymbolicLink()) throw new MarkdownFileError("Only existing regular files can be edited", 400);
  if (!authorize()) throw new MarkdownFileError("Access denied", 403);
  const fd = fs.openSync(filePath, fs.constants.O_RDWR | (fs.constants.O_NOFOLLOW ?? 0));
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || stat.ino !== link.ino || stat.dev !== link.dev) throw new MarkdownFileError("File changed; retry saving", 409);
    if (stat.size > MAX_TEXT_EDIT_BYTES) throw new MarkdownFileError("Text file is too large to edit", 413);
    const original = fs.readFileSync(fd);
    const current = original.toString("utf8");
    if (current.includes("\0") || !Buffer.from(current, "utf8").equals(original)) throw new MarkdownFileError("Only UTF-8 text files can be edited", 400);
    if (current !== baseContent) return { conflict: true as const, content: current };
    if (content !== current) {
      let offset = 0;
      while (offset < bytes.length) {
        const written = fs.writeSync(fd, bytes, offset, bytes.length - offset, offset);
        if (written === 0) throw new Error("File write did not complete");
        offset += written;
      }
      fs.ftruncateSync(fd, bytes.length);
      fs.fsyncSync(fd);
    }
    return { conflict: false as const, size: bytes.length, modified: fs.fstatSync(fd).mtime.toISOString() };
  } finally { fs.closeSync(fd); }
}

// Compatibility export for the Markdown-specific code already in the tree.
export const writeMarkdownFile = writeTextFile;

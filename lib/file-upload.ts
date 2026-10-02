import fs from "fs";
import path from "path";

export const UPLOAD_CONFLICT_STRATEGIES = ["error", "overwrite", "skip"] as const;
export type UploadConflictStrategy = typeof UPLOAD_CONFLICT_STRATEGIES[number];

const UPLOAD_CONFLICT_STRATEGY_SET = new Set<string>(UPLOAD_CONFLICT_STRATEGIES);

export interface UploadTargetInspection {
  conflicts: string[];
  nonReplaceable: string[];
}

export function parseUploadConflictStrategy(value: string | null): UploadConflictStrategy | null {
  const candidate = value ?? "error";
  return UPLOAD_CONFLICT_STRATEGY_SET.has(candidate)
    ? candidate as UploadConflictStrategy
    : null;
}

export function validateUploadFileNames(fileNames: string[]): string | null {
  if (fileNames.length === 0) return "No files selected";

  const seen = new Set<string>();
  for (const fileName of fileNames) {
    if (!fileName || fileName === "." || fileName === ".." || fileName.includes("\0")) {
      return `Invalid file name: ${fileName || "(empty)"}`;
    }
    if (fileName.includes("/") || fileName.includes("\\") || path.basename(fileName) !== fileName) {
      return `File names must not contain a path: ${fileName}`;
    }
    if (seen.has(fileName)) return `Duplicate file name in upload: ${fileName}`;
    seen.add(fileName);
  }

  return null;
}

export function inspectUploadTargets(directory: string, fileNames: string[]): UploadTargetInspection {
  const conflicts: string[] = [];
  const nonReplaceable: string[] = [];

  for (const fileName of fileNames) {
    const destination = path.join(directory, fileName);
    let stat: fs.Stats;
    try {
      stat = fs.lstatSync(destination);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT") continue;
      throw error;
    }

    conflicts.push(fileName);
    if (!stat.isFile() || stat.isSymbolicLink()) nonReplaceable.push(fileName);
  }

  return { conflicts, nonReplaceable };
}

/** Keep the old entry intact until its complete replacement can be renamed over it. */
export function replaceUploadFile(destination: string, bytes: Buffer): void {
  const stat = fs.lstatSync(destination);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error("Cannot replace a directory or symbolic link");
  }

  // A private directory beside the destination keeps the rename on the same
  // filesystem and gives us ownership of the staging file, even on write failure.
  const stagingDirectory = fs.mkdtempSync(path.join(path.dirname(destination), ".pi-upload-"));
  const stagingFile = path.join(stagingDirectory, "upload");
  try {
    fs.writeFileSync(stagingFile, bytes, { flag: "wx", mode: stat.mode & 0o777 });
    // The destination may have changed since the multipart upload was inspected.
    const current = fs.lstatSync(destination);
    if (!current.isFile() || current.isSymbolicLink()) {
      throw new Error("Cannot replace a directory or symbolic link");
    }
    fs.renameSync(stagingFile, destination);
  } finally {
    fs.rmSync(stagingDirectory, { recursive: true, force: true });
  }
}

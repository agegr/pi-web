import { execFile } from "child_process";
import fs from "fs";
import path from "path";
import { isPathWithinRoots } from "./path-security";
import { resolveRealParent, type MutationOutcome } from "./file-mutations";
import {
  archiveStem,
  buildExtractArgs,
  buildZipArgs,
} from "./archive-names";

/** bsdtar (libarchive) reads and writes every format we expose. */
export const ARCHIVE_COMMAND = "bsdtar";
export const ARCHIVE_TIMEOUT_MS = 10 * 60 * 1000;

export {
  isArchivePath,
  archiveStem,
  buildExtractArgs,
  buildZipArgs,
} from "./archive-names";

function runBsdtar(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(
      ARCHIVE_COMMAND,
      args,
      { timeout: ARCHIVE_TIMEOUT_MS, maxBuffer: 10 * 1024 * 1024 },
      (error, _stdout, stderr) => {
        if (!error) {
          resolve();
          return;
        }
        // Surface the most actionable bsdtar diagnostic line, if any.
        const lastStderr = stderr?.toString().trim().split("\n").pop();
        const failure = new Error(lastStderr || error.message);
        (failure as NodeJS.ErrnoException).code = (error as NodeJS.ErrnoException).code;
        reject(failure);
      },
    );
  });
}

/**
 * Extract an archive file into a fresh sibling directory named after the
 * archive. bsdtar's default handling refuses absolute paths and traversal
 * outside the destination, so extracted entries stay inside the workspace.
 */
export async function extractArchive(
  target: string,
  allowedRoots: Set<string>,
): Promise<MutationOutcome & { extractedTo?: string }> {
  const parent = resolveRealParent(target, allowedRoots);
  if (!parent.ok) return parent;

  let stat: fs.Stats;
  try {
    stat = fs.lstatSync(target);
  } catch {
    return { ok: false, error: "Entry not found", status: 404 };
  }
  if (stat.isSymbolicLink()) {
    return { ok: false, error: "Refusing to extract through a symbolic link", status: 400 };
  }
  if (!stat.isFile()) {
    return { ok: false, error: "Not a file", status: 400 };
  }

  let realTarget: string;
  try {
    realTarget = fs.realpathSync(target);
  } catch {
    return { ok: false, error: "Entry not found", status: 404 };
  }
  if (!isPathWithinRoots(realTarget, parent.realRoots)) {
    return { ok: false, error: "Access denied", status: 403 };
  }

  const stem = archiveStem(path.basename(realTarget));
  // Auto-number the destination (stem, stem-1, stem-2, …) so extracting an
  // archive whose folder already exists never conflicts or overwrites.
  let destination = path.join(parent.directory, stem);
  let suffix = 1;
  for (;;) {
    try {
      fs.lstatSync(destination);
      destination = path.join(parent.directory, `${stem}-${suffix}`);
      suffix += 1;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") break;
      return { ok: false, error: error instanceof Error ? error.message : String(error), status: 500 };
    }
  }

  fs.mkdirSync(destination);
  try {
    await runBsdtar(buildExtractArgs(realTarget, destination));
    return { ok: true, extractedTo: destination };
  } catch (error) {
    // Remove the partial destination so a corrected retry does not conflict.
    try { fs.rmSync(destination, { recursive: true, force: true }); } catch { /* ignore */ }
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { ok: false, error: `${ARCHIVE_COMMAND} is not installed on the server`, status: 500 };
    }
    return { ok: false, error: error instanceof Error ? error.message : String(error), status: 500 };
  }
}

/** Compress a file or directory into a sibling <name>.zip archive. */
export async function compressToZip(
  target: string,
  allowedRoots: Set<string>,
): Promise<MutationOutcome & { archive?: string }> {
  const parent = resolveRealParent(target, allowedRoots);
  if (!parent.ok) return parent;

  let stat: fs.Stats;
  try {
    stat = fs.lstatSync(target);
  } catch {
    return { ok: false, error: "Entry not found", status: 404 };
  }
  if (stat.isSymbolicLink()) {
    return { ok: false, error: "Refusing to compress a symbolic link", status: 400 };
  }
  if (!stat.isFile() && !stat.isDirectory()) {
    return { ok: false, error: "Unsupported entry type", status: 400 };
  }

  let realTarget: string;
  try {
    realTarget = fs.realpathSync(target);
  } catch {
    return { ok: false, error: "Entry not found", status: 404 };
  }
  if (!isPathWithinRoots(realTarget, parent.realRoots)) {
    return { ok: false, error: "Access denied", status: 403 };
  }

  const entryName = path.basename(realTarget);
  const destination = path.join(parent.directory, `${entryName}.zip`);
  try {
    fs.lstatSync(destination);
    return { ok: false, error: "An entry with this name already exists", status: 409 };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      return { ok: false, error: error instanceof Error ? error.message : String(error), status: 500 };
    }
  }

  try {
    await runBsdtar(buildZipArgs(destination, parent.directory, entryName));
    return { ok: true, archive: destination };
  } catch (error) {
    try { fs.unlinkSync(destination); } catch { /* ignore */ }
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { ok: false, error: `${ARCHIVE_COMMAND} is not installed on the server`, status: 500 };
    }
    return { ok: false, error: error instanceof Error ? error.message : String(error), status: 500 };
  }
}

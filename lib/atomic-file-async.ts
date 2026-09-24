import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import { basename, dirname, join } from "node:path";

const RENAME_TIMEOUT_MS = 10_000;
const RETRYABLE_WINDOWS_ERRORS = new Set(["EPERM", "EACCES", "EBUSY"]);

/** Atomically replace a private file, allowing short-lived Windows file locks to clear. */
export async function writePrivateFileAtomic(path: string, contents: string): Promise<void> {
  const tempPath = join(dirname(path), `.${basename(path)}-${randomUUID()}.tmp`);
  const startedAt = Date.now();
  let operation = "write-temp";
  let renameAttempts = 0;
  let failed = false;

  try {
    await fs.writeFile(tempPath, contents, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
      flush: true,
    });

    operation = "rename";
    for (;;) {
      renameAttempts++;
      try {
        await fs.rename(tempPath, path);
        break;
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (process.platform !== "win32" || !RETRYABLE_WINDOWS_ERRORS.has(code ?? "")) {
          throw error;
        }

        // A directory at the destination cannot become a valid replacement.
        try {
          const destination = await fs.stat(path);
          if (!destination.isFile()) throw error;
        } catch (statError) {
          if ((statError as NodeJS.ErrnoException).code !== "ENOENT") throw statError;
        }

        const remainingMs = RENAME_TIMEOUT_MS - (Date.now() - startedAt);
        if (remainingMs <= 0) throw error;
        await new Promise((resolve) => setTimeout(resolve, Math.min(remainingMs, 25 * renameAttempts, 250)));
      }
    }
  } catch (error) {
    failed = true;
    console.error(JSON.stringify({
      event: "models_config_atomic_write_failed",
      code: (error as NodeJS.ErrnoException).code ?? "UNKNOWN",
      operation,
      renameAttempts,
      elapsedMs: Date.now() - startedAt,
    }));
    throw error;
  } finally {
    try {
      await fs.unlink(tempPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        console.error(JSON.stringify({
          event: "models_config_temp_cleanup_failed",
          code: (error as NodeJS.ErrnoException).code ?? "UNKNOWN",
          tempFile: basename(tempPath),
        }));
        if (!failed) throw error;
      }
    }
  }
}

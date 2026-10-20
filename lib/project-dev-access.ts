import { stat } from "node:fs/promises";
import { join } from "node:path";
import { getAllowedFileRoots, isExistingFilePathAllowed } from "./file-access";
import { projectDevPath } from "./project-dev-manager";

export async function authorizeProjectDevCwd(value: unknown, roots?: Set<string>, readConfig = true): Promise<string> {
  if (typeof value !== "string" || !value.trim() || value.length > 4096) throw new Error("Invalid project directory");
  const allowed = roots ?? await getAllowedFileRoots();
  if (!isExistingFilePathAllowed(value, allowed)) throw new Error("Access denied");
  const cwd = projectDevPath(value);
  if (!(await stat(cwd)).isDirectory()) throw new Error("Project directory does not exist");
  if (!readConfig) return cwd;
  // A Procfile symlink must not turn inspection into an arbitrary file read.
  const config = join(cwd, "Procfile.dev");
  if (!isExistingFilePathAllowed(config, allowed)) {
    try { await stat(config); } catch (error) {
      if (["ENOENT", "ENOTDIR"].includes((error as NodeJS.ErrnoException).code ?? "")) return cwd;
      throw error;
    }
    throw new Error("Access denied: Procfile.dev");
  }
  return cwd;
}

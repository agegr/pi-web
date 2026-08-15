/**
 * Shared file plumbing for the Robin stores.
 *
 * Imported from two very different runtimes — the pi extension (loaded by jiti)
 * and the Next.js server (webpack) — so it stays on node builtins only.
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

/** Data lives outside ~/.pi/agent so pi never treats it as its own state. */
export function dataDir(): string {
  return process.env.ROBIN_DATA_DIR || join(homedir(), ".pi", "robin");
}

export function dataPath(name: string): string {
  return join(dataDir(), name);
}

export function readJsonArray<T>(name: string): T[] {
  let raw: string;
  try {
    raw = readFileSync(dataPath(name), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  // A parse failure must not fall through to an empty list: the next write
  // would silently replace a damaged-but-recoverable file with [].
  const parsed = JSON.parse(raw) as unknown;
  if (!Array.isArray(parsed)) {
    throw new Error(`${dataPath(name)} does not contain a JSON array`);
  }
  return parsed as T[];
}

/** Write-then-rename keeps readers from ever seeing a half-written file. */
export function writeJsonArray<T>(name: string, items: T[]): void {
  const path = dataPath(name);
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(items, null, 2)}\n`, "utf8");
  renameSync(tmp, path);
}

export function readJsonObject<T>(name: string): T | null {
  let raw: string;
  try {
    raw = readFileSync(dataPath(name), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  const parsed = JSON.parse(raw) as unknown;
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`${dataPath(name)} does not contain a JSON object`);
  }
  return parsed as T;
}

export function writeJsonObject<T extends object>(name: string, value: T): void {
  const path = dataPath(name);
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  renameSync(tmp, path);
}

export function newId(): string {
  return Math.random().toString(36).slice(2, 10);
}

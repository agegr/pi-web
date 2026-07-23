import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import {
  createEmptyAvatarConfig,
  parseAvatarConfig,
  type AvatarConfig,
} from "./avatar-config";

export function getAvatarConfigPath(cwd: string): string {
  return join(cwd, ".pi", "avatars.json");
}

export function readAvatarConfig(cwd: string): AvatarConfig {
  try {
    return parseAvatarConfig(readFileSync(getAvatarConfigPath(cwd), "utf8"));
  } catch {
    return createEmptyAvatarConfig();
  }
}

/**
 * Persist a complete three-role avatar record to `<cwd>/.pi/avatars.json`.
 * The write is atomic: the JSON is written to a sibling temp file and renamed
 * into place so a partial write never replaces a valid config. The parent
 * `.pi` directory is created on demand. Ticket #5 will add payload-size
 * hardening at the API boundary.
 */
export function writeAvatarConfig(cwd: string, config: AvatarConfig): void {
  const path = getAvatarConfigPath(cwd);
  const dir = dirname(path);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  const serialized = `${JSON.stringify(config, null, 2)}\n`;
  const tempPath = `${path}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(tempPath, serialized, "utf8");
  renameSync(tempPath, path);
}

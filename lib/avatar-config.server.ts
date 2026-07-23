import { readFileSync } from "fs";
import { join } from "path";
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

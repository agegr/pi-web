import { chmodSync, mkdirSync, readFileSync } from "fs";
import { dirname, join } from "path";
import { writePrivateFileAtomicSync } from "./atomic-file.ts";
import {
  emptySessionOrderPreferences,
  normalizeSessionOrderPreferences,
  setProjectPinnedSessionIds,
  type SessionOrderPreferences,
} from "./session-order.ts";

export function sessionOrderPreferencesPath(agentDir: string): string {
  return join(agentDir, "pi-web", "session-order-v1.json");
}

export function readSessionOrderPreferences(agentDir: string): SessionOrderPreferences {
  try {
    const contents = readFileSync(sessionOrderPreferencesPath(agentDir), "utf8");
    return normalizeSessionOrderPreferences(JSON.parse(contents));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT" || error instanceof SyntaxError) {
      return emptySessionOrderPreferences();
    }
    throw error;
  }
}

export function writeProjectSessionOrder(
  agentDir: string,
  projectKey: string,
  pinnedSessionIds: readonly string[],
): SessionOrderPreferences {
  const preferences = setProjectPinnedSessionIds(
    readSessionOrderPreferences(agentDir),
    projectKey,
    pinnedSessionIds,
  );
  const filePath = sessionOrderPreferencesPath(agentDir);
  const directory = dirname(filePath);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  if (process.platform !== "win32") chmodSync(directory, 0o700);
  writePrivateFileAtomicSync(filePath, `${JSON.stringify(preferences, null, 2)}\n`);
  return preferences;
}

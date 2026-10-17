import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

// Pi Web reads the same `keybindings.json` the pi CLI does. Shortcuts stay pi's
// configuration, not a Pi Web-only file (CONTRIBUTING's out-of-scope list rules
// out a second config), so a key rebound for the terminal is rebound here too.

export const PI_KEYBINDINGS_PATH = "keybindings.json";

/** Where pi keeps the user's keybindings; shown in Settings so the file is findable. */
export function keybindingsPath(agentDir = getAgentDir()): string {
  return join(agentDir, PI_KEYBINDINGS_PATH);
}

/**
 * The raw `keybindings.json` object. Anything that is not a plain object reads
 * as `{}`, and a broken file reads as `{}` too rather than failing the page: a
 * shortcut file must never stop the app from loading.
 */
export function readKeybindingsFile(agentDir = getAgentDir()): Record<string, unknown> {
  const path = keybindingsPath(agentDir);
  if (!existsSync(path)) return {};
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, "utf8").replace(/^\uFEFF/, ""));
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
    return parsed as Record<string, unknown>;
  } catch {
    return {};
  }
}

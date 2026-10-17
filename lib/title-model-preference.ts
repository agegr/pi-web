import { mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { writePrivateFileAtomicSync } from "./atomic-file";
import { readRegularFileText } from "./regular-file";

/**
 * The model the Generate title button names a session with, in
 * `pi-web-title-model.json` beside pi's own files. It belongs to this pi-web
 * instance rather than to a browser, so every browser and device that reaches
 * it names sessions the same way. No file (or nothing usable in it) is the
 * default and needs no write: name with the session's own model at the
 * cheapest thinking level it supports.
 *
 * The file holds this one value and writes replace it whole, so a reader sees
 * either the old or the new choice, never half of one, and no read-modify-write
 * lock is needed.
 */
export interface TitleModelPreference {
  /** The model to name with; kept together with `modelId`. */
  provider?: string;
  modelId?: string;
  /** An explicit thinking level, applied only when that model supports it. */
  thinkingLevel?: string;
}

/** Long enough for any provider or model id; a longer one is not one. */
const MAX_FIELD = 200;
const MAX_BYTES = 64 * 1024;

export function getTitleModelPreferencePath(agentDir = getAgentDir()): string {
  return join(agentDir, "pi-web-title-model.json");
}

/**
 * The preference an object holds, or null when it holds none. A malformed
 * field drops that field alone: a half model (a provider without an id) is no
 * model, while a level beside it still stands. Both the file and the route's
 * request body are read through this, so the rules live once.
 */
export function parseTitleModelPreference(raw: unknown): TitleModelPreference | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const value = raw as Record<string, unknown>;
  const field = (key: string): string | undefined => {
    const candidate = value[key];
    return typeof candidate === "string" && candidate.length > 0 && candidate.length <= MAX_FIELD
      ? candidate
      : undefined;
  };
  const provider = field("provider");
  const modelId = field("modelId");
  const thinkingLevel = field("thinkingLevel");
  const preference: TitleModelPreference = {
    ...(provider && modelId ? { provider, modelId } : {}),
    ...(thinkingLevel ? { thinkingLevel } : {}),
  };
  return Object.keys(preference).length > 0 ? preference : null;
}

/** Never throws: a missing, unreadable or unparsable file reads as the default. */
export function readTitleModelPreference(path?: string): TitleModelPreference | null {
  try {
    const text = readRegularFileText(path ?? getTitleModelPreferencePath(), MAX_BYTES);
    return text === undefined ? null : parseTitleModelPreference(JSON.parse(text));
  } catch (error) {
    console.warn(`[pi-web] could not read the title model preference: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

/** A preference holding nothing removes the file: the default is the absence of one. */
export function writeTitleModelPreference(preference: TitleModelPreference | null, path?: string): void {
  const target = path ?? getTitleModelPreferencePath();
  if (!preference || (!preference.provider && !preference.thinkingLevel)) {
    rmSync(target, { force: true });
    return;
  }
  mkdirSync(dirname(target), { recursive: true });
  writePrivateFileAtomicSync(target, JSON.stringify(preference, null, 2) + "\n");
}

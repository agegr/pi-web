import { mkdirSync, renameSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import lockfile from "proper-lockfile";
import { writePrivateFileAtomicSync } from "./atomic-file";
import { serializeByKey } from "./key-serializer";
import { readRegularFileText } from "./regular-file";
import {
  applyPiWebSettingsPatch,
  DEFAULT_PI_WEB_SETTINGS,
  normalizePiWebSettings,
  piWebSettingsDocument,
  type PiWebSettings,
  type PiWebSettingsPatch,
} from "./pi-web-settings-shared";

// This fork's own preferences (Settings › General › Chat: thinking expanded,
// quote selection, Enter to send) in `pi-web-settings.json`, beside
// `pi-web-session-state.json` and pi's own files, so one choice reaches every
// browser and device that uses this server. The rules live in
// `lib/pi-web-settings-shared.ts`; this module only stores them: reads are
// cached by the file's stat fingerprint, writes are serialized in-process,
// locked against other processes and replaced atomically, and a file that
// cannot be parsed is set aside, never silently overwritten.

const MAX_BYTES = 64 * 1024;
// `__proto__` is never copied: assigning it would set the object's prototype instead.
const KNOWN_KEYS = new Set(["version", "thinkingExpandedDefault", "quoteSelection", "enterSendMode", "__proto__"]);

// Route handlers are bundled separately and hot reload re-evaluates modules; globalThis keeps one queue per process.
const QUEUE_KEY: symbol = Symbol.for("pi-web:pi-web-settings-write-queue");

/** As for `mcp.json` and the session UI state: about three seconds of retries in all. */
const LOCK_OPTIONS = {
  realpath: false,
  stale: 10_000,
  retries: { retries: 10, factor: 2, minTimeout: 25, maxTimeout: 500 },
  onCompromised: (error: Error) => {
    console.warn(`[pi-web] the settings lock was compromised: ${error.message}`);
  },
};

/** Another process held the file's lock for longer than the retries wait. */
export class PiWebSettingsLockedError extends Error {
  constructor(message = "Another process holds the pi-web settings lock") {
    super(message);
    this.name = "PiWebSettingsLockedError";
  }
}

interface CachedRead {
  mtimeMs: number;
  size: number;
  ino: number;
  settings: PiWebSettings;
}

declare global {
  var __piWebSettingsCache: Map<string, CachedRead> | undefined;
}

function cache(): Map<string, CachedRead> {
  return (globalThis.__piWebSettingsCache ??= new Map());
}

function errorCode(error: unknown): string | undefined {
  return (error as NodeJS.ErrnoException | undefined)?.code;
}

export function getPiWebSettingsPath(agentDir = getAgentDir()): string {
  return join(agentDir, "pi-web-settings.json");
}

type Parsed = { ok: true; settings: PiWebSettings; raw: Record<string, unknown> } | { ok: false };

function parseSettingsText(text: string): Parsed {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false };
  }
  const settings = normalizePiWebSettings(raw);
  return settings ? { ok: true, settings, raw: raw as Record<string, unknown> } : { ok: false };
}

/**
 * The file's settings through the stat-keyed cache. Missing reads as the
 * defaults and an unparsable file as the defaults (warned once per version of
 * it); anything else, such as a file that is not a regular one or is too large,
 * throws.
 */
function loadSettings(path: string): PiWebSettings {
  let stats;
  try {
    stats = statSync(path);
  } catch (error) {
    const code = errorCode(error);
    if (code === "ENOENT" || code === "ENOTDIR") {
      cache().delete(path);
      return { ...DEFAULT_PI_WEB_SETTINGS };
    }
    throw error;
  }
  const cached = cache().get(path);
  // An atomic replace gives the file a new inode, so a write within the mtime's granularity is still seen.
  if (cached && cached.mtimeMs === stats.mtimeMs && cached.size === stats.size && cached.ino === stats.ino) {
    return cached.settings;
  }
  // Read after the stat: a write in between leaves a fingerprint older than the text, which only costs one more read.
  const text = readRegularFileText(path, MAX_BYTES);
  if (text === undefined) {
    cache().delete(path);
    return { ...DEFAULT_PI_WEB_SETTINGS };
  }
  const parsed = parseSettingsText(text);
  let settings: PiWebSettings;
  if (parsed.ok) {
    settings = parsed.settings;
  } else {
    console.warn(`[pi-web] ${path} is not valid pi-web settings; reading the defaults until the next change sets it aside`);
    settings = { ...DEFAULT_PI_WEB_SETTINGS };
  }
  cache().set(path, { mtimeMs: stats.mtimeMs, size: stats.size, ino: stats.ino, settings });
  return settings;
}

/** Never throws; missing or corrupt → the defaults (does not rewrite on read). */
export function readPiWebSettings(path?: string): PiWebSettings {
  try {
    return { ...loadSettings(path ?? getPiWebSettingsPath()) };
  } catch (error) {
    console.warn(`[pi-web] could not read the pi-web settings: ${error instanceof Error ? error.message : String(error)}`);
    return { ...DEFAULT_PI_WEB_SETTINGS };
  }
}

/** Sets an unparsable file aside beside itself; best effort. */
function backUpCorruptFile(path: string): void {
  const backup = `${path}.corrupt-${Date.now()}`;
  try {
    renameSync(path, backup);
    console.warn(`[pi-web] ${path} could not be parsed; moved it to ${backup} and started from the defaults`);
  } catch (error) {
    console.warn(`[pi-web] ${path} could not be parsed and could not be moved aside (${error instanceof Error ? error.message : String(error)}); starting from the defaults`);
  }
}

/**
 * Reads the file under the lock, applies `patch`, and replaces the file when it
 * changed something. Unknown top-level fields of a valid file are kept for a
 * newer build. Nothing is written when the patch changes nothing.
 */
function editSettings(path: string, patch: PiWebSettingsPatch): Promise<PiWebSettings> {
  return serializeByKey(QUEUE_KEY, path, async () => {
    mkdirSync(dirname(path), { recursive: true });
    let release: () => Promise<void>;
    try {
      release = await lockfile.lock(path, LOCK_OPTIONS);
    } catch (error) {
      if (errorCode(error) === "ELOCKED") throw new PiWebSettingsLockedError();
      throw error;
    }
    try {
      const text = readRegularFileText(path, MAX_BYTES);
      let state: PiWebSettings;
      const extras: Record<string, unknown> = {};
      let reset = false;
      if (text === undefined) {
        state = { ...DEFAULT_PI_WEB_SETTINGS };
      } else {
        const parsed = parseSettingsText(text);
        if (parsed.ok) {
          state = parsed.settings;
          for (const [key, value] of Object.entries(parsed.raw)) {
            if (!KNOWN_KEYS.has(key)) extras[key] = value;
          }
        } else {
          backUpCorruptFile(path);
          state = { ...DEFAULT_PI_WEB_SETTINGS };
          // The file was moved away: write the fresh settings even when the patch changes nothing.
          reset = true;
        }
      }
      const { settings, changed } = applyPiWebSettingsPatch(state, patch);
      if (!changed && !reset) return { ...state };
      writePrivateFileAtomicSync(path, JSON.stringify(piWebSettingsDocument(settings, extras), null, 2) + "\n");
      try {
        const stats = statSync(path);
        cache().set(path, { mtimeMs: stats.mtimeMs, size: stats.size, ino: stats.ino, settings: { ...settings } });
      } catch {
        cache().delete(path);
      }
      return { ...settings };
    } finally {
      try {
        await release();
      } catch {
        // A compromised lock was already reported through onCompromised.
      }
    }
  });
}

export function updatePiWebSettings(patch: PiWebSettingsPatch, path?: string): Promise<PiWebSettings> {
  let target: string;
  try {
    target = path ?? getPiWebSettingsPath();
  } catch (error) {
    return Promise.reject(error);
  }
  return editSettings(target, patch);
}

export function resetPiWebSettingsCacheForTests(): void {
  globalThis.__piWebSettingsCache = undefined;
}

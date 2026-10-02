import { closeSync, lstatSync, mkdirSync, openSync, readSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { CONFIG_DIR_NAME } from "@earendil-works/pi-coding-agent";
import type {
  ContextFileId,
  ContextFileInfo,
  ContextPathProblem,
  ContextResponse,
  ContextScope,
  ContextWriteTarget,
} from "./api-types";
import { isExistingPathWithinRoots } from "./path-security";

// Settings › Context (https://pi.dev/docs/latest/configuration). The seven
// files Pi reads its instructions from, resolved the way the SDK resolves them:
// the agent directory, and the working directory with its `.pi/` configuration.
//
// Context files are discovered without project trust, so nothing here consults
// the trust store. `SYSTEM.md` and `APPEND_SYSTEM.md` are the different pair: a
// project's `.pi/` file takes precedence over the agent directory's while the
// project is trusted, and the two are never combined
// (`DefaultResourceLoader.discoverSystemPromptFile()`).

/** The context-file names Pi tries in a directory, in order (SDK `loadContextFileFromDir()`). */
export const CONTEXT_FILE_CANDIDATES = [
  "AGENTS.override.md",
  "AGENTS.md",
  "AGENTS.MD",
  "CLAUDE.md",
  "CLAUDE.MD",
] as const;

const AGENTS_OVERRIDE_NAME = "AGENTS.override.md";
const AGENTS_FALLBACK_NAME = "AGENTS.md";
/** The AGENTS names without the override, which has a card of its own. */
const AGENTS_NAMES = CONTEXT_FILE_CANDIDATES.filter((name) => name !== AGENTS_OVERRIDE_NAME);

/** The largest file Pi Web reads, or writes, per context file. */
export const CONTEXT_FILE_MAX_BYTES = 256 * 1024;

export interface ContextFileSpec {
  scope: ContextScope;
  /** The file this entry edits, or null for a local entry without a working directory. */
  path(agentDir: string, cwd: string | null): string | null;
  /** Whether Pi Web may remove the file. */
  deletable?: boolean;
}

/**
 * The seven ways Pi picks up context, in display order: the agent directory's
 * files first, then the working directory's. Keyed by id, so a new
 * `ContextFileId` without a spec fails to compile, and insertion order is the
 * display order.
 *
 * The AGENTS entries surface whichever file of the family is discovered in
 * their directory, the `AGENTS.MD` / `CLAUDE.md` / `CLAUDE.MD` fallbacks the
 * docs list included. The working directory's entry leaves the override to its
 * own card, which is the one context file Pi Web deletes: it exists only to
 * replace its siblings, so keeping it empty is the same as removing it.
 */
export const CONTEXT_FILE_SPECS: Record<ContextFileId, ContextFileSpec> = {
  "agents-global": {
    scope: "global",
    path: (agentDir) => join(agentDir, discoveredName(agentDir, CONTEXT_FILE_CANDIDATES) ?? AGENTS_FALLBACK_NAME),
  },
  "system-global": { scope: "global", path: (agentDir) => join(agentDir, "SYSTEM.md") },
  "append-system-global": { scope: "global", path: (agentDir) => join(agentDir, "APPEND_SYSTEM.md") },
  "agents-local": {
    scope: "local",
    path: (_, cwd) => (cwd ? join(cwd, discoveredName(cwd, AGENTS_NAMES) ?? AGENTS_FALLBACK_NAME) : null),
  },
  "system-local": { scope: "local", path: (_, cwd) => (cwd ? join(cwd, CONFIG_DIR_NAME, "SYSTEM.md") : null) },
  "append-system-local": { scope: "local", path: (_, cwd) => (cwd ? join(cwd, CONFIG_DIR_NAME, "APPEND_SYSTEM.md") : null) },
  "agents-override-local": {
    scope: "local",
    path: (_, cwd) => (cwd ? join(cwd, AGENTS_OVERRIDE_NAME) : null),
    deletable: true,
  },
};

export const CONTEXT_FILE_ORDER = Object.keys(CONTEXT_FILE_SPECS) as ContextFileId[];

function isContextFileId(value: unknown): value is ContextFileId {
  return typeof value === "string" && (CONTEXT_FILE_ORDER as string[]).includes(value);
}

/** The context file Pi loads from `dir`: the first candidate that is a regular file. */
function discoveredName(dir: string, names: readonly string[]): string | null {
  for (const name of names) {
    if (isRegularFile(join(dir, name))) return name;
  }
  return null;
}

function isRegularFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

/** Whether anything is at `path` at all, `lstat`-read: a directory and a link to nothing both count. */
function somethingAt(path: string): boolean {
  try {
    lstatSync(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Whether a project file may be read and written: it must resolve inside the
 * allowed roots. A file that does not exist yet is checked through its nearest
 * existing ancestor, so creating it (or the `.pi/` on the way) cannot escape
 * through a link. The agent directory's own files are the user's, followed
 * wherever they lead, as the global `mcp.json` is.
 */
function localPathAllowed(path: string, allowedRoots: Set<string>): boolean {
  let dir = path;
  while (!somethingAt(dir)) {
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return isExistingPathWithinRoots(dir, allowedRoots);
}

/** What stops Pi Web from reading or writing the file at `path`, if anything. */
export function contextPathProblem(
  path: string,
  scope: ContextScope,
  allowedRoots: Set<string>,
): ContextPathProblem | undefined {
  // A directory, or a link to nothing, first: `localPathAllowed()` resolves the
  // nearest existing ancestor and `realpathSync()` fails on a dangling link, so
  // asking it first reported the one case the reason list already names as an
  // `outside-roots` link. Neither can be read or written, so nothing is skipped.
  if (somethingAt(path) && !isRegularFile(path)) return "not-a-file";
  if (scope === "local" && !localPathAllowed(path, allowedRoots)) return "outside-roots";
  return undefined;
}

/** The absolute path one entry edits, or null for a local entry without a working directory. */
export function contextFilePath(id: ContextFileId, agentDir: string, cwd: string | null): string | null {
  return CONTEXT_FILE_SPECS[id].path(agentDir, cwd);
}

/** At most `maxBytes` of a file, read from the start; a file is never loaded whole. */
function readHead(path: string, maxBytes: number, sizeBytes: number): { content: string; truncated: boolean } {
  const truncated = sizeBytes > maxBytes;
  const handle = openSync(path, "r");
  try {
    const buffer = Buffer.alloc(Math.min(sizeBytes, maxBytes));
    const read = readSync(handle, buffer, 0, buffer.length, 0);
    return { content: buffer.subarray(0, read).toString("utf8"), truncated };
  } finally {
    closeSync(handle);
  }
}

export interface ContextReadOptions {
  agentDir: string;
  cwd: string | null;
  allowedRoots: Set<string>;
  /**
   * Whether Pi would load the project's own `.pi/SYSTEM.md` /
   * `.pi/APPEND_SYSTEM.md` right now. `discoverSystemPromptFile()` prefers those
   * two only while the project is trusted and falls back to the agent
   * directory's file otherwise, so an untrusted project's file is reported with
   * `requiresTrust` and the agent directory's stays the effective one. Called at
   * most once, and only while one of the two files is there: a file that exists
   * is itself what makes the folder require trust.
   */
  isProjectTrusted: () => boolean;
}

/**
 * The seven entries as Settings › Context shows them: resolved paths, whether
 * each file is there, its text, and which file Pi actually loads. A local entry
 * without a working directory keeps its place in the list with no path, so the
 * panel can say why it cannot be edited yet.
 */
export function readContextFiles({ agentDir, cwd, allowedRoots, isProjectTrusted }: ContextReadOptions): ContextResponse {
  const files = CONTEXT_FILE_ORDER.map((id): ContextFileInfo => {
    const spec = CONTEXT_FILE_SPECS[id];
    const path = contextFilePath(id, agentDir, cwd);
    // A file that is not there loads nothing, so it starts ineffective; the read
    // below turns that on once a file is found.
    const base: ContextFileInfo = {
      id,
      scope: spec.scope,
      deletable: spec.deletable === true,
      path,
      exists: false,
      effective: false,
      problem: undefined,
      content: "",
      sizeBytes: 0,
      truncated: false,
    };
    if (!path) return base;

    const problem = contextPathProblem(path, spec.scope, allowedRoots);
    if (problem) return { ...base, problem };

    let sizeBytes: number;
    try {
      sizeBytes = statSync(path).size;
    } catch {
      return base;
    }
    try {
      const { content, truncated } = readHead(path, CONTEXT_FILE_MAX_BYTES, sizeBytes);
      return { ...base, exists: true, effective: true, content, sizeBytes, truncated };
    } catch {
      return { ...base, exists: true, effective: true, sizeBytes, problem: "unreadable" };
    }
  });

  const find = (id: ContextFileId) => files[CONTEXT_FILE_ORDER.indexOf(id)];
  const localSystem = find("system-local");
  const localAppend = find("append-system-local");
  const localOverride = find("agents-override-local");
  // Asked only about a file that is there: a project `.pi/SYSTEM.md` is itself
  // what makes the folder require trust, and a folder without one is never
  // locked by this.
  const loadsLocalSystem = localSystem.exists && isProjectTrusted();
  const loadsLocalAppend = localAppend.exists && isProjectTrusted();

  return {
    agentDir,
    cwd,
    maxBytes: CONTEXT_FILE_MAX_BYTES,
    files: files.map((file) => {
      switch (file.id) {
        // The docs' one case of precedence between the two scopes: a project's
        // `.pi/SYSTEM.md` or `.pi/APPEND_SYSTEM.md` takes over the agent
        // directory's while the project is trusted, and the two files are never
        // combined.
        case "system-global":
          return shadowedBy(file, loadsLocalSystem ? localSystem : undefined);
        case "append-system-global":
          return shadowedBy(file, loadsLocalAppend ? localAppend : undefined);
        // AGENTS.override.md replaces AGENTS.md or CLAUDE.md in the same directory only.
        case "agents-local":
          return shadowedBy(file, localOverride);
        case "system-local":
          return waitedForTrust(file, loadsLocalSystem);
        case "append-system-local":
          return waitedForTrust(file, loadsLocalAppend);
        default:
          return file;
      }
    }),
  };
}

/** `file`, as the file that replaces it, when both are there and the winner is loaded. */
function shadowedBy(file: ContextFileInfo, winner: ContextFileInfo | undefined): ContextFileInfo {
  // A file that is not there is not replaced by anything: the card says it is
  // missing, and Pi's precedence only decides between two files that exist.
  if (!file.exists || !winner?.exists || winner.path === null) return file;
  return { ...file, effective: false, shadowedBy: winner.path };
}

/** A project system prompt that is there but not loaded until the project is trusted. */
function waitedForTrust(file: ContextFileInfo, loaded: boolean): ContextFileInfo {
  if (loaded || !file.exists) return file;
  return { ...file, effective: false, requiresTrust: true };
}

/**
 * The entry a write names, with its path resolved and authorized. The path is
 * computed here, never taken from the request: a request can only ever reach the
 * seven files above. `path` is given with an error too, for the message.
 */
export function contextWriteTarget(
  id: unknown,
  agentDir: string,
  cwd: string | null,
  allowedRoots: Set<string>,
): ContextWriteTarget {
  if (!isContextFileId(id)) return { ok: false, error: "unknown-id" };
  const spec = CONTEXT_FILE_SPECS[id];
  const path = spec.path(agentDir, cwd);
  if (!path) return { ok: false, error: "no-cwd" };
  const problem = contextPathProblem(path, spec.scope, allowedRoots);
  if (problem) return { ok: false, error: problem, path };
  return { ok: true, path, scope: spec.scope, deletable: spec.deletable === true };
}

/**
 * Writes the file, creating the folders on the way. Unlike the `mcp.json`
 * writer this is not atomic or locked: these are markdown instruction files
 * that pi itself rewrites, and a lock would put Pi Web's editor at odds with
 * the user's own editor.
 */
export function writeContextFile(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, { encoding: "utf8" });
}

/** Removes the file; false when it was already gone. */
export function deleteContextFile(path: string): boolean {
  try {
    unlinkSync(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

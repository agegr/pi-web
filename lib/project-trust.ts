import { lstatSync, readdirSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import {
  hasTrustRequiringProjectResources,
  ProjectTrustStore,
  type ProjectTrustStoreEntry,
} from "@earendil-works/pi-coding-agent";
import type { FreshFolderTrustBreadth, ProjectTrustStatus } from "./api-types";
import { serializeByKey } from "./key-serializer";
import { isPathWithinRoots } from "./path-security";
import { samePath } from "./paths";

/** The folder as `trust.json` keys it: resolved, then its real path when it exists. */
function trustKeyPath(cwd: string): string {
  const resolved = resolve(cwd);
  try {
    return realpathSync(resolved);
  } catch {
    return resolved;
  }
}

function describeDecision(
  cwd: string,
  entry: ProjectTrustStoreEntry | null,
): Pick<ProjectTrustStatus, "decision" | "decisionPath" | "inherited"> {
  if (!entry) return { decision: null, inherited: false };
  return {
    decision: entry.decision,
    decisionPath: entry.path,
    inherited: !samePath(entry.path, trustKeyPath(cwd)),
  };
}

/**
 * Whether the project at `cwd` needs trust and is trusted, and the decision
 * that answers it. The store resolves the nearest decision, exact or
 * inherited from an ancestor, so `decision` and `decisionPath` tell exact
 * trust from trust through a parent, and no decision from an explicit `false`,
 * which `trusted` alone cannot. They are read for a folder that requires no
 * trust too: a fresh folder (no decision anywhere) and one inside a trusted
 * tree both report `trusted: true`. Such a folder never failed on an
 * unreadable `trust.json` before, and callers that only need `trusted` still
 * must not, so that failure is reported in `decisionError` instead.
 */
export function getProjectTrustStatus(cwd: string, agentDir: string): ProjectTrustStatus {
  const requiresTrust = Boolean(cwd) && hasTrustRequiringProjectResources(cwd);
  const trustStore = new ProjectTrustStore(agentDir);
  if (!requiresTrust) {
    if (!cwd) return { requiresTrust: false, trusted: true, decision: null, inherited: false };
    try {
      return { requiresTrust: false, trusted: true, ...describeDecision(cwd, trustStore.getEntry(cwd)) };
    } catch (error) {
      return {
        requiresTrust: false,
        trusted: true,
        decision: null,
        inherited: false,
        decisionError: error instanceof Error ? error.message : String(error),
      };
    }
  }

  const entry = trustStore.getEntry(cwd);
  return {
    requiresTrust: true,
    trusted: entry?.decision === true,
    ...describeDecision(cwd, entry),
  };
}

// Hot reload re-evaluates this module; globalThis keeps one warning per error per process.
const TRUST_READ_WARNINGS_KEY: symbol = Symbol.for("pi-web:project-trust-read-warnings");
const TRUST_READ_WARNINGS_MAX = 200;

/**
 * Whether the trust-gated configuration of the project at `cwd` (its
 * `.pi/mcp.json`) may be read right now: true only while the folder requires
 * trust and a decision, exact or inherited, trusts it. The folder's resources
 * and `trust.json` are read on every call, so a decision made anywhere (the
 * trust dialog, the pi CLI) and a `.pi/` resource that appeared since (`git
 * pull`, `pi mcp add -l`, the model's write tool) count at once. That is what
 * a per-wrapper `SettingsManager.isProjectTrusted()` cannot give: it is fixed
 * when the wrapper is built, `true` for a folder that needed no trust then,
 * and refreshed only on reload.
 *
 * A folder that requires no trust gets `false`, although its status reads
 * `trusted: true`. It has no `.pi/mcp.json` — that file alone makes a folder
 * require trust — so nothing is lost, while `true` would let the caller read a
 * file that landed between this check and its own read with no decision at all.
 *
 * A `trust.json` that cannot be read (unparsable, or still locked by another
 * process after the store's ~200 ms synchronous wait) counts as untrusted, with
 * one warning per distinct error.
 */
export function mayReadProjectConfigNow(cwd: string, agentDir: string): boolean {
  try {
    // Not getProjectTrustStatus(): that also reads trust.json for a folder that
    // requires no trust, which this answers false whatever its decision. Twice
    // per prompt, that would lock and read trust.json for nothing.
    if (!cwd || !hasTrustRequiringProjectResources(cwd)) return false;
    return new ProjectTrustStore(agentDir).get(cwd) === true;
  } catch (error) {
    const trustPath = join(agentDir, "trust.json");
    const message = error instanceof Error ? error.message : String(error);
    const store = globalThis as Record<symbol, Set<string> | undefined>;
    const warned = (store[TRUST_READ_WARNINGS_KEY] ??= new Set());
    const key = `${trustPath}\0${message}`;
    if (!warned.has(key)) {
      // The oldest goes, never the whole set, which would repeat every warning it held.
      if (warned.size >= TRUST_READ_WARNINGS_MAX) warned.delete(warned.values().next().value as string);
      warned.add(key);
      // A lock error does not name the file, so the path is always given.
      console.warn(`[pi-web] cannot read project trust from ${trustPath}; projects that need it count as untrusted meanwhile: ${message}`);
    }
    return false;
  }
}

export function trustProject(cwd: string, agentDir: string): ProjectTrustStatus {
  const status = getProjectTrustStatus(cwd, agentDir);
  if (!status.requiresTrust) return status;

  new ProjectTrustStore(agentDir).set(cwd, true);
  // Built from what was just written, not read back: a second read can fail
  // (the lock held past the store's wait), and the route would then report a
  // decision already on disk as a failure and skip rebuilding the cwd's wrappers.
  return { requiresTrust: true, trusted: true, decision: true, decisionPath: trustKeyPath(cwd), inherited: false };
}

/**
 * Reload options that gate project-local, trust-requiring resources — a
 * repository's `.pi/extensions`, project `.pi/settings.json` extension
 * entries, and `.agents/skills` — behind the SDK's project-trust store.
 *
 * Pi Web *executes* project extensions when it builds session services: their
 * factory runs on import and their `session_start` handlers run on startup.
 * Without a trust gate, merely opening an untrusted repository in Pi Web runs
 * repository-controlled code locally (issue #236). The SDK's resource loader
 * only imports project extensions once `resolveProjectTrust` resolves true, so
 * denying trust keeps them dormant.
 *
 * Pi Web and the `pi` CLI share the same trust store. Projects with gated
 * resources default to untrusted until either client records a trust decision.
 * Returns `undefined` when the project has no trust-requiring resources,
 * leaving ordinary projects on their existing load path.
 */
export function projectTrustReloadOptions(
  cwd: string,
  agentDir: string,
): { resolveProjectTrust: () => Promise<boolean> } | undefined {
  if (!cwd || !hasTrustRequiringProjectResources(cwd)) return undefined;
  const trustStore = new ProjectTrustStore(agentDir);
  return { resolveProjectTrust: async () => trustStore.get(cwd) === true };
}

// ---------------------------------------------------------------------------
// Trusting a fresh folder in the same step as writing to it (ADR 0006,
// "Fresh folders"). Writing `.pi/mcp.json` makes a folder require trust, and
// `POST /api/project-trust` refuses one that does not require it yet, so
// adding a project server to a folder with no decision would leave the server
// behind Restricted mode with no way to trust it from Pi Web.
// ---------------------------------------------------------------------------

/**
 * The SDK's `TRUST_REQUIRING_PROJECT_CONFIG_RESOURCES`
 * (`dist/core/trust-manager.js`), which it does not export: what under
 * `<cwd>/.pi` makes a folder require trust. `lib/project-trust.test.mjs`
 * compares it with the SDK's own list, so an upgrade that adds one fails there.
 */
export const TRUST_REQUIRING_PROJECT_ENTRIES = [
  "settings.json",
  "mcp.json",
  "extensions",
  "skills",
  "prompts",
  "themes",
  "SYSTEM.md",
  "APPEND_SYSTEM.md",
] as const;

function realPathOr(path: string): string {
  const resolved = resolve(path);
  try {
    return realpathSync(resolved);
  } catch {
    return resolved;
  }
}

/** Something is at `path`, read with `lstat`: a dangling link or a FIFO counts, though `existsSync` would say no. */
function somethingAt(path: string): boolean {
  try {
    lstatSync(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Whether anything at all sits where the SDK looks for trust-requiring
 * resources, by `lstat`: `<cwd>/.pi/<entry>` for each of
 * `TRUST_REQUIRING_PROJECT_ENTRIES`, a `.pi` that is a link to nothing, and
 * `.agents/skills` in the folder or an ancestor (not the home folder's own).
 * Stricter than `hasTrustRequiringProjectResources()`, whose `existsSync`
 * skips a link to nothing: such a link starts counting the moment its target
 * appears, after the folder was trusted as one with nothing in it.
 */
export function hasTrustRelevantEntries(cwd: string, home: string = process.env.HOME || homedir()): boolean {
  const folder = realPathOr(cwd);
  if (hasOwnTrustEntries(folder)) return true;
  const userSkills = join(realPathOr(home), ".agents", "skills");
  for (let current = folder; ; current = dirname(current)) {
    const skills = join(current, ".agents", "skills");
    if (!samePath(skills, userSkills) && somethingAt(skills)) return true;
    if (dirname(current) === current) return false;
  }
}

/** What under `folder/.pi` makes it require trust, or a `.pi` that is a link to nothing, by `lstat`. */
function hasOwnTrustEntries(folder: string): boolean {
  const configDir = join(folder, ".pi");
  try {
    if (lstatSync(configDir).isSymbolicLink() && realPathOr(configDir) === configDir) return true;
  } catch {
    // No `.pi`.
  }
  return TRUST_REQUIRING_PROJECT_ENTRIES.some((entry) => somethingAt(join(configDir, entry)));
}

/** How many levels below a fresh folder `findInheritingTrustProject()` looks. */
export const NESTED_PROJECT_SCAN_DEPTH = 4;
/** How many folders it reads before it stops and refuses the step, since it cannot tell. */
export const NESTED_PROJECT_SCAN_MAX_FOLDERS = 2000;
/** Never descended into: dependencies and history hold no project, and `.pi` / `.agents` are checked, not walked. */
const NESTED_PROJECT_SCAN_SKIP = new Set(["node_modules", ".git", ".pi", ".agents"]);

/**
 * A folder below `cwd` that would inherit a decision trusting `cwd`: one with
 * resources that need trust (`.pi/<entry>` for each of
 * `TRUST_REQUIRING_PROJECT_ENTRIES`, a `.pi` that is a link to nothing, or
 * `.agents/skills`, all by `lstat`) and no decision of its own or between it
 * and `cwd`. An exact decision below wins over the new one anyway. Fresh
 * folders are mostly containers (`~/work`, `~/code`, a dated `~/pi-cwd`
 * folder), which often hold repositories Pi Web has never opened, and
 * trusting the container would load such a repository's `.pi/extensions` and
 * connect its `.pi/mcp.json` with no dialog the first time it is opened.
 *
 * Breadth first, `NESTED_PROJECT_SCAN_DEPTH` levels deep, never through a
 * link, `node_modules` or `.git`. Past `NESTED_PROJECT_SCAN_MAX_FOLDERS`
 * folders read it answers `too-many-folders`, refusing what it could not
 * check. A `trust.json` that cannot be read counts a found project as having
 * no decision. Folders deeper than the scan are not looked at.
 */
export function findInheritingTrustProject(cwd: string, agentDir: string): FreshFolderTrustBreadth | undefined {
  const folder = realPathOr(cwd);
  let store: ProjectTrustStore | undefined;
  const hasDecision = (path: string): boolean => {
    try {
      store ??= new ProjectTrustStore(agentDir);
      return store.getEntry(path) !== null;
    } catch {
      return false;
    }
  };
  let read = 0;
  let level = [folder];
  for (let depth = 0; depth <= NESTED_PROJECT_SCAN_DEPTH && level.length > 0; depth += 1) {
    const next: string[] = [];
    for (const dir of level) {
      if (read >= NESTED_PROJECT_SCAN_MAX_FOLDERS) return { kind: "too-many-folders", path: folder };
      read += 1;
      let names: Set<string>;
      let children: string[] = [];
      try {
        const entries = readdirSync(dir, { withFileTypes: true });
        names = new Set(entries.map((entry) => entry.name));
        if (depth < NESTED_PROJECT_SCAN_DEPTH) {
          children = entries
            .filter((entry) => entry.isDirectory() && !NESTED_PROJECT_SCAN_SKIP.has(entry.name))
            .map((entry) => join(dir, entry.name));
        }
      } catch {
        // Unreadable: nothing below it can be told, nor can a session read it.
        continue;
      }
      // `cwd` itself was checked before (`hasTrustRelevantEntries()`).
      if (depth > 0) {
        const needsTrust = (names.has(".pi") && hasOwnTrustEntries(dir)) || (names.has(".agents") && somethingAt(join(dir, ".agents", "skills")));
        if (needsTrust && !hasDecision(dir)) return { kind: "contains-project", path: dir };
      }
      next.push(...children);
    }
    level = next;
  }
  return undefined;
}

/** `target` is `root` or inside it. */
function within(target: string, root: string): boolean {
  return isPathWithinRoots(target, new Set([root]));
}

/**
 * Why trusting `cwd` would trust more than the one folder, or undefined when
 * it would not. A decision is inherited by every folder below it, so Pi Web
 * never trusts by itself the home folder, a filesystem root, a folder that
 * holds the home folder or Pi's agent folder, one that holds another folder
 * Pi Web knows (`knownFolders`: the folders sessions ran in, their projects,
 * and folders chosen in Pi Web, which is what the allowed file roots hold),
 * or one that holds a project with no decision that needs trust
 * (`findInheritingTrustProject()`). Paths are compared by real path.
 */
export function freshFolderTrustBreadth(
  cwd: string,
  options: { agentDir: string; knownFolders: Iterable<string>; home?: string },
): FreshFolderTrustBreadth | undefined {
  const folder = realPathOr(cwd);
  if (dirname(folder) === folder) return { kind: "root", path: folder };
  const home = realPathOr(options.home ?? (process.env.HOME || homedir()));
  if (samePath(folder, home)) return { kind: "home", path: folder };
  if (within(home, folder)) return { kind: "contains-home", path: home };
  const agentDir = realPathOr(options.agentDir);
  if (within(agentDir, folder)) return { kind: "contains-agent-dir", path: agentDir };
  for (const known of options.knownFolders) {
    const knownFolder = realPathOr(known);
    if (!samePath(knownFolder, folder) && within(knownFolder, folder)) return { kind: "contains-folder", path: knownFolder };
  }
  return findInheritingTrustProject(folder, options.agentDir);
}

export type FreshFolderTrustResult<T> =
  /** Trusted, then written; `status` is the folder's trust as written. */
  | { ok: true; value: T; status: ProjectTrustStatus }
  /** Trusting it would trust more than the folder; nothing was written. */
  | { ok: false; reason: "trust-too-broad"; breadth: FreshFolderTrustBreadth; error: string }
  /** Not fresh anymore (resources that need trust, or a decision here or above); nothing was written. */
  | { ok: false; reason: "folder-not-fresh"; status?: ProjectTrustStatus; error: string }
  /** `trust.json` could not be read or written (unparsable, or locked by another process); nothing was written. */
  | { ok: false; reason: "trust-unreadable"; error: string }
  /**
   * `write` threw after the folder was trusted. The decision was taken back
   * unless `rollbackError` says why it could not be, in which case the folder
   * stays trusted (`status`).
   */
  | { ok: false; reason: "write-failed"; writeError: unknown; rollbackError?: string; status?: ProjectTrustStatus };

// Route handlers are bundled separately and hot reload re-evaluates modules; globalThis keeps one chain per folder per process.
const FRESH_TRUST_LOCKS_KEY: symbol = Symbol.for("pi-web:fresh-folder-trust-locks");

/** Runs `task` after every earlier task for the same folder has settled. */
function serializeForFolder<T>(key: string, task: () => Promise<T>): Promise<T> {
  return serializeByKey(FRESH_TRUST_LOCKS_KEY, key, task);
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Trusts a fresh folder and then runs `write` (which makes it require trust,
 * such as adding a server to its `.pi/mcp.json`), as one step. Requests for
 * the same folder run one at a time (a per-folder chain on globalThis), and
 * inside it the folder is checked again: no trust-requiring entry by `lstat`
 * (`hasTrustRelevantEntries()`), no decision for it or an ancestor, and no
 * project below it that would inherit the decision (`findInheritingTrustProject()`). A
 * folder that changed since the panel offered the step (a `git pull` that
 * brought `.pi/extensions`, a trust given elsewhere) is refused with its new
 * status: trusting it now would also trust what arrived, unseen.
 *
 * Trust comes first, then the write: the likelier failure, a `trust.json`
 * that is locked or unparsable, then happens before anything is written, and
 * the state in between (trusted, with nothing that needs trust) changes
 * nothing. A failed write takes the decision back (`set(cwd, null)`), which
 * removes exactly the key this call wrote: the check found no decision for the
 * folder or above. A step that waits for the folder gets its turn once the
 * earlier one has finished or been undone, and checks the folder as that left
 * it: unchained, it would find the earlier step's decision while that write
 * was still under way and be refused, even when the write then failed and the
 * decision was taken back. The pi CLI is not serialized against, so it can
 * still add resources between the check and the trust.
 *
 * No session is rebuilt and none needs to be idle, unlike
 * `POST /api/project-trust`: a wrapper opened in a folder that required no
 * trust was built with `projectTrusted` true and found no project extensions
 * to load, and its MCP host reads trust afresh before every prompt
 * (`mayReadProjectConfigNow()`), so the new server connects at its next one.
 */
export async function trustFreshFolderAndWrite<T>(
  cwd: string,
  agentDir: string,
  write: () => Promise<T> | T,
  options: { knownFolders: Iterable<string>; home?: string },
): Promise<FreshFolderTrustResult<T>> {
  const breadth = freshFolderTrustBreadth(cwd, { agentDir, knownFolders: options.knownFolders, home: options.home });
  if (breadth) {
    return { ok: false, reason: "trust-too-broad", breadth, error: `Trusting ${cwd} would also trust ${breadth.path}` };
  }
  const key = trustKeyPath(cwd);
  return serializeForFolder(key, async (): Promise<FreshFolderTrustResult<T>> => {
    const store = new ProjectTrustStore(agentDir);
    const notFresh = (error: string): FreshFolderTrustResult<T> => {
      let status: ProjectTrustStatus | undefined;
      try {
        status = getProjectTrustStatus(cwd, agentDir);
      } catch {
        // Unknown: the caller reads it again.
      }
      return { ok: false, reason: "folder-not-fresh", ...(status ? { status } : {}), error };
    };
    if (hasTrustRequiringProjectResources(cwd) || hasTrustRelevantEntries(cwd, options.home)) {
      return notFresh(`${cwd} now has project resources that need trust`);
    }
    let entry: ProjectTrustStoreEntry | null;
    try {
      entry = store.getEntry(cwd);
    } catch (error) {
      return { ok: false, reason: "trust-unreadable", error: message(error) };
    }
    if (entry) return notFresh(`${entry.path} has a trust decision now`);
    // Again inside the chain: a `git clone` into the folder may have landed since the panel offered the step.
    const nested = findInheritingTrustProject(cwd, agentDir);
    if (nested) return { ok: false, reason: "trust-too-broad", breadth: nested, error: `Trusting ${cwd} would also trust ${nested.path}` };
    try {
      store.set(cwd, true);
    } catch (error) {
      return { ok: false, reason: "trust-unreadable", error: message(error) };
    }
    const trusted: ProjectTrustStatus = { requiresTrust: true, trusted: true, decision: true, decisionPath: key, inherited: false };
    let value: T;
    try {
      value = await write();
    } catch (writeError) {
      try {
        store.set(cwd, null);
        return { ok: false, reason: "write-failed", writeError };
      } catch (rollbackError) {
        console.warn(`[pi-web] could not take back the trust given to ${cwd} after a failed write: ${message(rollbackError)}`);
        return { ok: false, reason: "write-failed", writeError, rollbackError: message(rollbackError), status: trusted };
      }
    }
    // Built from what was written, as trustProject() does: a second read can fail on the lock.
    return { ok: true, value, status: { ...trusted, requiresTrust: hasTrustRequiringProjectResources(cwd) } };
  });
}

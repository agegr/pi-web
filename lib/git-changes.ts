import fs from "fs";
import path from "path";
import { TEXT_PREVIEW_MAX_BYTES } from "./file-types";
import type {
  GitFileDiffResponse,
  GitFileStatus,
  GitStatusResponse,
} from "./git-types";
import {
  classifyGitStatus,
  parseGitPorcelainV1,
  type GitPorcelainEntry,
} from "./git-status";
import { runGit } from "./git-process";
import { projectIdentityKey } from "./project-identity";
import { resolveProject } from "./worktree";
const GIT_TIMEOUT_MS = 10_000;
const GIT_STATUS_MAX_BUFFER = 8 * 1024 * 1024;
const GIT_STATUS_CACHE_TTL_MS = 1_500;
const MAX_GIT_STATUS_CACHE_ENTRIES = 32;

interface RepositoryStatusSnapshot {
  entries: GitPorcelainEntry[];
  expiresAt: number;
}

interface GitStatusCacheEntry {
  result: GitStatusResponse;
  expiresAt: number;
}

interface GitStatusCacheState {
  repositories: Map<string, RepositoryStatusSnapshot>;
  repositoryPromises: Map<string, Promise<RepositoryStatusSnapshot>>;
  responses: Map<string, GitStatusCacheEntry>;
  responsePromises: Map<string, Promise<GitStatusResponse>>;
  cwdRepositories: Map<string, string>;
}

declare global {
  var __piGitStatusCache: GitStatusCacheState | undefined;
}

function cacheState(): GitStatusCacheState {
  if (!globalThis.__piGitStatusCache) {
    globalThis.__piGitStatusCache = {
      repositories: new Map(),
      repositoryPromises: new Map(),
      responses: new Map(),
      responsePromises: new Map(),
      cwdRepositories: new Map(),
    };
  }
  return globalThis.__piGitStatusCache;
}

async function git(cwd: string, args: string[], maxBuffer = GIT_STATUS_MAX_BUFFER): Promise<string> {
  return runGit(cwd, args, { timeoutMs: GIT_TIMEOUT_MS, maxBuffer });
}

function touchBounded<K, V>(cache: Map<K, V>, key: K, value: V): void {
  cache.delete(key);
  cache.set(key, value);
  while (cache.size > MAX_GIT_STATUS_CACHE_ENTRIES) {
    const oldest = cache.keys().next().value as K | undefined;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

function isWithinPath(parent: string, target: string): boolean {
  const relative = path.relative(path.resolve(parent), path.resolve(target));
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

function toGitPath(filePath: string): string {
  return filePath.split(path.sep).join("/");
}

async function readStatusEntries(repositoryRoot: string): Promise<GitPorcelainEntry[]> {
  const output = await git(repositoryRoot, [
    "status",
    "--porcelain=v1",
    "-z",
    "--untracked-files=all",
  ]);
  return parseGitPorcelainV1(output);
}

async function getRepositoryStatusSnapshot(
  repositoryRoot: string,
  force = false,
): Promise<RepositoryStatusSnapshot> {
  const key = projectIdentityKey(repositoryRoot);
  const state = cacheState();
  const cached = state.repositories.get(key);
  if (!force && cached && cached.expiresAt > Date.now()) {
    touchBounded(state.repositories, key, cached);
    return cached;
  }
  const existing = state.repositoryPromises.get(key);
  if (existing) return existing;

  const loadPromise = readStatusEntries(repositoryRoot).then((entries) => {
    const snapshot = { entries, expiresAt: Date.now() + GIT_STATUS_CACHE_TTL_MS };
    touchBounded(state.repositories, key, snapshot);
    return snapshot;
  });
  const trackedPromise = loadPromise.finally(() => {
    if (state.repositoryPromises.get(key) === trackedPromise) {
      state.repositoryPromises.delete(key);
    }
  });
  state.repositoryPromises.set(key, trackedPromise);
  return trackedPromise;
}

async function readTrackedLineStats(
  repositoryRoot: string,
  cwd: string,
): Promise<{ additions: number; deletions: number }> {
  const relativeCwd = toGitPath(path.relative(repositoryRoot, cwd));
  const pathspec = relativeCwd || ".";
  try {
    const output = await git(repositoryRoot, [
      "diff",
      "--no-color",
      "--no-ext-diff",
      "--numstat",
      "HEAD",
      "--",
      pathspec,
    ]);
    let additions = 0;
    let deletions = 0;
    for (const line of output.split(/\r?\n/)) {
      if (!line) continue;
      const [added, deleted] = line.split("\t", 2);
      const addedCount = Number(added);
      const deletedCount = Number(deleted);
      if (Number.isInteger(addedCount)) additions += addedCount;
      if (Number.isInteger(deletedCount)) deletions += deletedCount;
    }
    return { additions, deletions };
  } catch {
    return { additions: 0, deletions: 0 };
  }
}

function countUntrackedTextLines(filePath: string): number {
  try {
    const stat = fs.lstatSync(filePath);
    if (!stat.isFile() || stat.size > TEXT_PREVIEW_MAX_BYTES) return 0;
    const content = fs.readFileSync(filePath);
    if (hasNullByte(content) || content.length === 0) return 0;
    const text = content.toString("utf8");
    return text.endsWith("\n") ? text.split("\n").length - 1 : text.split("\n").length;
  } catch {
    return 0;
  }
}

function nonRepositoryStatus(): GitStatusResponse {
  return {
    isGitRepository: false,
    repositoryRoot: null,
    files: [],
    additions: 0,
    deletions: 0,
  };
}

async function loadGitStatus(cwd: string, repositoryRoot: string, force: boolean): Promise<GitStatusResponse> {
  const [snapshot, trackedLineStats] = await Promise.all([
    getRepositoryStatusSnapshot(repositoryRoot, force),
    readTrackedLineStats(repositoryRoot, cwd),
  ]);
  const files = snapshot.entries.flatMap((entry): GitFileStatus[] => {
    const filePath = path.resolve(repositoryRoot, entry.path);
    if (!isWithinPath(cwd, filePath)) return [];
    const classified = classifyGitStatus(entry);
    return [{
      filePath,
      ...classified,
      indexStatus: entry.indexStatus,
      worktreeStatus: entry.worktreeStatus,
    }];
  });
  const untrackedAdditions = files.reduce(
    (total, file) => total + (file.status === "untracked" ? countUntrackedTextLines(file.filePath) : 0),
    0,
  );
  return {
    isGitRepository: true,
    repositoryRoot,
    files,
    additions: trackedLineStats.additions + untrackedAdditions,
    deletions: trackedLineStats.deletions,
  };
}

export async function getGitStatus(
  cwd: string,
  options: { force?: boolean } = {},
): Promise<GitStatusResponse> {
  const cwdKey = projectIdentityKey(path.resolve(cwd));
  const state = cacheState();
  const cached = state.responses.get(cwdKey);
  if (!options.force && cached && cached.expiresAt > Date.now()) {
    touchBounded(state.responses, cwdKey, cached);
    return cached.result;
  }
  const existing = state.responsePromises.get(cwdKey);
  if (existing) return existing;

  const loadPromise = resolveProject(cwd).then(async (project) => {
    const repositoryRoot = project.repositoryRoot;
    if (!repositoryRoot) return nonRepositoryStatus();
    const repositoryKey = projectIdentityKey(repositoryRoot);
    touchBounded(state.cwdRepositories, cwdKey, repositoryKey);
    return loadGitStatus(cwd, repositoryRoot, options.force === true);
  }).then((result) => {
    touchBounded(state.responses, cwdKey, {
      result,
      expiresAt: Date.now() + GIT_STATUS_CACHE_TTL_MS,
    });
    return result;
  });
  const trackedPromise = loadPromise.finally(() => {
    if (state.responsePromises.get(cwdKey) === trackedPromise) {
      state.responsePromises.delete(cwdKey);
    }
  });
  state.responsePromises.set(cwdKey, trackedPromise);
  return trackedPromise;
}

export function invalidateGitStatus(cwd?: string): void {
  const state = cacheState();
  if (!cwd) {
    state.repositories.clear();
    state.responses.clear();
    state.cwdRepositories.clear();
    return;
  }
  const cwdKey = projectIdentityKey(path.resolve(cwd));
  state.responses.delete(cwdKey);
  const repositoryKey = state.cwdRepositories.get(cwdKey);
  if (repositoryKey) {
    state.repositories.delete(repositoryKey);
    for (const [candidateCwd, candidateRepository] of state.cwdRepositories) {
      if (candidateRepository === repositoryKey) state.responses.delete(candidateCwd);
    }
  }
}

function hasNullByte(content: Buffer): boolean {
  return content.includes(0);
}

function createAddedFilePatch(gitPath: string, content: string): string {
  const hasTrailingNewline = content.endsWith("\n");
  const lines = content.split("\n");
  if (hasTrailingNewline) lines.pop();
  const body = lines.map((line) => `+${line}`).join("\n");
  const noNewlineMarker = !hasTrailingNewline && lines.length > 0
    ? "\n\\ No newline at end of file"
    : "";
  return [
    `diff --git a/${gitPath} b/${gitPath}`,
    "new file mode 100644",
    "--- /dev/null",
    `+++ b/${gitPath}`,
    `@@ -0,0 +1,${lines.length} @@`,
    `${body}${noNewlineMarker}`,
  ].join("\n");
}

async function createTrackedFilePatch(
  repositoryRoot: string,
  relativePath: string,
  originalPath?: string,
): Promise<string | null> {
  const paths = originalPath && originalPath !== relativePath
    ? [originalPath, relativePath]
    : [relativePath];
  try {
    return await git(repositoryRoot, [
      "diff",
      "--no-color",
      "--no-ext-diff",
      "--unified=3",
      "HEAD",
      "--",
      ...paths,
    ], TEXT_PREVIEW_MAX_BYTES * 4);
  } catch {
    return null;
  }
}

export async function getGitFileDiff(
  cwd: string,
  filePath: string,
  options: { includePatch?: boolean } = {},
): Promise<GitFileDiffResponse> {
  const project = await resolveProject(cwd);
  const repositoryRoot = project.repositoryRoot;
  if (!repositoryRoot || !isWithinPath(repositoryRoot, filePath)) return { supported: false };

  const resolvedFilePath = path.resolve(filePath);
  const relativePath = toGitPath(path.relative(repositoryRoot, resolvedFilePath));
  let snapshot = await getRepositoryStatusSnapshot(repositoryRoot);
  let entry = snapshot.entries.find((candidate) => candidate.path === relativePath);
  if (!entry) {
    // A user can open Diff immediately after a write, inside the short status
    // TTL. Refresh once on a miss so caching never hides a newly changed file.
    snapshot = await getRepositoryStatusSnapshot(repositoryRoot, true);
    entry = snapshot.entries.find((candidate) => candidate.path === relativePath);
  }
  if (!entry) return { supported: false };

  const { status } = classifyGitStatus(entry);
  if (status === "deleted") {
    if (options.includePatch === false) return { supported: true, status };
    const patch = await createTrackedFilePatch(repositoryRoot, relativePath, entry.originalPath);
    if (!patch?.includes("\n@@ ")) return { supported: false };
    return { supported: true, status, patch };
  }

  let stat: fs.Stats;
  try {
    stat = fs.lstatSync(resolvedFilePath);
  } catch {
    return { supported: false };
  }
  if (!stat.isFile() || stat.size > TEXT_PREVIEW_MAX_BYTES) return { supported: false };
  if (options.includePatch === false) return { supported: true, status };

  const currentBuffer = fs.readFileSync(resolvedFilePath);
  if (hasNullByte(currentBuffer)) return { supported: false };
  const newContent = currentBuffer.toString("utf8");

  let patch: string;
  if (status === "untracked") {
    patch = createAddedFilePatch(relativePath, newContent);
  } else {
    const trackedPatch = await createTrackedFilePatch(repositoryRoot, relativePath, entry.originalPath);
    if (trackedPatch === null) {
      if (status !== "added") return { supported: false };
      patch = createAddedFilePatch(relativePath, newContent);
    } else {
      patch = trackedPatch;
    }
  }

  if (!patch.includes("\n@@ ")) return { supported: false };
  return { supported: true, status, patch };
}

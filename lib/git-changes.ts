import { execFile } from "child_process";
import fs from "fs";
import path from "path";
import { promisify } from "util";
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
import { resolveExistingPath } from "./paths";

const execFileAsync = promisify(execFile);
const GIT_TIMEOUT_MS = 10_000;
const GIT_STATUS_MAX_BUFFER = 8 * 1024 * 1024;

async function git(cwd: string, args: string[], maxBuffer = GIT_STATUS_MAX_BUFFER): Promise<string> {
  const { stdout } = await execFileAsync("git", ["-C", cwd, ...args], {
    timeout: GIT_TIMEOUT_MS,
    maxBuffer,
    env: { ...process.env, LC_ALL: "C" },
  });
  return stdout;
}

async function findRepositoryRoot(cwd: string): Promise<string | null> {
  try {
    return (await git(cwd, ["rev-parse", "--show-toplevel"])).trim() || null;
  } catch {
    return null;
  }
}

function isWithinPath(parent: string, target: string): boolean {
  return isRelativeWithin(path.relative(path.resolve(parent), path.resolve(target)));
}

/** Whether a `path.relative()` answer stays inside the folder it was taken from. */
function isRelativeWithin(relative: string): boolean {
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

function toGitPath(filePath: string): string {
  return filePath.split(path.sep).join("/");
}

async function readStatusEntries(
  repositoryRoot: string,
  gitConfig: readonly string[] = [],
): Promise<GitPorcelainEntry[]> {
  const output = await git(repositoryRoot, [
    ...gitConfig,
    "status",
    "--porcelain=v1",
    "-z",
    "--untracked-files=all",
  ]);
  return parseGitPorcelainV1(output);
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

const STATUS_ENTRIES_PER_TURN = 1000;
const UNTRACKED_READ_CONCURRENCY = 8;
const UNTRACKED_READ_CHUNK_BYTES = 64 * 1024;
const NEWLINE = 0x0a;

/**
 * An untracked text file's lines as a new-file diff counts them: one per "\n", plus
 * one for a last line without it. Empty, binary (a NUL byte), larger than the text
 * preview, and anything but a regular file count 0. Read in chunks into `buffer`,
 * up to the size lstat reported, as readFileSync read up to the size it found.
 */
async function countUntrackedTextLines(filePath: string, buffer: Buffer): Promise<number> {
  try {
    const stat = await fs.promises.lstat(filePath);
    if (!stat.isFile() || stat.size > TEXT_PREVIEW_MAX_BYTES || stat.size === 0) return 0;
    const handle = await fs.promises.open(filePath, "r");
    try {
      let total = 0;
      let newlines = 0;
      let lastByte = -1;
      while (total < stat.size) {
        const { bytesRead } = await handle.read(buffer, 0, Math.min(buffer.length, stat.size - total), null);
        if (bytesRead === 0) break;
        const chunk = buffer.subarray(0, bytesRead);
        if (hasNullByte(chunk)) return 0;
        for (let index = chunk.indexOf(NEWLINE); index !== -1; index = chunk.indexOf(NEWLINE, index + 1)) newlines++;
        lastByte = chunk[bytesRead - 1];
        total += bytesRead;
      }
      if (total === 0) return 0;
      return lastByte === NEWLINE ? newlines : newlines + 1;
    } finally {
      await handle.close();
    }
  } catch {
    return 0;
  }
}

// Async and a few files at a time: tens of thousands of untracked files read
// synchronously held the server's event loop, every stream and request, for
// seconds (#1584). Same counts, no cache.
async function countUntrackedLines(filePaths: readonly string[]): Promise<number> {
  let next = 0;
  let total = 0;
  const worker = async () => {
    const buffer = Buffer.allocUnsafe(UNTRACKED_READ_CHUNK_BYTES);
    while (next < filePaths.length) {
      const lines = await countUntrackedTextLines(filePaths[next++], buffer);
      total += lines;
    }
  };
  await Promise.all(Array.from({ length: Math.min(UNTRACKED_READ_CONCURRENCY, filePaths.length) }, worker));
  return total;
}

export async function getGitStatus(cwd: string): Promise<GitStatusResponse> {
  const repositoryRoot = await findRepositoryRoot(cwd);
  if (!repositoryRoot) {
    return {
      isGitRepository: false,
      repositoryRoot: null,
      files: [],
      additions: 0,
      deletions: 0,
    };
  }

  // Git names the repository by its real path, while the cwd may reach it through a
  // link (`/tmp` and `/var/folders/…` are links on macOS): compare real paths, and
  // report each file under the cwd as given, the way the file tree lists it.
  const realRoot = resolveExistingPath(repositoryRoot);
  const realCwd = resolveExistingPath(cwd);
  const [entries, trackedLineStats] = await Promise.all([
    readStatusEntries(repositoryRoot),
    readTrackedLineStats(realRoot, realCwd),
  ]);
  const files: GitFileStatus[] = [];
  for (let index = 0; index < entries.length; index++) {
    // Tens of thousands of paths take long enough to stall the server on their own.
    if (index > 0 && index % STATUS_ENTRIES_PER_TURN === 0) await yieldToEventLoop();
    const entry = entries[index];
    const relative = path.relative(realCwd, path.resolve(realRoot, entry.path));
    if (!isRelativeWithin(relative)) continue;
    files.push({
      filePath: path.join(cwd, relative),
      ...classifyGitStatus(entry),
      indexStatus: entry.indexStatus,
      worktreeStatus: entry.worktreeStatus,
    });
  }
  const untrackedAdditions = await countUntrackedLines(
    files.flatMap((file) => (file.status === "untracked" ? [file.filePath] : [])),
  );

  return {
    isGitRepository: true,
    repositoryRoot,
    files,
    additions: trackedLineStats.additions + untrackedAdditions,
    deletions: trackedLineStats.deletions,
  };
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
  gitConfig: readonly string[] = [],
): Promise<string | null> {
  const paths = originalPath && originalPath !== relativePath
    ? [originalPath, relativePath]
    : [relativePath];
  try {
    return await git(repositoryRoot, [
      ...gitConfig,
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

// The file's own repository, not the cwd's: a session may start in a plain folder
// holding several repositories. A deleted file's folder may be gone too, so start
// from its nearest existing ancestor; fall back to the cwd.
async function findFileRepositoryRoot(cwd: string, filePath: string): Promise<string | null> {
  let directory = path.dirname(path.resolve(filePath));
  while (!fs.existsSync(directory)) {
    const parent = path.dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }
  return (await findRepositoryRoot(directory)) ?? (await findRepositoryRoot(cwd));
}

export async function getGitFileDiff(cwd: string, filePath: string): Promise<GitFileDiffResponse> {
  const repositoryRoot = await findFileRepositoryRoot(cwd, filePath);
  if (!repositoryRoot) return { supported: false };
  // Git names the repository by its real path, while the file and the cwd may be named
  // through a link: compare real paths. A file whose real path leaves the repository
  // stays out; the route has already checked that real path against the allowed roots.
  const realRoot = resolveExistingPath(repositoryRoot);
  const realFilePath = resolveExistingPath(filePath);
  if (!isWithinPath(realRoot, realFilePath)) return { supported: false };
  // Reading the index runs a repository-configured fsmonitor hook. Opening a
  // file in another checkout (one nested in the cwd, say) must not run its hook,
  // as expanding that folder in the file tree does not (lib/file-tree-visibility.ts);
  // the cwd's own repository keeps its fsmonitor.
  const gitConfig = isWithinPath(realRoot, resolveExistingPath(cwd)) ? [] : ["-c", "core.fsmonitor=false"];

  const resolvedFilePath = path.resolve(filePath);
  const relativePath = toGitPath(path.relative(realRoot, realFilePath));
  const entries = await readStatusEntries(repositoryRoot, gitConfig);
  const entry = entries.find((candidate) => candidate.path === relativePath);
  if (!entry) return { supported: false };

  const { status } = classifyGitStatus(entry);
  if (status === "deleted") {
    const patch = await createTrackedFilePatch(repositoryRoot, relativePath, entry.originalPath, gitConfig);
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

  const currentBuffer = fs.readFileSync(resolvedFilePath);
  if (hasNullByte(currentBuffer)) return { supported: false };
  const newContent = currentBuffer.toString("utf8");

  let patch: string;
  if (status === "untracked") {
    patch = createAddedFilePatch(relativePath, newContent);
  } else {
    const trackedPatch = await createTrackedFilePatch(repositoryRoot, relativePath, entry.originalPath, gitConfig);
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

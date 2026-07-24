import { execFile } from "child_process";
import { createHash, randomUUID } from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { promisify } from "util";
import type { GitReviewDecision, GitReviewFile, GitReviewHunk, GitReviewResponse } from "./git-types";

const execFileAsync = promisify(execFile);
const GIT_TIMEOUT_MS = 20_000;
const GIT_MAX_BUFFER = 32 * 1024 * 1024;
const REVIEW_TTL_MS = 60 * 60 * 1000;
const MAX_REVIEWS = 64;
const MAX_REVIEW_FILES = 200;
const MAX_FILE_PATCH_BYTES = 2 * 1024 * 1024;
const MAX_REVIEW_PATCH_BYTES = 8 * 1024 * 1024;
const MAX_RENDER_HUNKS = 500;
const MAX_RENDER_LINES = 20_000;
const HASH_CHUNK_BYTES = 1024 * 1024;

type FinalDecision = Exclude<GitReviewDecision, "pending" | "mixed">;
type StoredHunk = GitReviewHunk & { patch: string };
type StoredFile = Omit<GitReviewFile, "hunks"> & {
  hunks: StoredHunk[];
  patch: string;
  paths: string[];
  fingerprints: Map<string, string>;
};
type StoredReview = {
  id: string;
  runId: number;
  cwd: string;
  repositoryRoot: string;
  scope: string;
  workspaceGeneration: number;
  baseTree: string;
  postTree?: string;
  files?: StoredFile[];
  createdAt: number;
  activated: boolean;
  sealed: boolean;
  finished: boolean;
  revision: number;
  lock: Promise<void>;
};

declare global {
  var __piGitReviews: Map<string, StoredReview> | undefined;
  var __piGitReviewWorkspaceGenerations: Map<string, number> | undefined;
}

const reviews = globalThis.__piGitReviews ?? new Map<string, StoredReview>();
const workspaceGenerations = globalThis.__piGitReviewWorkspaceGenerations ?? new Map<string, number>();
globalThis.__piGitReviews = reviews;
globalThis.__piGitReviewWorkspaceGenerations = workspaceGenerations;
let registryLock: Promise<void> = Promise.resolve();

async function serialized<T>(getLock: () => Promise<void>, setLock: (lock: Promise<void>) => void, operation: () => Promise<T>): Promise<T> {
  const previous = getLock();
  let release!: () => void;
  const next = new Promise<void>((resolve) => { release = resolve; });
  setLock(next);
  await previous;
  try {
    return await operation();
  } finally {
    release();
  }
}

function withRegistryLock<T>(operation: () => Promise<T>): Promise<T> {
  return serialized(() => registryLock, (lock) => { registryLock = lock; }, operation);
}

function withReviewLock<T>(review: StoredReview, operation: () => Promise<T>): Promise<T> {
  return serialized(() => review.lock, (lock) => { review.lock = lock; }, operation);
}

function pruneReviews(): void {
  const cutoff = Date.now() - REVIEW_TTL_MS;
  for (const [id, review] of reviews) if (review.createdAt < cutoff) reviews.delete(id);
  while (reviews.size >= MAX_REVIEWS) {
    const ordered = [...reviews.values()].sort((a, b) => a.createdAt - b.createdAt);
    const victim = ordered.find((review) => review.sealed) ?? ordered[0];
    if (!victim) break;
    victim.sealed = true;
    reviews.delete(victim.id);
  }
}

async function git(cwd: string, args: string[], options: { indexFile?: string; maxBuffer?: number } = {}): Promise<string> {
  const env: NodeJS.ProcessEnv = { ...process.env, LC_ALL: "C" };
  if (options.indexFile) env.GIT_INDEX_FILE = options.indexFile;
  const { stdout } = await execFileAsync("git", ["-C", cwd, ...args], {
    timeout: GIT_TIMEOUT_MS,
    maxBuffer: options.maxBuffer ?? GIT_MAX_BUFFER,
    env,
  });
  return stdout;
}

async function repositoryRoot(cwd: string): Promise<string | null> {
  try { return (await git(cwd, ["rev-parse", "--show-toplevel"])).trim() || null; }
  catch { return null; }
}

function toGitPath(value: string): string { return value.split(path.sep).join("/"); }

async function snapshotTree(root: string, scope: string): Promise<string> {
  const indexFile = path.join(os.tmpdir(), `pi-web-review-${randomUUID()}.index`);
  try {
    await git(root, ["read-tree", "HEAD"], { indexFile });
    await git(root, ["add", "-A", "--", scope], { indexFile });
    return (await git(root, ["write-tree"], { indexFile })).trim();
  } finally {
    fs.rmSync(indexFile, { force: true });
  }
}

function fingerprint(root: string, relativePath: string): string {
  const absolutePath = path.resolve(root, relativePath);
  try {
    const stat = fs.lstatSync(absolutePath);
    const hash = createHash("sha256");
    hash.update(`${stat.isSymbolicLink() ? "symlink" : stat.isFile() ? "file" : "other"}\0${stat.mode}\0`);
    if (stat.isSymbolicLink()) {
      hash.update(fs.readlinkSync(absolutePath));
    } else if (stat.isFile()) {
      const descriptor = fs.openSync(absolutePath, "r");
      const buffer = Buffer.allocUnsafe(HASH_CHUNK_BYTES);
      try {
        let bytesRead = 0;
        do {
          bytesRead = fs.readSync(descriptor, buffer, 0, buffer.length, null);
          if (bytesRead > 0) hash.update(buffer.subarray(0, bytesRead));
        } while (bytesRead > 0);
      } finally {
        fs.closeSync(descriptor);
      }
    } else {
      hash.update(`${stat.size}:${stat.mtimeMs}`);
    }
    return hash.digest("hex");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return "missing";
    throw error;
  }
}

export function splitGitReviewPatch(patch: string): { header: string; hunks: Array<{ header: string; patch: string; lines: string[] }> } {
  const lines = patch.replace(/\n$/, "").split("\n");
  const firstHunk = lines.findIndex((line) => line.startsWith("@@ "));
  if (firstHunk === -1) return { header: `${lines.join("\n")}\n`, hunks: [] };
  const fileHeader = lines.slice(0, firstHunk);
  const starts: number[] = [];
  for (let i = firstHunk; i < lines.length; i++) if (lines[i].startsWith("@@ ")) starts.push(i);
  return {
    header: `${fileHeader.join("\n")}\n`,
    hunks: starts.map((start, index) => {
      const hunkLines = lines.slice(start, starts[index + 1] ?? lines.length);
      return { header: hunkLines[0], patch: `${[...fileHeader, ...hunkLines].join("\n")}\n`, lines: hunkLines.slice(1) };
    }),
  };
}

function parseNameStatus(output: string): Array<{ status: string; oldPath?: string; path: string }> {
  const fields = output.split("\0").filter(Boolean);
  const result: Array<{ status: string; oldPath?: string; path: string }> = [];
  for (let i = 0; i < fields.length;) {
    const status = fields[i++];
    if (status.startsWith("R") || status.startsWith("C")) {
      const oldPath = fields[i++];
      const nextPath = fields[i++];
      if (oldPath && nextPath) result.push({ status, oldPath, path: nextPath });
    } else {
      const nextPath = fields[i++];
      if (nextPath) result.push({ status, path: nextPath });
    }
  }
  return result;
}

function statusKind(status: string): GitReviewFile["status"] {
  if (status.startsWith("A")) return "added";
  if (status.startsWith("D")) return "deleted";
  if (status.startsWith("R")) return "renamed";
  if (status.startsWith("C")) return "copied";
  if (status.startsWith("T")) return "type-changed";
  return "modified";
}

function aggregateDecision(hunks: StoredHunk[]): GitReviewDecision {
  const decisions = new Set(hunks.map((hunk) => hunk.decision));
  if (decisions.size === 1) return hunks[0]?.decision ?? "pending";
  return "mixed";
}

function publicReview(review: StoredReview): GitReviewResponse {
  return {
    id: review.id,
    runId: review.runId,
    revision: review.revision,
    repositoryRoot: review.repositoryRoot,
    files: (review.files ?? []).map((file): GitReviewFile => ({
      id: file.id, path: file.path, oldPath: file.oldPath, status: file.status,
      decision: file.decision, actionable: file.actionable, granular: file.granular, reason: file.reason,
      hunks: file.hunks.map((hunk): GitReviewHunk => ({
        id: hunk.id, header: hunk.header, lines: hunk.lines, decision: hunk.decision,
      })),
    })),
    sealed: review.sealed,
    finished: review.finished,
  };
}

function assertCurrent(review: StoredReview): void {
  if (!review.activated) {
    throw Object.assign(new Error("Review has not been attached to an accepted prompt"), { status: 409 });
  }
  if (review.sealed || workspaceGenerations.get(review.repositoryRoot) !== review.workspaceGeneration) {
    review.sealed = true;
    throw Object.assign(new Error("This review was sealed by a newer prompt"), { status: 409 });
  }
}

function assertMutableReview(id: string, revision: number): StoredReview {
  const review = reviews.get(id);
  if (!review) throw Object.assign(new Error("Review expired or not found"), { status: 404 });
  assertCurrent(review);
  if (!review.finished || !review.files) throw Object.assign(new Error("Review is not ready"), { status: 409 });
  if (review.revision !== revision) {
    throw Object.assign(new Error("Review changed in another request; reload before deciding"), { status: 409 });
  }
  return review;
}

function verifyFingerprints(review: StoredReview, files: StoredFile[]): void {
  for (const file of files) for (const relativePath of file.paths) {
    if (file.fingerprints.get(relativePath) !== fingerprint(review.repositoryRoot, relativePath)) {
      throw Object.assign(new Error(`File changed outside this review: ${relativePath}`), { status: 409 });
    }
  }
}

async function runGitApply(review: StoredReview, patchText: string, reverse: boolean, check: boolean): Promise<void> {
  if (!patchText) return;
  const patchFile = path.join(os.tmpdir(), `pi-web-review-${randomUUID()}.patch`);
  const args = ["apply", "--whitespace=nowarn", "--recount"];
  if (check) args.push("--check");
  if (reverse) args.push("--reverse");
  args.push(patchFile);
  try {
    fs.writeFileSync(patchFile, patchText);
    await git(review.repositoryRoot, args);
  } finally {
    fs.rmSync(patchFile, { force: true });
  }
}

function combinedPatch(entries: Array<{ file: StoredFile; patch: string }>): string {
  const byFile = new Map<string, { file: StoredFile; patches: string[] }>();
  for (const entry of entries) {
    const group = byFile.get(entry.file.id) ?? { file: entry.file, patches: [] };
    group.patches.push(entry.patch);
    byFile.set(entry.file.id, group);
  }
  return [...byFile.values()].map(({ file, patches }) => {
    if (!file.granular || patches.includes(file.patch)) return file.patch;
    const header = splitGitReviewPatch(file.patch).header;
    const bodies = patches.map((patchText) => patchText.slice(patchText.indexOf("@@ ")).trimEnd());
    return `${header}${bodies.join("\n")}\n`;
  }).join("");
}

async function applyTransaction(review: StoredReview, reversePatch: string, forwardPatch: string): Promise<void> {
  const applied: Array<{ patch: string; reverse: boolean }> = [];
  try {
    for (const step of [{ patch: reversePatch, reverse: true }, { patch: forwardPatch, reverse: false }]) {
      if (!step.patch) continue;
      await runGitApply(review, step.patch, step.reverse, true);
      await runGitApply(review, step.patch, step.reverse, false);
      applied.push(step);
    }
  } catch {
    let rollbackFailed = false;
    for (const step of applied.reverse()) {
      try {
        await runGitApply(review, step.patch, !step.reverse, true);
        await runGitApply(review, step.patch, !step.reverse, false);
      } catch { rollbackFailed = true; }
    }
    if (rollbackFailed) {
      review.sealed = true;
      throw Object.assign(new Error("Review operation failed and could not be fully rolled back; inspect the working tree"), { status: 500 });
    }
    throw Object.assign(new Error("The requested decisions no longer apply cleanly; no review changes were kept"), { status: 409 });
  }
}

function refreshFingerprints(review: StoredReview, files: StoredFile[]): void {
  for (const file of files) for (const relativePath of file.paths) {
    file.fingerprints.set(relativePath, fingerprint(review.repositoryRoot, relativePath));
  }
}

export async function startGitReview(cwd: string, runId = 0, deferredActivation = false): Promise<{ supported: boolean; reviewId?: string; reason?: string }> {
  const resolvedCwd = fs.realpathSync(cwd);
  const root = await repositoryRoot(resolvedCwd);
  if (!root) return { supported: false, reason: "Code review requires a Git repository" };
  const relativeScope = toGitPath(path.relative(root, resolvedCwd)) || ".";
  try {
    return await withRegistryLock(async () => {
      pruneReviews();
      // Snapshot before the prompt can run, but defer claiming the workspace
      // generation until RPC accepts that prompt. This prevents a losing
      // request from another tab from sealing the review of the prompt that
      // actually acquired the session.
      const baseTree = await snapshotTree(root, relativeScope);
      const id = randomUUID();
      let workspaceGeneration = 0;
      if (!deferredActivation) {
        workspaceGeneration = (workspaceGenerations.get(root) ?? 0) + 1;
        workspaceGenerations.set(root, workspaceGeneration);
        for (const review of reviews.values()) if (review.repositoryRoot === root) review.sealed = true;
      }
      reviews.set(id, {
        id, runId, cwd: resolvedCwd, repositoryRoot: root, scope: relativeScope, workspaceGeneration, baseTree,
        createdAt: Date.now(), activated: !deferredActivation, sealed: false, finished: false, revision: 0, lock: Promise.resolve(),
      });
      return { supported: true, reviewId: id };
    });
  } catch (error) {
    const detail = error instanceof Error ? `: ${error.message}` : "";
    return { supported: false, reason: `Unable to snapshot this repository (an initial commit is required)${detail}` };
  }
}

export async function activateGitReview(id: string): Promise<void> {
  const review = reviews.get(id);
  if (!review) throw Object.assign(new Error("Review expired or not found"), { status: 404 });
  await withRegistryLock(() => withReviewLock(review, async () => {
    if (review.sealed) throw Object.assign(new Error("Review was cancelled before prompt acceptance"), { status: 409 });
    if (review.activated) return;
    const generation = (workspaceGenerations.get(review.repositoryRoot) ?? 0) + 1;
    workspaceGenerations.set(review.repositoryRoot, generation);
    for (const candidate of reviews.values()) {
      if (candidate.id !== review.id && candidate.repositoryRoot === review.repositoryRoot) candidate.sealed = true;
    }
    review.workspaceGeneration = generation;
    review.activated = true;
  }));
}

export async function finishGitReview(id: string): Promise<GitReviewResponse> {
  const review = reviews.get(id);
  if (!review) throw Object.assign(new Error("Review expired or not found"), { status: 404 });
  return withRegistryLock(() => withReviewLock(review, async () => {
    assertCurrent(review);
    if (review.finished) return publicReview(review);
    const postTree = await snapshotTree(review.repositoryRoot, review.scope);
    assertCurrent(review);
    review.postTree = postTree;
    const names = parseNameStatus(await git(review.repositoryRoot, [
      "diff", "--name-status", "-z", "--find-renames", review.baseTree, postTree, "--", review.scope,
    ]));
    if (names.length > MAX_REVIEW_FILES) {
      review.sealed = true;
      throw Object.assign(new Error(`Review exceeds the ${MAX_REVIEW_FILES}-file limit`), { status: 413 });
    }
    const files: StoredFile[] = [];
    let totalPatchBytes = 0;
    for (const name of names) {
      const paths = name.oldPath ? [name.oldPath, name.path] : [name.path];
      let patch = "";
      let oversized = false;
      try {
        patch = await git(review.repositoryRoot, [
          "diff", "--binary", "--full-index", "--no-color", "--no-ext-diff", "--unified=3", "--find-renames",
          review.baseTree, postTree, "--", ...paths,
        ], { maxBuffer: MAX_FILE_PATCH_BYTES + 1 });
      } catch { oversized = true; }
      const patchBytes = Buffer.byteLength(patch);
      if (patchBytes > MAX_FILE_PATCH_BYTES || totalPatchBytes + patchBytes > MAX_REVIEW_PATCH_BYTES) oversized = true;
      if (!oversized) totalPatchBytes += patchBytes;
      const parsed = splitGitReviewPatch(patch);
      const kind = statusKind(name.status);
      const binary = patch.includes("GIT binary patch") || patch.includes("Binary files ");
      const specialMode = /\b(?:120000|160000)\b/.test(parsed.header);
      const gitlink = /\b160000\b/.test(parsed.header);
      const hasFileMetadata = kind !== "modified" || specialMode || /^(?:new file mode|deleted file mode|old mode|new mode|rename |copy )/m.test(parsed.header);
      const renderLines = parsed.hunks.reduce((sum, hunk) => sum + hunk.lines.length, 0);
      const renderOversized = parsed.hunks.length > MAX_RENDER_HUNKS || renderLines > MAX_RENDER_LINES;
      const actionable = !oversized && !gitlink && patch.trim().length > 0;
      const granular = actionable && !binary && !hasFileMetadata && !renderOversized && parsed.hunks.length > 0;
      const reason = oversized ? "Change exceeds the safe review size limit"
        : gitlink ? "Submodule changes must be reviewed outside this panel"
        : !actionable ? "Git did not produce a safely applicable patch"
        : renderOversized ? "Change is too large for block review and is available at file level"
        : hasFileMetadata ? "File creation, deletion, rename, symlink, type, and mode changes are reviewed at file level"
        : binary ? "Binary changes are reviewed at file level"
        : parsed.hunks.length === 0 ? "This change is reviewed at file level" : undefined;
      files.push({
        id: randomUUID(), path: name.path, oldPath: name.oldPath, status: kind, decision: "pending",
        actionable, granular, reason,
        hunks: granular ? parsed.hunks.map((hunk, index): StoredHunk => ({
          id: `${index}`, header: hunk.header, lines: hunk.lines, decision: "pending", patch: hunk.patch,
        })) : [],
        patch: actionable ? patch : "", paths,
        fingerprints: new Map(paths.map((relativePath) => [relativePath, fingerprint(review.repositoryRoot, relativePath)])),
      });
    }
    assertCurrent(review);
    review.files = files;
    review.finished = true;
    return publicReview(review);
  }));
}

export async function decideGitReview(
  id: string,
  input: { decision: GitReviewDecision; revision: number; fileId?: string; hunkId?: string; all?: boolean },
): Promise<GitReviewResponse> {
  const review = assertMutableReview(id, input.revision);
  return withRegistryLock(() => withReviewLock(review, async () => {
    assertMutableReview(id, input.revision);
    if (input.decision !== "accepted" && input.decision !== "rejected") {
      throw Object.assign(new Error("Invalid decision"), { status: 400 });
    }
    const decision = input.decision as FinalDecision;
    const targets = input.all ? review.files!.filter((file) => file.actionable) : review.files!.filter((file) => file.id === input.fileId);
    if (targets.length === 0) throw Object.assign(new Error("Review item not found"), { status: 404 });
    verifyFingerprints(review, targets);

    const items: Array<{ file: StoredFile; hunk?: StoredHunk; current: GitReviewDecision }> = [];
    if (input.hunkId) {
      const file = targets[0];
      if (targets.length !== 1 || !file.granular) throw Object.assign(new Error("Hunk review is unavailable for this file"), { status: 400 });
      const hunk = file.hunks.find((candidate) => candidate.id === input.hunkId);
      if (!hunk) throw Object.assign(new Error("Hunk not found"), { status: 404 });
      items.push({ file, hunk, current: hunk.decision });
    } else {
      for (const file of targets) {
        if (file.granular) for (const hunk of file.hunks) items.push({ file, hunk, current: hunk.decision });
        else items.push({ file, current: file.decision });
      }
    }

    const reverseEntries = items.filter((item) => decision === "rejected" && item.current !== "rejected")
      .map((item) => ({ file: item.file, patch: item.hunk?.patch ?? item.file.patch }));
    const forwardEntries = items.filter((item) => decision === "accepted" && item.current === "rejected")
      .map((item) => ({ file: item.file, patch: item.hunk?.patch ?? item.file.patch }));
    await applyTransaction(review, combinedPatch(reverseEntries), combinedPatch(forwardEntries));

    for (const item of items) {
      if (item.hunk) item.hunk.decision = decision;
      else item.file.decision = decision;
    }
    for (const file of targets) if (file.granular) file.decision = aggregateDecision(file.hunks);
    refreshFingerprints(review, targets);
    review.revision += 1;
    return publicReview(review);
  }));
}

export function getGitReview(id: string): GitReviewResponse {
  const review = reviews.get(id);
  if (!review) throw Object.assign(new Error("Review expired or not found"), { status: 404 });
  return publicReview(review);
}

export function getGitReviewCwd(id: string): string {
  const review = reviews.get(id);
  if (!review) throw Object.assign(new Error("Review expired or not found"), { status: 404 });
  return review.cwd;
}

export async function cancelGitReview(id: string): Promise<void> {
  const review = reviews.get(id);
  if (!review) return;
  await withRegistryLock(() => withReviewLock(review, async () => { review.sealed = true; }));
}

export function resetGitReviewsForTests(): void {
  reviews.clear();
  workspaceGenerations.clear();
  registryLock = Promise.resolve();
}

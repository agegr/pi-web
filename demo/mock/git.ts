/**
 * Git working-tree view of the demo project: files the tutorial sessions
 * edited are "modified", files they created are "untracked".
 */
import type { GitFileDiffResponse, GitFileStatus, GitStatusResponse } from "@/lib/git-types";
import { originalText, projectFiles, readFileText } from "./files";
import { PROJECT_ROOT, WORKTREE_ROOT } from "./paths";
import { PROJECT_FILE_EDITS, PROJECT_FILE_OVERRIDES } from "./data/project-files";
import { diffOps, unifiedHunks } from "./diff";

export interface ChangedFile {
  path: string;
  status: "modified" | "untracked";
}

export async function changedFiles(): Promise<ChangedFile[]> {
  const files = await projectFiles(PROJECT_ROOT);
  const changes: ChangedFile[] = [];
  for (const { path } of PROJECT_FILE_EDITS) {
    if (await originalText(path) !== null) changes.push({ path, status: "modified" });
  }
  for (const path of Object.keys(PROJECT_FILE_OVERRIDES)) {
    if (files.some((file) => file.path === path)) changes.push({ path, status: "untracked" });
  }
  return changes.sort((a, b) => a.path.localeCompare(b.path));
}

async function patchFor(change: ChangedFile): Promise<{ patch: string; additions: number; deletions: number }> {
  const files = await projectFiles(PROJECT_ROOT);
  const file = files.find((candidate) => candidate.path === change.path);
  const current = file ? await readFileText(file) : "";
  if (change.status === "untracked") {
    const lines = current.replace(/\n$/, "").split("\n");
    return {
      patch: `diff --git a/${change.path} b/${change.path}\nnew file mode 100644\n--- /dev/null\n+++ b/${change.path}\n@@ -0,0 +1,${lines.length} @@\n${lines.map((line) => `+${line}`).join("\n")}`,
      additions: lines.length,
      deletions: 0,
    };
  }
  const before = (await originalText(change.path)) ?? current;
  const diff = unifiedHunks(diffOps(before, current), 3);
  return {
    patch: `diff --git a/${change.path} b/${change.path}\nindex 4be9cdb..6137e7a 100644\n--- a/${change.path}\n+++ b/${change.path}\n${diff.text}\n`,
    additions: diff.additions,
    deletions: diff.deletions,
  };
}

export async function gitStatus(cwd: string): Promise<GitStatusResponse> {
  if (cwd.startsWith(WORKTREE_ROOT)) {
    return { isGitRepository: true, repositoryRoot: WORKTREE_ROOT, files: [], additions: 0, deletions: 0 };
  }
  if (cwd !== PROJECT_ROOT && !cwd.startsWith(`${PROJECT_ROOT}/`)) {
    return { isGitRepository: false, repositoryRoot: null, files: [], additions: 0, deletions: 0 };
  }
  const changes = await changedFiles();
  let additions = 0;
  let deletions = 0;
  const files: GitFileStatus[] = [];
  for (const change of changes) {
    const patch = await patchFor(change);
    additions += patch.additions;
    deletions += patch.deletions;
    files.push(change.status === "modified"
      ? { filePath: `${PROJECT_ROOT}/${change.path}`, status: "modified", code: "M", indexStatus: " ", worktreeStatus: "M" }
      : { filePath: `${PROJECT_ROOT}/${change.path}`, status: "untracked", code: "U", indexStatus: "?", worktreeStatus: "?" });
  }
  return { isGitRepository: true, repositoryRoot: PROJECT_ROOT, files, additions, deletions };
}

export async function gitDiff(filePath: string): Promise<GitFileDiffResponse> {
  const relative = filePath.startsWith(`${PROJECT_ROOT}/`) ? filePath.slice(PROJECT_ROOT.length + 1) : null;
  const change = relative ? (await changedFiles()).find((candidate) => candidate.path === relative) : undefined;
  if (!change) return { supported: false };
  return { supported: true, status: change.status, patch: (await patchFor(change)).patch };
}

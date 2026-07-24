export type GitFileStatusKind =
  | "modified"
  | "added"
  | "deleted"
  | "renamed"
  | "untracked"
  | "conflict";

export interface GitFileStatus {
  filePath: string;
  status: GitFileStatusKind;
  code: "M" | "A" | "D" | "R" | "U" | "C";
  indexStatus: string;
  worktreeStatus: string;
}

export interface GitStatusResponse {
  isGitRepository: boolean;
  repositoryRoot: string | null;
  files: GitFileStatus[];
}

export interface GitFileDiffResponse {
  supported: boolean;
  status?: GitFileStatusKind;
  patch?: string;
}

export type GitReviewDecision = "pending" | "accepted" | "rejected" | "mixed";
export type GitReviewFileStatus = "modified" | "added" | "deleted" | "renamed" | "copied" | "type-changed";

export interface GitReviewHunk {
  id: string;
  header: string;
  lines: string[];
  decision: GitReviewDecision;
}

export interface GitReviewFile {
  id: string;
  path: string;
  oldPath?: string;
  status: GitReviewFileStatus;
  decision: GitReviewDecision;
  actionable: boolean;
  granular: boolean;
  reason?: string;
  hunks: GitReviewHunk[];
}

export interface GitReviewResponse {
  id: string;
  runId: number;
  revision: number;
  repositoryRoot: string;
  files: GitReviewFile[];
  sealed: boolean;
  finished: boolean;
}

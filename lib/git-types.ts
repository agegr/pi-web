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
  additions: number;
  deletions: number;
}

/** Lightweight repository identity used by the workspace footer. */
export interface GitWorkspaceResponse {
  isGitRepository: boolean;
  repositoryRoot: string | null;
  /** Null for non-repositories and detached HEADs. */
  branch: string | null;
}

export interface GitFileDiffResponse {
  supported: boolean;
  status?: GitFileStatusKind;
  patch?: string;
}

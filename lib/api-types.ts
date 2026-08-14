import type { ResourceDiagnostic } from "@earendil-works/pi-coding-agent";

export interface SkillSearchResult {
  package: string;
  installs: string;
  url: string;
}

export type SkillInstallScope = "global" | "project";

export interface SkillInstallInfo {
  package: string;
  scope: SkillInstallScope;
  source: string;
  sourceType?: string;
  skillsShUrl?: string;
  skillPath?: string;
  ref?: string;
  versionHash?: string;
  canCheckForUpdates: boolean;
}

export type SkillUpdateState =
  | "up-to-date"
  | "update-available"
  | "unsupported"
  | "error";

export interface SkillUpdateResult {
  package: string;
  scope: SkillInstallScope;
  state: SkillUpdateState;
  currentVersion?: string;
  latestVersion?: string;
  message?: string;
}

export interface SkillInfo {
  name: string;
  description: string;
  filePath: string;
  baseDir: string;
  disableModelInvocation: boolean;
  sourceInfo: {
    source?: string;
    scope?: string;
  };
  install?: SkillInstallInfo;
}

export interface SkillsResponse {
  skills: SkillInfo[];
  diagnostics: ResourceDiagnostic[];
  projectResourcesLoaded: boolean;
}

export interface ProjectTrustStatus {
  requiresTrust: boolean;
  trusted: boolean;
}

export interface AppUpdateResponse {
  currentVersion: string;
  latestVersion: string;
  updateAvailable: boolean;
  releaseUrl: string;
}

export type PluginScope = "global" | "project";
export type PluginResourceKind = "extension" | "skill" | "prompt" | "theme";

export interface PluginResourceCounts {
  extensions: number;
  skills: number;
  prompts: number;
  themes: number;
}

export interface PluginDiagnostic {
  type: "warning" | "error";
  message: string;
  source?: string;
  path?: string;
}

export interface PluginResourceInfo {
  kind: PluginResourceKind;
  name: string;
  path: string;
  relativePath: string;
}

export interface PluginPackageInfo {
  source: string;
  scope: PluginScope;
  filtered: boolean;
  disabled: boolean;
  installedPath?: string;
  packageName?: string;
  version?: string;
  configuredVersion?: string;
  counts: PluginResourceCounts;
  resources: PluginResourceInfo[];
  status: "loaded" | "installed" | "missing" | "disabled";
}

export interface PluginsResponse {
  packages: PluginPackageInfo[];
  totals: PluginResourceCounts;
  diagnostics: PluginDiagnostic[];
  projectResourcesLoaded: boolean;
}

// ============================================================================
// Subagent sessions
// ============================================================================

export type SubagentLifecycleState =
  | "starting"
  | "queued"
  | "running"
  | "needs_attention"
  | "paused"
  | "complete"
  | "stopped"
  | "failed"
  | "rejected"
  | "inactive";

export interface SubagentTreeNode {
  /** Durable session id; null for live-only runtime placeholders. */
  sessionId: string | null;
  /** Durable parent session id; the root session id for top-level nodes. */
  parentSessionId: string;
  runId: string;
  index?: number;
  agent: string;
  task: string;
  state: SubagentLifecycleState;
  activity?: string;
  startedAt?: number;
  elapsedMs?: number;
  canSteer: boolean;
  canInterrupt: boolean;
  canResume: boolean;
  children: SubagentTreeNode[];
}

export interface SubagentTreeResponse {
  rootSessionId: string;
  rpcAvailable: boolean;
  unavailableReason?: "not-installed" | "incompatible" | "offline";
  nodes: SubagentTreeNode[];
  polledAt: number;
}

export interface SubagentControlRequest {
  childSessionId: string;
  action: "steer" | "interrupt" | "resume";
  message?: string;
}

export interface SubagentControlResponse {
  success: true;
  data: {
    action: SubagentControlRequest["action"];
    childSessionId: string;
    tree?: SubagentTreeResponse;
  };
}

// ============================================================================
// Trajectory
// ============================================================================

export type {
  TrajectoryDetailLevel,
  TrajectoryRecordKind,
  TrajectoryStatus,
  TrajectoryTokenStats,
  TrajectoryStats,
  TrajectoryTurn,
  TrajectoryRequest,
  TrajectoryRecordView,
  TrajectoryResponse,
  TrajectoryUnsupportedResponse,
} from "./trajectory-types";

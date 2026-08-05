/** A discovery complaint surfaced next to the resources it affected. */
export interface ResourceDiagnostic {
  type: "error" | "warning" | "info";
  message: string;
  path?: string;
}

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

/** How a model role's value is scoped when written back to config. */
export type ModelRoleScope = "global" | "project";

export interface ModelRoleModelRef {
  provider: string;
  modelId: string;
  name?: string;
  /** Thinking level pinned by a `:level` suffix on the role's selector. */
  thinkingLevel?: string;
}

/**
 * One of omp's model roles as the browser sees it.
 *
 * omp assigns a model per scope of work — `default` for ordinary turns, `smol`
 * for cheap subagent work, `slow` for deep reasoning, `plan` for plan mode,
 * `commit` for changelogs, and so on — all stored in the `modelRoles` record in
 * `~/.omp/agent/config.yml`.
 */
export interface ModelRoleAssignment {
  /** Role id, e.g. `smol`. */
  role: string;
  /** Short uppercase chip omp renders next to the model name, e.g. `SMOL`. */
  tag?: string;
  /** Human label, e.g. `Fast`. */
  name: string;
  /** omp theme color name for the role chip. */
  color?: string;
  /** Built-in roles come from omp; anything else was added in config. */
  builtin: boolean;
  /** Functional but hidden from omp's own selector UI. */
  hidden: boolean;
  /** Raw configured selector, e.g. `anthropic/claude-sonnet-4-6:high`. */
  selector?: string;
  /** Which persisted layer supplies the effective value. */
  source: ModelRoleScope | "default";
  /** Full merge provenance, including runtime and config-overlay layers. */
  provenance: "runtime" | "overlay" | "project" | "global" | "default";
  /** The model the selector currently resolves to, when it resolves at all. */
  resolved?: ModelRoleModelRef;
  /** Resolver complaint, e.g. a selector that matches nothing available. */
  warning?: string;
}
export interface OmpWebReleaseInfo {
  version: string;
  tagName: string;
  name: string;
  body: string;
  htmlUrl: string;
  publishedAt: string | null;
}

export interface OmpWebPackageInfo {
  version: string;
}

export type OmpWebInstallPlanReason =
  | "disabled"
  | "latest-package-unavailable"
  | "current-version-unknown";

export interface OmpWebInstallPlan {
  canInstall: boolean;
  manager: "bun" | "npm";
  command: string;
  alternateCommand: string;
  packageVersion?: string;
  reason?: OmpWebInstallPlanReason;
  restartRequired: boolean;
}

export type OmpWebUpdateAvailability =
  | "up-to-date"
  | "installable"
  | "manual";

export interface OmpWebUpdateResponse {
  currentAppVersion: string;
  latestRelease: OmpWebReleaseInfo;
  latestPackage: OmpWebPackageInfo | null;
  updateAvailable: boolean;
  availability: OmpWebUpdateAvailability;
  install: OmpWebInstallPlan;
  checkedAt: string;
}

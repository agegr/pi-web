export interface ApiError {
  error: {
    code: string;
    message: string; // 可显示的本地化错误或安全摘要
    retryable: boolean; // 指读取/预检可重试；不授权自动重放写操作
    requestId: string;
    operationId?: string;
    field?: string;
    retryAfterSeconds?: number;
  };
}

export type Scope = "global" | "project";
export type Context = { cwd: string | null };
export type DomainId = "computing" | "finance" | "philosophy" | "psychology" | "metaphysics";
// 稳定领域 ID；运行时标签、顺序与类目来自已校验配置。
export type MetadataState = "pending" | "ready" | "unavailable" | "ambiguous";

export interface SourceSkill {
  canonicalSkillId: string; // 服务端规范化 provider+source+skill 标识
  provider: "skills.sh" | "skillsmp" | "agentskill.sh";
  package: string; // 兼容既有 owner/repo@skillName 语义，不作为 shell 文本执行
  name: string;
  description: string | null;
  source: string;
  sourceType: "github" | "other";
  sourceUrl: string | null;
  directoryUrl: string | null;
  installCount: { display: string; numeric: number | null } | null;
  repositoryStars?: number | null; // GitHub 仓库星标，不是安装量
  metadataState: MetadataState;
  classification: Classification; // 第 9 节；无映射为 unclassified
}

export interface VersionIdentity {
  value: string;
  kind: "git-commit" | "git-tree" | "skills-content-hash" | "provider-content-hash";
  label: string;
}

export interface Installation {
  installationId: string;
  classification: Classification; // 按可靠来源身份关联，不能按名称猜测
  canonicalSkillId: string | null;
  name: string;
  description: string | null;
  scope: Scope | "other" | "shared"; // other 自定义路径；shared 多范围共享；均非安装请求 scope
  contextId: string | null; // 项目实例上下文；全局/其他资源可为空
  source: string | null;
  managed: boolean;
  package: string | null;
  logicalPath: string;
  realPath: string;
  aliases: Array<{ path: string; scope: Scope | "other"; contextId: string | null; bindingId: string | null }>;
  managementBindings: Array<{
    bindingId: string;
    scope: Scope;
    contextId: string | null;
    package: string;
    source: string;
    sourceType: string | null;
    skillPath: string | null;
    ref: string | null;
    version: VersionIdentity | null;
    canCheckForUpdates: boolean;
  }>;
  managementBindingId: string | null; // 仅唯一管理绑定时设置；多绑定不任选一个
  revision: string; // 文件并发标识
  installedVersion: VersionIdentity | null; // 单绑定摘要；多绑定为 null，展开各 binding.version
  disableModelInvocation: boolean | null; // 无法解析则 null，禁止开关操作
  loadState: "effective" | "shadowed" | "excluded" | "untrusted" | "invalid" | "unknown";
  loadReason: string | null;
  capabilities: {
    readContent: boolean;
    setVisibility: boolean;
    checkUpdate: boolean;
    update: boolean;
    reasonByCapability: Record<string, string>;
  };
}

export interface Diagnostic {
  id: string;
  code: string;
  severity: "info" | "warning" | "error";
  message: string;
  installationIds: string[];
  paths: string[]; // 仅返回已授权可展示路径
  rawDetail: string | null;
}

export interface Inventory {
  taxonomyVersion: string;
  indexRevision: string;
  contextId: string; // 服务端规范化 cwd + 全局上下文的键
  revision: string;
  readAt: string;
  projectResourcesLoaded: boolean;
  installations: Installation[];
  diagnostics: Diagnostic[];
  coverage: {
    global: "complete" | "partial" | "unavailable";
    project: "complete" | "partial" | "untrusted" | "none" | "unavailable";
    description: string; // complete 仅指已授权配置范围，绝非整机
  };
}

export type DetailRequest =
  | { kind: "remote"; canonicalSkillId: string }
  | { kind: "installed"; installationId: string; cwd: string | null };

export type PlanRequest =
  | { kind: "install"; canonicalSkillId: string; cwd: string | null; scope: Scope }
  | { kind: "update"; installationId: string; cwd: string | null; expectedRevision: string };

export interface Plan {
  planId: string;
  operationId: string; // Reserved before submit so a lost acceptance response can be recovered by GET.
  classification: Classification;
  kind: "install" | "update";
  state: "ready" | "blocked";
  expiresAt: string;
  contextId: string;
  scope: Scope;
  skillName: string;
  source: string;
  target: { logicalPath: string; realPath: string | null; sharedAliases: string[] };
  currentVersion: VersionIdentity | null;
  observedSourceVersion: VersionIdentity | null;
  sourceVersionPinned: boolean; // 原生文件包固定预检内容；CLI 来源不承诺固定提交
  localChanges: "none" | "detected" | "unknown" | "not-applicable";
  expectedRevision: string | null;
  requiredAcknowledgements: Array<"overwrite-unknown-local-changes" | "affects-shared-file" | "trust-project-resources">;
  blockers: Array<{ code: string; message: string }>;
  notices: string[];
}

export interface Operation {
  operationId: string;
  kind: "install" | "update";
  state: "accepted" | "running" | "verifying" | "succeeded" | "failed" | "needs-review";
  contextId: string;
  projectLabel: string | null;
  scope: Scope;
  skillName: string;
  targetPath: string;
  createdAt: string;
  updatedAt: string;
  finishedAt: string | null;
  result: {
    installationId: string | null;
    actualVersion: VersionIdentity | null;
    visibilityPreserved: boolean | null;
    currentSourceStatus: "up-to-date" | "update-available" | "unchecked" | "error";
    reloadRequired: boolean;
  } | null;
  error: ApiError["error"] | null;
  outputExcerpt: string | null; // 限长、去控制字符和脱敏
  pollAfterMs: number | null; // 服务端配置给出建议；非后台自动写入
}

export interface CheckResult {
  installationId: string;
  basedOnRevision: string;
  state: "up-to-date" | "update-available" | "unsupported" | "error";
  currentVersion: VersionIdentity | null;
  sourceVersion: VersionIdentity | null;
  checkedAt: string;
  stale: boolean;
  reasonCode: string | null;
  message: string | null;
}
// { results: CheckResult[], checkedAt: string, diagnostics: Diagnostic[] }

export interface Taxonomy {
  version: string;
  indexRevision: string;
  domains: Array<{
    id: DomainId; label: string; order: number; description: string;
    categories: Array<{ id: string; label: string; order: number }>;
    quickQueries: string[];
  }>;
}
export interface Assignment {
  canonicalSkillId: string;
  domainId: DomainId;
  categoryId: string | null;
  evidence: { sourceUrl: string; relativePath: string | null; excerpt: string | null; verifiedAt: string };
  // sourceUrl 必须关联真实来源技能；非搜索关键词推断
}
export interface Classification {
  origin?: "personal";
  personalRevision?: string;
  state: "classified" | "unclassified";
  assignments: Array<{ domainId: DomainId; categoryId: string | null }>;
  taxonomyVersion: string;
  indexRevision: string;
}
export interface ClassificationSummary {
  classifiedUnique: number;
  unclassifiedUnique: number;
  currentDomainUnique: number | null;
  outsideCurrentDomainUnique: number | null;
}
export interface QueryCoverage {
  kind: "local-index" | "external-result-set";
  taxonomyVersion: string;
  indexRevision: string;
  indexedUnique: number | null; // 当前本地索引去重总量；分类不可用时未知
  totalMatched: number | null; // local-index 完整匹配数；外部为 null
  returnedCount: number;
  truncated: boolean;
  marketTotal: null; // 没有全市场已验证数量
  completeWithinIndex: boolean | null; // 外部为 null
  description: string;
}

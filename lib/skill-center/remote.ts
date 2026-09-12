import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { parseFrontmatter } from "@earendil-works/pi-coding-agent";
import { runNpx } from "../npx";
import { isExistingPathWithinRoots } from "../path-security";
import { canonicalId, classification, coverage, packageFromId, parseQuery, optionalCatalog, type Catalog } from "./catalog";
import { getSkillCenterConfig } from "./config";
import { CenterError, requireValue } from "./errors";
import { digest, getInstallation } from "./inventory";
import { localTree, safeRelative, textContent, type TreeFile } from "./files";
import { withGitSource, type RepositoryReader } from "./git-source";
import { parseInstallCount } from "./install-count";
import { isProvider } from "./provider-labels";
import { isNativeSkillId, nativeSkillBundle, nativeSourceSkill, providerSearch } from "./providers";
import type { SourceSkill, DetailRequest, Installation, VersionIdentity } from "./types";

export function sourceSkill(pkg: string, snapshot?: Catalog): SourceSkill {
  const id = canonicalId(pkg);
  const [source, name] = packageFromId(id).split("@");
  const catalog = snapshot ?? optionalCatalog().catalog;
  return { canonicalSkillId: id, provider: "skills.sh", package: `${source}@${name}`, name, source, description: null, sourceType: "github", sourceUrl: `https://github.com/${source}`, directoryUrl: `https://skills.sh/${source}/${encodeURIComponent(name)}`, installCount: null, metadataState: "pending", classification: classification(id, catalog) };
}
export async function search(body: Record<string, unknown>, runner = runNpx) {
  const config = getSkillCenterConfig();
  const { catalog, diagnostics } = optionalCatalog();
  const q = parseQuery(body, catalog, true);
  const provider = body.provider ?? "skills.sh";
  requireValue(isProvider(provider), "INVALID_PROVIDER", "请选择受支持的技能来源。");
  const deadline = Date.now() + config.searchTimeoutMs;
  let searchMode: "api" | "cli" = "api";
  const results: SourceSkill[] = [];
  let truncated = false;
  if (provider !== "skills.sh") {
    const external = await providerSearch(provider, q.query, q.limit, catalog);
    results.push(...external.results); truncated = external.truncated;
    if (external.rejected) diagnostics.push({ id: `unsupported-${provider}`, code: "UNSUPPORTED_ENTRIES", severity: "warning", message: `${external.rejected} 项结果缺少可核验的下载地址，已跳过。`, installationIds: [], paths: [], rawDetail: null });
  } else {
  try {
    const url = new URL("/api/search", config.skillsApiBase); url.searchParams.set("q", q.query); url.searchParams.set("limit", String(q.limit));
    const response = await fetch(url, { cache: "no-store", redirect: "error", signal: AbortSignal.timeout(Math.max(1, deadline - Date.now())) });
    if (response.status === 429) throw new CenterError(429, "SOURCE_RATE_LIMITED", "skills.sh 暂时限流，请稍后重试。");
    if (!response.ok) throw new Error();
    const data = await response.json();
    if (!Array.isArray(data.skills)) throw new Error();
    for (const raw of data.skills) {
      try {
        const item = sourceSkill(`${raw.source}@${raw.name}`, catalog);
        item.installCount = parseInstallCount(raw.installs);
        if (typeof raw.description === "string") item.description = raw.description;
        results.push(item);
      } catch (error) { if (error instanceof CenterError && error.code === "INVALID_CLASSIFICATIONS") throw error; /* Unresolvable source identities are not guessed from display names. */ }
    }
  } catch (error) {
    if (error instanceof CenterError) throw error;
    searchMode = "cli";
    requireValue(Date.now() < deadline, "SOURCE_UNAVAILABLE", "搜索超时，请重试。", 504);
    try {
      const { stdout, stderr } = await runner(["skills", "find", q.query], { timeout: Math.max(1,Math.floor((deadline - Date.now()) / 2)), terminateTreeOnTimeout: true, env: { ...process.env, FORCE_COLOR: "0" } });
      for (const line of (stdout + stderr).replace(/\x1b\[[0-9;]*m/g, "").split("\n")) {
        const m = /^\s*([\w.-]+\/[\w.-]+@[\w.-]+(?:::[\w.-]+)*)(?:\s+([\d.,]+[KMB]?\s+installs?))?\s*$/i.exec(line);
        if (m) { const item = sourceSkill(m[1],catalog); item.installCount = parseInstallCount(m[2]); results.push(item); }
      }
      // Current CLI maps API failures to an empty result too; its empty text is not proof of no matches.
      requireValue(results.length,"SOURCE_UNAVAILABLE","命令行未返回可核实条目，无法区分空结果与来源故障，请重试。",502);
    } catch { throw new CenterError(502, "SOURCE_UNAVAILABLE", "源站和命令行搜索均未完成，请重试。"); }
  }
  }
  const seen = new Map<string,SourceSkill>();
  for (const item of results) {
    const prior = seen.get(item.canonicalSkillId);
    if (!prior) seen.set(item.canonicalSkillId,item);
    else { if (prior.description === null) prior.description = item.description; if (prior.installCount === null) prior.installCount = item.installCount; }
  }
  const unique = [...seen.values()];
  const returned = unique.slice(0, q.limit);
  const classified = returned.filter(s => s.classification.state === "classified");
  const current = q.domainId ? classified.filter(s => s.classification.assignments.some(a => a.domainId === q.domainId)).length : null;
  return { provider, results: returned, returnedCount: returned.length, searchMode, ordering: "source", fetchedAt: new Date().toISOString(), taxonomyVersion: catalog.taxonomy.version, indexRevision: catalog.taxonomy.indexRevision, classificationSummary: { classifiedUnique: classified.length, unclassifiedUnique: returned.length - classified.length, currentDomainUnique: current, outsideCurrentDomainUnique: current === null ? null : classified.length - current }, coverage: coverage(catalog, null, returned.length, true, truncated || unique.length > returned.length), diagnostics };
}
interface Snapshot { id: string; expires: number; source: string | null; bundleUrl?: string; version: VersionIdentity | null; root: string; files: TreeFile[]; complete: boolean; cwd: string | null; installation: Installation | null; content: Map<string, Buffer> }
declare global { var __piSkillSnapshots: Map<string, Snapshot> | undefined }
const snapshots = (): Map<string, Snapshot> => globalThis.__piSkillSnapshots ??= new Map<string, Snapshot>();
async function github(source: string, path: string, deadline = Date.now() + getSkillCenterConfig().searchTimeoutMs) {
  requireValue(Date.now() < deadline,"SOURCE_UNAVAILABLE","源内容读取超时，请重试。",504);
  const response = await fetch(`https://api.github.com/repos/${source}/${path}`, { cache: "no-store", redirect: "error", headers: { Accept: "application/vnd.github+json", "User-Agent": "pi-web", ...(process.env.GITHUB_TOKEN ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}) }, signal: AbortSignal.timeout(Math.max(1,deadline-Date.now())) });
  if (!response.ok) throw new CenterError(response.status === 429 || response.status === 403 ? 429 : 502, "SOURCE_UNAVAILABLE", `GitHub 内容读取失败（HTTP ${response.status}）。`);
  return response.json();
}
async function blob(source: string, sha: string, deadline?: number) {
  requireValue(/^[a-f0-9]{40}$/.test(sha), "SOURCE_UNAVAILABLE", "源文件版本无效。", 502);
  const data = await github(source, `git/blobs/${sha}`, deadline);
  requireValue(data.encoding === "base64" && typeof data.content === "string", "SOURCE_UNAVAILABLE", "源文件不可读取。", 502);
  return Buffer.from(data.content, "base64");
}
export async function detail(request: DetailRequest, gitSource = withGitSource) {
  const config = getSkillCenterConfig();
  const deadline = Date.now() + config.searchTimeoutMs;
  let installation: Installation | null = null;
  let skill: SourceSkill | null = null;
  let description: string | null = null;
  let metadata: Record<string,unknown> = {};
  const contentCache = new Map<string, Buffer>();
  let bundleUrl: string | undefined;
  let root: string; let files: TreeFile[]; let complete: boolean; let version: VersionIdentity | null; let source: string | null;
  if (request.kind === "installed") {
    installation = await getInstallation(request.cwd, request.installationId);
    root = dirname(installation.realPath); source = null;
    ({ files, complete } = localTree(root));
    version = installation.installedVersion;
    description = installation.description;
    try { metadata = parseFrontmatter<Record<string,unknown>>(readFileSync(installation.realPath,"utf8")).frontmatter; } catch { /* Invalid resources remain inspectable as raw files. */ }
    if (installation.canonicalSkillId) skill = isNativeSkillId(installation.canonicalSkillId) ? nativeSourceSkill(installation.canonicalSkillId) : sourceSkill(packageFromId(installation.canonicalSkillId));
  } else if (isNativeSkillId(request.canonicalSkillId)) {
    const bundle = await nativeSkillBundle(request.canonicalSkillId);
    skill = bundle.skill; version = bundle.version; source = skill.source;
    root = ""; complete = true; bundleUrl = skill.sourceUrl ?? skill.directoryUrl!;
    files = bundle.files.map(file => {
      const content = Buffer.from(file.content, file.encoding ?? "utf8"); contentCache.set(file.path, content);
      return { path: file.path, kind: "file" as const, size: content.length, previewable: true };
    });
    metadata = parseFrontmatter<Record<string,unknown>>(contentCache.get("SKILL.md")!.toString("utf8")).frontmatter;
    description = skill.description;
  } else {
    skill = sourceSkill(packageFromId(request.canonicalSkillId)); source = skill.source;
    const name = skill.name;
    const resolveSkill = async (repo: RepositoryReader) => {
      const candidates = repo.tree.filter(f => f.type === "blob" && f.path.split("/").at(-1) === "SKILL.md" && f.mode !== "120000");
      // Match actual frontmatter identity; never take the first same-named file.
      requireValue(candidates.length <= config.maxTreeEntries, "AMBIGUOUS_SKILL", "源目录候选过多，无法唯一定位。", 422);
      const matches = [];
      for (const f of candidates) {
        if ((f.size ?? Infinity) > config.maxTextBytes) continue;
        const content = await repo.readBlob(f.sha);
        try { const { frontmatter } = parseFrontmatter<Record<string, unknown>>(content.toString("utf8")); if (frontmatter.name === name) matches.push({ f, frontmatter, content }); } catch { /* invalid source metadata */ }
      }
      requireValue(matches.length === 1, "AMBIGUOUS_SKILL", "无法唯一定位该名称的 SKILL.md，请查看来源。", 422);
      const { f, frontmatter, content } = matches[0];
      const root = f.path.slice(0, -"SKILL.md".length);
      const relevant = repo.tree.filter(f => f.path.startsWith(root) && f.path !== root.slice(0,-1));
      const files: TreeFile[] = relevant.slice(0, config.maxTreeEntries).map(f => ({ path: f.path.slice(root.length), kind: f.type === "tree" ? "directory" : "file", size: f.size ?? null, sha: f.type === "blob" && f.mode !== "120000" ? f.sha : undefined, previewable: f.type === "blob" && f.mode !== "120000" && (f.size ?? Infinity) <= config.maxTextBytes }));
      return { root, files, complete: relevant.length <= config.maxTreeEntries, metadata: frontmatter, content, sha: repo.sha };
    };
    let resolved;
    try {
      const commit = await github(source, "commits/HEAD", deadline);
      requireValue(typeof commit.sha === "string" && /^[a-f0-9]{40}$/.test(commit.sha), "SOURCE_UNAVAILABLE", "无法确定源提交。", 502);
      const tree = await github(source, `git/trees/${commit.sha}?recursive=1`, deadline);
      requireValue(Array.isArray(tree.tree) && !tree.truncated, "SOURCE_UNAVAILABLE", "源目录不完整，尝试 Git 读取。", 502);
      resolved = await resolveSkill({ sha: commit.sha, tree: tree.tree, readBlob: sha => blob(source!, sha, deadline) });
    } catch (error) {
      if (error instanceof CenterError && error.code !== "SOURCE_UNAVAILABLE") throw error;
      try { resolved = await gitSource(source, null, resolveSkill); }
      catch (gitError) {
        if (gitError instanceof CenterError) throw gitError;
        throw new CenterError(502, "SOURCE_UNAVAILABLE", "GitHub API 和 Git 源内容读取均未完成。请确认服务器可以访问 GitHub，且已安装 Git，然后重试。");
      }
    }
    ({ root, files, complete, metadata } = resolved);
    contentCache.set("SKILL.md", resolved.content);
    description = typeof metadata.description === "string" ? metadata.description : null;
    skill = { ...skill, description, metadataState: "ready" };
    version = { value: resolved.sha, kind: "git-commit", label: "读取提交" };
  }
  const snapshotId = randomUUID();
  for (const [key, value] of snapshots()) if (value.expires < Date.now()) snapshots().delete(key);
  snapshots().set(snapshotId, { id: snapshotId, expires: Date.now() + config.cacheTtlMs, source, bundleUrl, root, files, complete, version, cwd: request.kind === "installed" ? request.cwd : null, installation, content: contentCache });
  const catalog = optionalCatalog();
  const identity = installation?.canonicalSkillId ?? skill?.canonicalSkillId;
  return { skill, installation, snapshotId, contentOrigin: source ? "remote" : "local", description, skillRelativePath: source ? `${root}SKILL.md` : basename(installation!.realPath), previewPath: source ? "SKILL.md" : basename(installation!.realPath), license: typeof metadata.license === "string" ? metadata.license : null, compatibility: typeof metadata.compatibility === "string" ? metadata.compatibility : null, evidence: catalog.catalog.assignments.filter(a=>a.canonicalSkillId === identity), version, metadataState: "ready", fileSummary: { count: files.filter(f => f.kind === "file").length, complete }, diagnostics: catalog.diagnostics };
}
async function getSnapshot(id: string) {
  const snap = snapshots().get(id);
  requireValue(snap && snap.expires > Date.now(), "SNAPSHOT_EXPIRED", "内容快照已过期，请重新读取详情。", 409);
  if (snap.installation) {
    const current = await getInstallation(snap.cwd, snap.installation.installationId);
    const tree = localTree(snap.root);
    requireValue(current.revision === snap.installation.revision && JSON.stringify(tree.files) === JSON.stringify(snap.files), "SNAPSHOT_EXPIRED", "本地文件已变化，请重新读取详情。", 409);
  }
  return snap;
}
export async function snapshotFiles(id: string) {
  const snap = await getSnapshot(id);
  return { files: snap.files.map(({ path, kind, size, previewable }) => ({ path, kind, size, previewable })), complete: snap.complete, reason: snap.complete ? null : "清单不完整，请查看来源。" };
}
export async function snapshotContent(id: string, input: unknown) {
  const path = safeRelative(input); const snap = await getSnapshot(id);
  const f = snap.files.find(f => f.path === path && f.kind === "file");
  requireValue(f, "FILE_NOT_FOUND", "文件不在当前技能快照内。", 404);
  const sourceUrl = snap.bundleUrl ?? (snap.source ? `https://github.com/${snap.source}/blob/${snap.version!.value}/${snap.root}${path.split("/").map(encodeURIComponent).join("/")}` : null);
  if ((f.size ?? 0) > getSkillCenterConfig().maxTextBytes) return { path, state: "too-large", text: null, mimeType: null, bytes: f.size, complete: false, sourceUrl };
  if (snap.source) {
    if (snap.bundleUrl) {
      const cached = snap.content.get(path);
      requireValue(cached, "SNAPSHOT_EXPIRED", "文件包快照已失效，请重新读取。", 409);
      return textContent(path, cached, sourceUrl);
    }
    if (!f.sha) return { path, state: "unavailable", text: null, mimeType: null, bytes: f.size, complete: false, sourceUrl };
    const cached = snap.content?.get(path);
    if (cached) return textContent(path, cached, sourceUrl);
    let content;
    try { content = await blob(snap.source, f.sha); }
    catch { content = await withGitSource(snap.source, snap.version!.value, repo => repo.readBlob(f.sha!)); }
    return textContent(path, content, sourceUrl);
  }
  const target = join(snap.root, path);
  requireValue(isExistingPathWithinRoots(target, new Set([snap.root])), "FORBIDDEN_PATH", "文件链接越界。", 403);
  const buffer = readFileSync(target);
  requireValue(digest(buffer) === f.revision, "SNAPSHOT_EXPIRED", "本地内容已改变，请重读。", 409);
  return textContent(path, buffer);
}

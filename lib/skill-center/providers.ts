import { createHash } from "node:crypto";
import { classification, optionalCatalog, type Catalog } from "./catalog";
import { getSkillCenterConfig } from "./config";
import { CenterError, requireValue } from "./errors";
import { safeRelative } from "./relative-path";
import { parseInstallCount } from "./install-count";
import { withGitSource, type RepositoryReader } from "./git-source";
import { providerLabels } from "./provider-labels";
import type { SourceSkill } from "./types";

type ObjectValue = Record<string, unknown>;
const object = (value: unknown): ObjectValue => value && typeof value === "object" && !Array.isArray(value) ? value as ObjectValue : {};
const hash = (text: string) => createHash("sha256").update(text).digest("hex");
import { validateBundle, type SkillBundle } from "./bundle";
export { validateBundle } from "./bundle";
export type { SkillBundle } from "./bundle";
type CacheEntry = { expires: number; value: unknown; bytes: number };
declare global { var __piProviderReads: Map<string, CacheEntry> | undefined; var __piProviderCooldowns: Map<string, number> | undefined }
class SourceResponseError extends CenterError {
  constructor(public upstreamStatus: number) {
    const auth = upstreamStatus === 401 || upstreamStatus === 403;
    super(auth ? 422 : 502, auth ? "SOURCE_AUTH_REQUIRED" : "SOURCE_UNAVAILABLE", `来源请求失败（HTTP ${upstreamStatus}）${auth ? "，请检查服务端 API Key 或访问权限。" : "，请稍后重试。"}`);
  }
}
function cacheValue(key: string, value: unknown) {
  const config = getSkillCenterConfig(); const cache = globalThis.__piProviderReads ??= new Map();
  const bytes = Buffer.byteLength(JSON.stringify(value));
  for (const [entry, data] of cache) if (data.expires <= Date.now() || entry === key) cache.delete(entry);
  if (bytes > config.maxBundleBytes) return;
  let total = [...cache.values()].reduce((sum, entry) => sum + entry.bytes, 0);
  while (cache.size && (cache.size >= config.maxLimit || total + bytes > config.maxBundleBytes)) {
    const first = cache.keys().next().value!; total -= cache.get(first)!.bytes; cache.delete(first);
  }
  cache.set(key, { expires: Date.now() + config.cacheTtlMs, value, bytes });
}

async function json(url: URL, headers: Record<string,string> = {}, fresh = false): Promise<unknown> {
  const config = getSkillCenterConfig();
  const cache = globalThis.__piProviderReads ??= new Map();
  const cooldowns = globalThis.__piProviderCooldowns ??= new Map();
  const key = hash(url.href + JSON.stringify(headers));
  const cached = cache.get(key);
  if (!fresh && cached && cached.expires > Date.now()) return cached.value;
  const remaining = (cooldowns.get(url.origin) ?? 0) - Date.now();
  if (remaining > 0) throw new CenterError(429, "SOURCE_RATE_LIMITED", `来源暂时限流，请在 ${Math.ceil(remaining / 1000)} 秒后重试。`);
  let response: Response;
  try { response = await fetch(url, { redirect: "error", cache: "no-store", headers: { Accept: "application/json", "User-Agent": "pi-web", ...headers }, signal: AbortSignal.timeout(config.searchTimeoutMs) }); }
  catch { throw new CenterError(502, "SOURCE_UNAVAILABLE", "无法连接来源服务，请稍后重试。"); }
  if (response.status === 429) {
    const retry = response.headers.get("retry-after");
    const seconds = retry && /^\d+$/.test(retry) ? Number(retry) : retry ? Math.ceil((Date.parse(retry) - Date.now()) / 1000) : NaN;
    const wait = Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : config.cacheTtlMs;
    cooldowns.set(url.origin, Date.now() + wait);
    await response.body?.cancel();
    throw new CenterError(429, "SOURCE_RATE_LIMITED", `来源暂时限流，请在 ${Math.ceil(wait / 1000)} 秒后重试。`);
  }
  if (!response.ok) {
    await response.body?.cancel();
    throw new SourceResponseError(response.status);
  }
  const reader = response.body?.getReader();
  requireValue(reader, "SOURCE_INVALID_RESPONSE", "来源未返回数据。", 502);
  const chunks: Uint8Array[] = []; let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      bytes += value.length;
      requireValue(bytes <= config.maxBundleBytes, "SOURCE_TOO_LARGE", "来源响应超过读取限制。", 502);
      chunks.push(value);
    }
  } finally { await reader.cancel(); }
  let value: unknown;
  try { value = JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { throw new CenterError(502, "SOURCE_INVALID_RESPONSE", "来源未返回有效 JSON 数据。"); }
  cacheValue(key, value);
  return value;
}
function endpoint(provider: "skillsmp" | "agentskill.sh", path: string) {
  const config = getSkillCenterConfig();
  return new URL(path, provider === "skillsmp" ? config.skillsmpApiBase : config.agentSkillApiBase);
}
function providerHeaders(provider: "skillsmp" | "agentskill.sh"): Record<string,string> {
  const key = provider === "skillsmp" ? process.env.SKILLSMP_API_KEY : process.env.AGENTSKILL_API_KEY;
  return key ? { Authorization: `Bearer ${key}` } : {};
}
export const isAgentSkillId = (id: string) => id.startsWith("agentskill.sh:");
export const isNativeSkillId = (id: string) => isAgentSkillId(id) || id.startsWith("skillsmp:");
function agentSlug(id: string) {
  const slug = id.slice("agentskill.sh:".length);
  requireValue(isAgentSkillId(id) && slug.length <= 240 && /^[\w.-]+(?:\/[\w.-]+)*$/.test(slug) && slug.split("/").every(p => p !== "." && p !== ".."), "INVALID_PACKAGE", "无效 agentskill.sh 技能标识。");
  return slug;
}
export function skillsmpLocation(value: unknown) {
  requireValue(typeof value === "string" && value.length <= 2048, "INVALID_PACKAGE", "SkillsMP 未提供有效 GitHub 目录。");
  let url: URL;
  try { url = new URL(value); } catch { throw new CenterError(422, "INVALID_PACKAGE", "SkillsMP GitHub 地址无效。"); }
  requireValue(url.protocol === "https:" && url.hostname === "github.com" && !url.port && !url.username && !url.password && !url.search && !url.hash, "INVALID_PACKAGE", "SkillsMP 仅支持公开 GitHub 目录。", 422);
  const parts = url.pathname.replace(/\/$/, "").slice(1).split("/").map(p => decodeURIComponent(p));
  requireValue(parts.length >= 2 && /^[\w.-]+$/.test(parts[0]) && /^[\w.-]+$/.test(parts[1]), "INVALID_PACKAGE", "GitHub 仓库地址无效。", 422);
  const source = `${parts[0]}/${parts[1]}`;
  requireValue(parts.length === 2 || parts[2] === "tree" && parts.length >= 4, "INVALID_PACKAGE", "SkillsMP 必须指向仓库或技能目录。", 422);
  const tail = parts.slice(3).join("/");
  if (tail) safeRelative(tail);
  return { source, tail, url: `https://github.com/${source}${tail ? `/tree/${parts.slice(3).map(encodeURIComponent).join("/")}` : ""}` };
}
export function nativeSourceSkill(id: string, catalog: Catalog = optionalCatalog().catalog): SourceSkill {
  if (isAgentSkillId(id)) {
    const slug = agentSlug(id);
    return { canonicalSkillId: id, provider: "agentskill.sh", package: id, name: slug.split("/").at(-1)!, source: slug, sourceType: "other", sourceUrl: "https://agentskill.sh", directoryUrl: "https://agentskill.sh", description: null, installCount: null, metadataState: "pending", classification: classification(id, catalog) };
  }
  requireValue(id.startsWith("skillsmp:"), "INVALID_PACKAGE", "不支持此技能来源。");
  let location: ReturnType<typeof skillsmpLocation>;
  try { location = skillsmpLocation(decodeURIComponent(id.slice("skillsmp:".length))); }
  catch { throw new CenterError(422, "INVALID_PACKAGE", "无效 SkillsMP 技能标识。"); }
  requireValue(id === `skillsmp:${encodeURIComponent(location.url)}`, "INVALID_PACKAGE", "SkillsMP 技能标识不是规范格式。");
  return { canonicalSkillId: id, provider: "skillsmp", package: id, name: location.tail.split("/").at(-1) || location.source.split("/")[1], source: location.source, sourceType: "github", sourceUrl: location.url, directoryUrl: "https://skillsmp.com", description: null, installCount: null, repositoryStars: null, metadataState: "pending", classification: classification(id, catalog) };
}
export async function providerSearch(provider: "skillsmp" | "agentskill.sh", query: string, limit: number, catalog: Catalog) {
  const url = endpoint(provider, provider === "skillsmp" ? "/api/v1/skills/search" : "/api/agent/search");
  url.searchParams.set("q", query); url.searchParams.set("limit", String(Math.min(limit, 50)));
  const data = object(await json(url, providerHeaders(provider)));
  const entries = provider === "skillsmp" ? object(data.data).skills : data.results;
  requireValue(Array.isArray(entries) && (provider !== "skillsmp" || data.success === true), "SOURCE_INVALID_RESPONSE", `${providerLabels[provider]} 搜索数据格式无效。`, 502);
  const results: SourceSkill[] = []; let rejected = 0;
  for (const entry of entries) {
    const raw = object(entry);
    try {
      const id = provider === "skillsmp" ? `skillsmp:${encodeURIComponent(skillsmpLocation(raw.githubUrl).url)}` : `agentskill.sh:${raw.slug}`;
      const skill = nativeSourceSkill(id, catalog);
      if (typeof raw.name === "string" && raw.name.trim()) skill.name = raw.name;
      if (typeof raw.description === "string") skill.description = raw.description;
      if (provider === "skillsmp") skill.repositoryStars = typeof raw.stars === "number" && Number.isSafeInteger(raw.stars) && raw.stars >= 0 ? raw.stars : null;
      else skill.installCount = parseInstallCount(raw.installCount);
      results.push(skill);
    } catch { rejected++; }
  }
  requireValue(!entries.length || results.length, "SOURCE_INVALID_RESPONSE", "源站结果缺少可核验的下载地址。", 502);
  return { results, rejected, truncated: provider === "skillsmp" ? object(object(data.data).pagination).hasNext === true : data.hasMore === true };
}
export async function agentSkillBundle(id: string, fresh = false): Promise<SkillBundle> {
  const slug = agentSlug(id);
  const raw = object(await json(endpoint("agentskill.sh", `/api/agent/skills/${encodeURIComponent(slug)}/install`), providerHeaders("agentskill.sh"), fresh));
  requireValue(raw.slug === slug && typeof raw.skillMd === "string" && Array.isArray(raw.skillFiles), "SOURCE_INVALID_RESPONSE", "agentskill.sh 返回的技能身份或文件包不一致。", 502);
  const skill = nativeSourceSkill(id); skill.installCount = parseInstallCount(raw.installCount);
  // The API returns SKILL.md separately, as used by its official CLI.
  const files = raw.skillFiles.filter(value => {
    const file = object(value);
    if (file.path !== "SKILL.md") return true;
    requireValue(file.content === raw.skillMd, "INVALID_SKILL_BUNDLE", "文件包中出现不一致的 SKILL.md。", 422);
    return false;
  });
  return validateBundle(skill, [{ path: "SKILL.md", content: raw.skillMd }, ...files]);
}
export async function skillsmpBundle(id: string, fresh = false, gitSource = withGitSource): Promise<SkillBundle> {
  const skill = nativeSourceSkill(id); const location = skillsmpLocation(skill.sourceUrl);
  const config = getSkillCenterConfig();
  const headers: Record<string,string> = process.env.GITHUB_TOKEN ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {};
  const github = async (path: string) => object(await json(new URL(`https://api.github.com/repos/${location.source}/${path}`), headers, fresh));
  // Resolve the longest existing Git ref: branch names can contain slashes.
  const segments = location.tail.split("/").filter(Boolean);
  let commit: string | null = null; let root = "";
  for (let size = segments.length || 1; size >= 1; size--) {
    const ref = segments.length ? segments.slice(0, size).join("/") : "HEAD";
    try { const data = await github(`commits/${encodeURIComponent(ref)}`); if (typeof data.sha === "string" && /^[a-f0-9]{40}$/.test(data.sha)) { commit = data.sha; root = segments.slice(size).join("/"); break; } }
    catch (error) { if (!(error instanceof SourceResponseError) || ![404, 422].includes(error.upstreamStatus)) throw error; }
  }
  requireValue(commit, "SOURCE_UNAVAILABLE", "无法定位 SkillsMP 提供的 GitHub 版本。", 502);
  const read = async (repo: RepositoryReader) => {
    const prefix = root ? root + "/" : "";
    const entries = repo.tree.filter(f => f.path.startsWith(prefix) && f.type !== "tree");
    requireValue(entries.length > 0 && entries.length <= config.maxTreeEntries && entries.every(f => f.type === "blob" && f.mode !== "120000" && (f.size ?? Infinity) <= config.maxTextBytes), "INVALID_SKILL_BUNDLE", "技能目录包含链接、不支持的文件或超过读取限制。", 422);
    requireValue(entries.reduce((total, file) => total + (file.size ?? 0), 0) <= config.maxBundleBytes, "INVALID_SKILL_BUNDLE", "技能目录超过文件包大小限制。", 422);
    const files = [];
    for (const file of entries) {
      const buffer = await repo.readBlob(file.sha);
      let content: string; let encoding: "base64" | undefined;
      try { content = new TextDecoder("utf-8", { fatal: true }).decode(buffer); if (buffer.includes(0)) throw new Error(); }
      catch { content = buffer.toString("base64"); encoding = "base64"; }
      files.push({ path: file.path.slice(prefix.length), content, ...(encoding ? { encoding } : {}) });
    }
    return validateBundle(skill, files);
  };
  // Reuse the existing Git object reader: it never checks out or runs skill code.
  return gitSource(location.source, commit, read);
}
export async function nativeSkillBundle(id: string, fresh = false): Promise<SkillBundle> {
  const cache = globalThis.__piProviderReads ??= new Map();
  const config = getSkillCenterConfig();
  const key = hash(`bundle:${id}:${JSON.stringify(config)}:${process.env.GITHUB_TOKEN ?? ""}:${process.env.SKILLSMP_API_KEY ?? ""}:${process.env.AGENTSKILL_API_KEY ?? ""}`);
  const cached = cache.get(key);
  if (!fresh && cached && cached.expires > Date.now()) {
    const bundle = structuredClone(cached.value) as SkillBundle;
    bundle.skill.classification = nativeSourceSkill(id).classification;
    return bundle;
  }
  const bundle = isAgentSkillId(id) ? await agentSkillBundle(id, fresh) : await skillsmpBundle(id, fresh);
  cacheValue(key, bundle);
  return structuredClone(bundle);
}

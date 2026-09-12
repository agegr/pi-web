/**
 * Visual QA only. Uses the real application bundle with isolated in-memory skills.
 * Usage: node qa-proxy.mjs http://127.0.0.1:<existing-app-port>
 * Listens on 127.0.0.1:0 and prints one JSON startup record containing the URL.
 * Never imports production service code, launches a CLI, or accesses skill files.
 */
import { createServer, request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const fixture = JSON.parse(readFileSync(new URL("./qa-fixtures.json", import.meta.url), "utf8"));
// Read the production taxonomy only: never load its service or live skill inventory.
const { taxonomy: productionTaxonomy } = JSON.parse(readFileSync(new URL("../../../lib/skill-center/catalog.json", import.meta.url), "utf8"));
const label = "视觉验收测试数据";
const timestamp = () => new Date().toISOString();
const marker = `<meta name="pi-web-visual-qa" content="fixtures-only"><style id="pi-web-visual-qa-label">html::after{content:"${label}";position:fixed;right:10px;bottom:7px;z-index:2147483647;padding:4px 9px;border:1px solid #b88813;border-radius:4px;background:#fff3c5;color:#674c05;font:12px/1.4 system-ui,sans-serif;pointer-events:none}</style>`;

function fail(status, message, code = "QA_REQUEST_BLOCKED") {
  return Object.assign(new Error(message), { status, code });
}
function json(res, value, status = 200) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Pi-Web-QA": "fixtures-only" });
  res.end(JSON.stringify(value, null, 2));
}
async function readBody(req) {
  let body = "";
  for await (const chunk of req) {
    body += chunk;
    if (Buffer.byteLength(body) > 65536) throw fail(413, "视觉验收请求超过限制。");
  }
  if (!body) return {};
  try { return JSON.parse(body); } catch { throw fail(400, "视觉验收请求必须为 JSON。"); }
}

export function createQaProxy(targetValue) {
  const target = new URL(targetValue);
  if (!["http:", "https:"].includes(target.protocol) || !["127.0.0.1", "localhost", "[::1]"].includes(target.hostname)) throw new Error("Target must be an existing loopback HTTP application.");
  const taxonomy = { ...structuredClone(productionTaxonomy), indexRevision: "visual-qa-fixtures-1" };
  const versions = { taxonomyVersion: taxonomy.version, indexRevision: taxonomy.indexRevision };
  const classification = f => ({ state: "classified", assignments: f.assignments.map(([domainId, categoryId]) => ({ domainId, categoryId })), ...versions });
  const skills = fixture.skills.map((f, index) => ({ canonicalSkillId: `skills.sh:visual-qa/examples@${f.slug}`, provider: "skills.sh", package: `visual-qa/examples@${f.slug}`, name: f.slug, description: f.description, source: "visual-qa/examples", sourceType: "github", sourceUrl: "https://example.invalid/visual-qa/examples", directoryUrl: `https://example.invalid/visual-qa/${f.slug}`, installCount: { display: String((index + 1) * 120), numeric: (index + 1) * 120 }, metadataState: "ready", classification: classification(f) }));
  const version = (scope, updated = false) => ({ value: (updated ? "b" : "a").repeat(40), kind: scope === "project" ? "skills-content-hash" : "git-tree", label: scope === "project" ? "技能内容哈希（测试）" : "Git 目录哈希（测试）" });
  const contextId = cwd => cwd ? `visual-qa:${cwd}` : "visual-qa:global";
  const makeInstallation = (skill, index, scope = fixture.skills[index].scope) => {
    const f = fixture.skills[index]; const managed = scope !== "other";
    const path = `X:\\视觉验收测试数据\\${scope}\\skills\\${skill.name}\\SKILL.md`;
    const bindingId = `qa-binding-${index}-${scope}`;
    return { installationId: `qa-installation-${index}-${scope}`, canonicalSkillId: skill.canonicalSkillId, classification: skill.classification, name: skill.name, description: skill.description, scope, contextId: scope === "project" ? "visual-qa:project" : null, source: managed ? skill.source : null, managed, package: managed ? skill.package : null, logicalPath: path, realPath: path, aliases: [{ path, scope, contextId: scope === "project" ? "visual-qa:project" : null, bindingId: managed ? bindingId : null }], managementBindings: managed ? [{ bindingId, scope, contextId: scope === "project" ? "visual-qa:project" : null, package: skill.package, source: skill.source, sourceType: "github", skillPath: `skills/${skill.name}/SKILL.md`, ref: null, version: version(scope), canCheckForUpdates: true }] : [], managementBindingId: managed ? bindingId : null, revision: `qa-revision-${index}-1`, installedVersion: managed ? version(scope) : null, disableModelInvocation: f.hidden, loadState: f.loadState, loadReason: f.loadState === "shadowed" ? "视觉测试：同名资源先被加载。" : f.loadState === "excluded" ? "视觉测试：配置排除此资源。" : null, capabilities: { readContent: true, setVisibility: true, checkUpdate: managed, update: managed, reasonByCapability: managed ? {} : { update: "视觉测试：本地技能没有可比较版本。" } } };
  };
  const installations = skills.map((s, i) => makeInstallation(s, i));
  const plans = new Map(); const operations = new Map(); const keys = new Map(); const snapshots = new Map();
  const coverage = (total, returned, external = false) => ({ ...versions, kind: external ? "external-result-set" : "local-index", indexedUnique: skills.length, totalMatched: external ? null : total, returnedCount: returned, truncated: total > returned, marketTotal: null, completeWithinIndex: external ? null : total <= returned, description: fixture.notice });
  const byId = (list, key, id) => { const item = list.find(v => v[key] === id); if (!item) throw fail(404, "未找到视觉验收测试条目。", "QA_NOT_FOUND"); return item; };

  async function center(req, res, route) {
    const body = await readBody(req);
    if (route === "taxonomy" && req.method === "GET") return json(res, { taxonomy, counts: taxonomy.domains.map(d => ({ domainId: d.id, indexedUnique: skills.filter(s => s.classification.assignments.some(a => a.domainId === d.id)).length })), coverage: { ...coverage(skills.length, 0), truncated: false, completeWithinIndex: true }, diagnostics: [], limits: { maxQueryLength: 200, maxLimit: 50, defaultLimit: 50, pollAfterMs: 300 } });
    if (route === "write-status" || route === "write-status/reconcile") return json(res, { busy: false, operationId: null, recoverable: false });
    if (["catalog/query", "search"].includes(route) && req.method === "POST") {
      const external = route === "search";
      const matches = skills.filter(s => [s.name, s.description, s.source].some(v => v.toLowerCase().includes((body.query ?? "").toLowerCase())) && (external || !body.domainId || s.classification.assignments.some(a => a.domainId === body.domainId && (!body.categoryId || a.categoryId === body.categoryId))) && (external || body.classificationState !== "unclassified"));
      const results = matches.slice(0, body.limit ?? 50);
      return json(res, { ...versions, results, returnedCount: results.length, ordering: external ? "source" : "index", searchMode: "api", fetchedAt: timestamp(), coverage: coverage(matches.length, results.length, external), classificationSummary: { classifiedUnique: results.length, unclassifiedUnique: 0, currentDomainUnique: body.domainId ? results.filter(s => s.classification.assignments.some(a => a.domainId === body.domainId)).length : null, outsideCurrentDomainUnique: body.domainId ? results.filter(s => !s.classification.assignments.some(a => a.domainId === body.domainId)).length : null }, diagnostics: [] });
    }
    if (route === "inventory/query" && req.method === "POST") return json(res, { ...versions, contextId: contextId(body.cwd), revision: installations.map(i => i.revision).join(":"), readAt: timestamp(), projectResourcesLoaded: Boolean(body.cwd), installations, diagnostics: [], coverage: { global: "complete", project: body.cwd ? "complete" : "none", description: fixture.notice } });
    const classificationRoute = /^installations\/([^/]+)\/classification$/.exec(route);
    if (classificationRoute && req.method === "PATCH") {
      const item = byId(installations, "installationId", classificationRoute[1]);
      if (body.expectedClassificationRevision !== (item.classification.personalRevision ?? null)) throw fail(409, "测试分类已变化。");
      item.classification = { ...item.classification, assignments: body.assignments, state: body.assignments.length ? "classified" : "unclassified", origin: "personal", personalRevision: randomUUID() };
      return json(res, { installation: item });
    }
    if (route === "detail" && req.method === "POST") {
      const item = body.kind === "installed" ? byId(installations, "installationId", body.installationId) : null;
      const skill = byId(skills, "canonicalSkillId", item?.canonicalSkillId ?? body.canonicalSkillId);
      const snapshotId = randomUUID(); snapshots.set(snapshotId, { skill, item });
      return json(res, { skill, installation: item, snapshotId, contentOrigin: item ? "local" : "remote", description: skill.description, previewPath: "SKILL.md", skillRelativePath: `skills/${skill.name}/SKILL.md`, version: item?.installedVersion ?? { value: "c".repeat(40), kind: "git-commit", label: "读取提交（测试）" }, metadataState: "ready", license: "MIT（视觉测试）", compatibility: "Pi / Agent Skills（视觉测试）", evidence: [{ evidence: { sourceUrl: skill.sourceUrl, relativePath: `skills/${skill.name}/SKILL.md`, excerpt: "此归属仅用于视觉验收，不是生产分类依据。", verifiedAt: timestamp() } }], fileSummary: { count: 3, complete: true }, diagnostics: [] });
    }
    const snap = /^snapshots\/([^/]+)\/(files|content)$/.exec(route);
    if (snap) {
      const snapshot = snapshots.get(snap[1]); if (!snapshot) throw fail(409, "测试快照已失效，请重新打开详情。");
      const textFiles = { "SKILL.md": `---\nname: ${snapshot.skill.name}\ndescription: ${snapshot.skill.description}\n---\n\n# ${snapshot.skill.name}\n\n> 视觉验收测试数据，不执行任何真实技能。\n\n## 工作方式\n\n1. 确认问题与输入材料。\n2. 记录来源、假设与适用范围。\n3. 形成便于复核的结构化结果。\n\n## 输出\n\n| 内容 | 要求 |\n| --- | --- |\n| 结论 | 简明且可核查 |\n| 依据 | 保留材料来源 |\n| 下一步 | 明确需要补充的信息 |\n`, "references/guide.md": "# 阅读指引\n\n此文件仅用于多级目录与 Markdown 视觉验收。\n", "scripts/example.txt": "VISUAL QA FIXTURE ONLY\nNo scripts are executed.\n" };
      if (snap[2] === "files" && req.method === "GET") return json(res, { files: Object.entries(textFiles).map(([path, text]) => ({ path, kind: "file", size: Buffer.byteLength(text), previewable: true })), complete: true, reason: null });
      if (snap[2] === "content" && req.method === "POST" && Object.hasOwn(textFiles, body.path)) return json(res, { path: body.path, state: "text", text: textFiles[body.path], bytes: Buffer.byteLength(textFiles[body.path]), mimeType: "text/plain", complete: true, sourceUrl: null });
      throw fail(404, "文件不在测试快照内。");
    }
    if (route === "checks" && req.method === "POST") {
      const selected = installations.filter(i => body.installationIds === undefined || body.installationIds.includes(i.installationId));
      return json(res, { results: selected.map(item => { const f = fixture.skills.find(f => f.slug === item.name); const state = item.qaUpdated ? "up-to-date" : f.updateState; return { installationId: item.installationId, basedOnRevision: item.revision, state, currentVersion: item.installedVersion, sourceVersion: ["unsupported", "error"].includes(state) ? null : version(item.scope, state === "update-available" || item.qaUpdated), checkedAt: timestamp(), stale: false, reasonCode: state === "error" ? "SOURCE_UNAVAILABLE" : state === "unsupported" ? "UNSUPPORTED_SOURCE" : null, message: state === "error" ? "视觉测试：来源暂不可用，请重试。" : state === "unsupported" ? "视觉测试：没有受支持的管理记录。" : null }; }), checkedAt: timestamp(), diagnostics: [] });
    }
    const visibility = /^installations\/([^/]+)\/visibility$/.exec(route);
    if (visibility && req.method === "PATCH") {
      const item = byId(installations, "installationId", visibility[1]);
      if (body.expectedRevision !== item.revision) throw fail(409, "测试实例已改变，请刷新。", "REVISION_CONFLICT");
      if (typeof body.disableModelInvocation !== "boolean") throw fail(400, "必须提供明确布尔值。");
      item.disableModelInvocation = body.disableModelInvocation; item.revision = randomUUID();
      return json(res, { installation: item, effectiveWhen: "next-resource-load" });
    }
    if (route === "plans" && req.method === "POST") {
      const item = body.kind === "update" ? byId(installations, "installationId", body.installationId) : null;
      const skill = byId(skills, "canonicalSkillId", item?.canonicalSkillId ?? body.canonicalSkillId);
      const scope = item?.scope ?? body.scope; const planId = randomUUID();
      const value = { planId, operationId: randomUUID(), classification: skill.classification, kind: body.kind, state: "ready", expiresAt: new Date(Date.now() + 300000).toISOString(), contextId: contextId(body.cwd), scope, skillName: skill.name, source: skill.source, target: { logicalPath: item?.logicalPath ?? `X:\\视觉验收测试数据\\${scope}\\skills\\${skill.name}\\SKILL.md`, realPath: item?.realPath ?? null, sharedAliases: item?.aliases.map(a => a.path) ?? [] }, currentVersion: item?.installedVersion ?? null, observedSourceVersion: version(scope, true), sourceVersionPinned: false, localChanges: item ? "unknown" : "not-applicable", expectedRevision: item?.revision ?? null, requiredAcknowledgements: item ? ["overwrite-unknown-local-changes"] : [], blockers: [], notices: [fixture.notice, "将安装执行时源站可用内容；此预览不固定版本。", "下次资源加载时按当前配置处理。"] };
      plans.set(planId, { value, request: body, skill }); return json(res, value);
    }
    if (route === "operations" && req.method === "POST") {
      const old = keys.get(body.idempotencyKey);
      if (old) { if (old.planId !== body.planId) throw fail(409, "测试幂等键已用于其他计划。", "IDEMPOTENCY_CONFLICT"); return json(res, { operation: operations.get(old.operationId) }); }
      const stored = plans.get(body.planId); if (!stored) throw fail(409, "测试计划已失效。", "STALE_PLAN");
      const { value: p, request, skill } = stored;
      let item = installations.find(i => i.canonicalSkillId === skill.canonicalSkillId && i.scope === p.scope);
      if (!item) { item = makeInstallation(skill, skills.indexOf(skill), p.scope); installations.push(item); }
      item.qaUpdated = true; item.installedVersion = version(p.scope, true); item.revision = randomUUID();
      const operation = { operationId: p.operationId, kind: p.kind, state: "succeeded", contextId: p.contextId, projectLabel: request.cwd ?? null, scope: p.scope, skillName: p.skillName, targetPath: p.target.logicalPath, createdAt: timestamp(), updatedAt: timestamp(), finishedAt: timestamp(), result: { installationId: item.installationId, actualVersion: item.installedVersion, visibilityPreserved: p.kind === "update" ? true : null, currentSourceStatus: "up-to-date", reloadRequired: true }, error: null, outputExcerpt: "视觉验收：仅更新代理内存。未启动 CLI，未访问真实技能文件。", pollAfterMs: null };
      operations.set(p.operationId, operation); keys.set(body.idempotencyKey, { planId: body.planId, operationId: p.operationId }); return json(res, { operation }, 202);
    }
    const operation = /^operations\/([^/]+)(?:\/reconcile)?$/.exec(route);
    if (operation) { const value = operations.get(operation[1]); if (!value) throw fail(404, "没有该视觉测试操作。", "OPERATION_NOT_FOUND"); return json(res, value); }
    throw fail(404, "未定义此技能中心视觉测试接口；请求不会转发。", "QA_FIXTURE_NOT_FOUND");
  }

  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, "http://127.0.0.1");
      const pathname = decodeURIComponent(url.pathname);
      if (pathname === "/__visual-qa") return json(res, { fixtureOnly: true, notice: fixture.notice, target: target.origin, skills: skills.length, installations: installations.length, supported: ["taxonomy", "catalog/query", "search", "inventory/query", "detail", "snapshots/*", "checks", "plans", "operations", "installations/*/visibility"] });
      if (pathname === "/api/skill-center" || pathname.startsWith("/api/skill-center/")) return await center(req, res, pathname.slice("/api/skill-center/".length));
      if (!["GET", "HEAD"].includes(req.method)) throw fail(403, "视觉验收代理禁止转发所有写入请求。仅技能中心内存测试接口可操作。");
      // Legacy skill/model/plugin reads can load real SDK resources or extensions.
      if (/^\/api\/(?:skills|models|plugins|auth)(?:\/|$)/.test(pathname) || pathname.startsWith("/api/agent/") && pathname !== "/api/agent/running") throw fail(403, "视觉验收不读取真实技能或启动 Agent。");
      const upstream = new URL(url.pathname + url.search, target);
      const headers = new Headers();
      for (const [key, value] of Object.entries(req.headers)) if (value && !["host", "connection", "content-length", "accept-encoding"].includes(key)) headers.set(key, Array.isArray(value) ? value.join(", ") : value);
      headers.set("host", target.host); headers.set("accept-encoding", "identity");
      const response = await fetch(upstream, { method: req.method, headers, redirect: "manual" });
      const responseHeaders = Object.fromEntries(response.headers);
      for (const key of ["content-length", "content-encoding", "transfer-encoding", "connection"]) delete responseHeaders[key];
      responseHeaders["x-pi-web-qa"] = "fixtures-only";
      // Keep redirects on this proxy so write protection remains in place.
      if (responseHeaders.location) { const location = new URL(responseHeaders.location, upstream); if (location.origin !== target.origin) throw fail(403, "视觉验收代理不跟随外部重定向。"); responseHeaders.location = location.pathname + location.search + location.hash; }
      if (req.method !== "HEAD" && response.headers.get("content-type")?.includes("text/html")) {
        const html = await response.text(); delete responseHeaders["content-security-policy"];
        res.writeHead(response.status, responseHeaders); res.end(html.includes("</head>") ? html.replace("</head>", marker + "</head>") : marker + html);
      } else { res.writeHead(response.status, responseHeaders); if (response.body && req.method !== "HEAD") await pipeline(Readable.fromWeb(response.body), res); else res.end(); }
    } catch (error) { if (!res.headersSent) json(res, { error: { code: error.code ?? "QA_PROXY_ERROR", message: error.message, retryable: false, requestId: randomUUID() } }, error.status ?? 502); else res.destroy(); }
  });
  // Next 16 sends the initial React debug stream over /_next/hmr. Blocking it
  // suspends hydration, not just hot reload. Only these exact development
  // transports may upgrade; agent and arbitrary application sockets stay blocked.
  server.on("upgrade", (req, socket, clientHead) => {
    const url = new URL(req.url, target);
    if (req.method !== "GET" || !["/_next/hmr", "/_next/webpack-hmr"].includes(url.pathname) || url.origin !== target.origin) {
      socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n"); return;
    }
    const request = (target.protocol === "https:" ? httpsRequest : httpRequest)(url, { method: "GET", headers: { ...req.headers, host: target.host, origin: target.origin } });
    request.setTimeout(10000, () => request.destroy(new Error("Next development WebSocket handshake timed out")));
    request.on("error", () => { if (!socket.destroyed) socket.destroy(); });
    request.on("response", response => { response.resume(); socket.end("HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n"); });
    request.on("upgrade", (response, upstreamSocket, upstreamHead) => {
      request.setTimeout(0);
      const lines = ["HTTP/1.1 101 Switching Protocols"];
      for (let i = 0; i < response.rawHeaders.length; i += 2) lines.push(`${response.rawHeaders[i]}: ${response.rawHeaders[i + 1]}`);
      socket.write(lines.join("\r\n") + "\r\n\r\n");
      if (upstreamHead.length) socket.write(upstreamHead);
      if (clientHead.length) upstreamSocket.write(clientHead);
      socket.on("error", () => upstreamSocket.destroy());
      upstreamSocket.on("error", () => socket.destroy());
      socket.on("close", () => upstreamSocket.destroy());
      upstreamSocket.on("close", () => socket.destroy());
      socket.pipe(upstreamSocket).pipe(socket);
    });
    socket.on("close", () => request.destroy());
    request.end();
  });
  return server;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (!process.argv[2]) throw new Error("Usage: node qa-proxy.mjs http://127.0.0.1:<existing-app-port>");
    const server = createQaProxy(process.argv[2]);
    server.listen(0, "127.0.0.1", () => console.log(JSON.stringify({ status: "ready", fixtureOnly: true, notice: label, url: `http://127.0.0.1:${server.address().port}/`, target: new URL(process.argv[2]).origin, pid: process.pid })));
  } catch (error) { console.error(JSON.stringify({ status: "error", message: error.message })); process.exitCode = 1; }
}

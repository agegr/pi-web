// ssrf-guard.ts —— LLM base_url SSRF 防护（Q3 / autoplan chat provider_service.go:198 无白名单）
//
// 上游 autoplan 允许任意 base_url（用户配置），无 host 白名单，存在 SSRF（打内网/metadata）。
// 本等价层强制：base_url 必须为 http/https，且 host 匹配白名单或满足公网约束，
// 禁止指向内网/环回/链路本地/云 metadata 地址。
import { isIP } from "node:net";

/** 明确禁止的 host（环回/私网/链路本地/云元数据）。 */
const BLOCKED_HOSTS = new Set([
  "localhost",
  "0.0.0.0",
  "127.0.0.1",
  "::1",
  "169.254.169.254", // AWS/GCP/Azure metadata
  "metadata.google.internal",
  "metadata.goog",
]);

/** 私网 IPv4 段。 */
function isPrivateIPv4(ip: string): boolean {
  const p = ip.split(".").map((n) => Number(n));
  if (p.length !== 4 || p.some((n) => Number.isNaN(n))) return false;
  const [a, b] = p;
  if (a === 10) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  if (a === 127) return true;
  if (a === 169 && b === 254) return true; // 链路本地
  if (a === 0) return true;
  return false;
}

export interface SsrfCheckResult {
  ok: boolean;
  reason?: string;
  host?: string;
}

/** 校验 LLM base_url 是否允许访问。白名单经 env（ENGINE_LLM_BASE_URL_ALLOWLIST，逗号分隔）追加。 */
export function checkLlmBaseUrl(raw: string): SsrfCheckResult {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: "非法的 base_url" };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { ok: false, reason: `仅允许 http/https，收到 ${url.protocol}` };
  }
  const host = (url.hostname || "").toLowerCase();
  if (!host) return { ok: false, reason: "缺少 host" };

  // 显式白名单（如企业网关）优先放行。
  const allow = (process.env.ENGINE_LLM_BASE_URL_ALLOWLIST ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  if (allow.includes(host)) return { ok: true, host };

  if (BLOCKED_HOSTS.has(host)) {
    return { ok: false, reason: `host 在禁用名单：${host}` };
  }

  // 解析为 IP 时检查私网/环回/链路本地。
  const ipVer = isIP(host);
  if (ipVer === 4) {
    if (isPrivateIPv4(host)) return { ok: false, reason: `指向私网地址：${host}` };
    return { ok: true, host };
  }
  if (ipVer === 6) {
    if (
      host === "::1" ||
      host.startsWith("fe80") ||
      host.startsWith("fc") ||
      host.startsWith("fd")
    ) {
      return { ok: false, reason: `指向私网/链路本地地址：${host}` };
    }
    return { ok: true, host };
  }

  // 域名形式：允许（DNS 重绑定风险由调用方在连接层二次校验，等价于上游 best-effort）。
  return { ok: true, host };
}

/** 若 base_url 不合规则抛出，合规则原样返回（供调用处包装）。 */
export function assertSafeLlmBaseUrl(raw: string): string {
  const r = checkLlmBaseUrl(raw);
  if (!r.ok) throw new Error(`LLM base_url 被 SSRF 防护拒绝：${r.reason}`);
  return raw;
}

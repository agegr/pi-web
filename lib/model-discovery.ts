import { isIP } from "node:net";

export interface DiscoveredModel {
  id: string;
  name?: string;
}

function isPrivateIpv4(address: string): boolean {
  const octets = address.split(".").map(Number);
  if (octets.length !== 4 || octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) return true;
  const [a, b] = octets;
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  if (a === 169 && b === 254) return true; // link-local incl. cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && (b === 168 || b === 0 || b === 2)) return true;
  if (a === 198 && (b === 18 || b === 19 || b === 51)) return true;
  if (a === 203 && b === 113) return true;
  if (a >= 224) return true; // multicast + reserved
  return false;
}

function isPrivateIpv6(address: string): boolean {
  const lower = address.toLowerCase();
  if (lower === "::" || lower === "::1") return true;
  if (lower.startsWith("fc") || lower.startsWith("fd")) return true; // fc00::/7
  if (lower.startsWith("fe8") || lower.startsWith("fe9") || lower.startsWith("fea") || lower.startsWith("feb")) return true; // fe80::/10
  if (lower.startsWith("2001:db8")) return true; // documentation
  const mapped = /^::ffff:(.+)$/.exec(lower);
  return mapped ? isPrivateIpv4(mapped[1]) : false;
}

function normalizeDiscoveryHostname(hostname: string): string {
  return hostname.toLowerCase().replace(/\.$/, "").replace(/^\[|\]$/g, "");
}

function isLoopbackHostname(hostname: string): boolean {
  const normalized = normalizeDiscoveryHostname(hostname);
  if (normalized === "localhost" || normalized.endsWith(".localhost")) return true;
  const ipKind = isIP(normalized);
  if (ipKind === 4) return normalized.split(".").map(Number)[0] === 127;
  if (ipKind === 6) {
    if (normalized === "::1") return true;
    const mapped = /^::ffff:(.+)$/.exec(normalized);
    return mapped ? isLoopbackHostname(mapped[1]) : false;
  }
  return false;
}

function isLanIpv4(address: string): boolean {
  const octets = address.split(".").map(Number);
  if (octets.length !== 4 || octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) return false;
  const [a, b] = octets;
  if (a === 10) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  return false;
}

function isLanHostname(hostname: string): boolean {
  const normalized = normalizeDiscoveryHostname(hostname);
  const ipKind = isIP(normalized);
  if (ipKind === 4) return isLanIpv4(normalized);
  if (ipKind === 6) {
    const lower = normalized.toLowerCase();
    if (lower.startsWith("fc") || lower.startsWith("fd")) return true;
    const mapped = /^::ffff:(.+)$/.exec(lower);
    return mapped ? isLanIpv4(mapped[1]) : false;
  }
  return false;
}

function isPrivateHostname(hostname: string): boolean {
  const normalized = normalizeDiscoveryHostname(hostname);
  if (normalized === "localhost" || normalized.endsWith(".localhost")) return true;
  if (normalized === "" || normalized.includes("%")) return true;
  const ipKind = isIP(normalized);
  if (ipKind === 4) return isPrivateIpv4(normalized);
  if (ipKind === 6) return isPrivateIpv6(normalized);
  return false; // public DNS name; ponytail: no DNS resolution, same-origin middleware covers rebinding
}

export interface DiscoveryTargetAuth {
  apiKey?: string;
  headers?: Record<string, string | null | undefined>;
}

/**
 * Guards discovery/test fetches against credential-forwarding SSRF.
 * Scheme is restricted to http(s); stored credentials are never forwarded to
 * link-local or special-use destinations (cloud metadata, unspecified,
 * multicast). Loopback and RFC1918/ULA LAN addresses are allowed with
 * credentials so local and LAN OpenAI-compatible proxies work.
 */
export function assertSafeDiscoveryTarget(target: URL, auth: DiscoveryTargetAuth): void {
  if (target.protocol !== "http:" && target.protocol !== "https:") {
    throw new Error("Base URL must use http or https");
  }
  const hasCredentials = Boolean(auth.apiKey)
    || Object.values(auth.headers ?? {}).some((value) => typeof value === "string" && value.length > 0);
  if (
    hasCredentials
    && isPrivateHostname(target.hostname)
    && !isLoopbackHostname(target.hostname)
    && !isLanHostname(target.hostname)
  ) {
    throw new Error("Base URL must not target a link-local or private address when credentials are attached");
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function cleanString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

const OPENAI_STYLE_APIS = new Set(["openai-completions", "openai-responses", "openai-codex-responses"]);

/**
 * OpenAI-compatible relays serve `/v1/chat/completions` and `/v1/responses`;
 * a host-only baseUrl omitting `/v1` hits the bare path, which some relays
 * (e.g. codex2api.com) WAF-block for the SDK's `OpenAI/*` User-Agent while
 * still answering a plain `/models` discovery — so discovery succeeds and the
 * saved config then fails. Normalize a host-only baseUrl to include `/v1` for
 * OpenAI-style APIs so discovery and completions use the same path.
 */
export function normalizeProviderBaseUrl(baseUrl: unknown, api: unknown): string {
  if (typeof baseUrl !== "string") return "";
  const trimmed = baseUrl.trim();
  if (!trimmed || typeof api !== "string" || !OPENAI_STYLE_APIS.has(api)) return trimmed;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return trimmed;
  }
  const path = url.pathname.replace(/\/+$/, "");
  if (path === "") url.pathname = "/v1";
  return url.toString();
}

function modelFromValue(value: unknown): DiscoveredModel | null {
  if (typeof value === "string") {
    const id = value.trim();
    return id ? { id } : null;
  }
  if (!isRecord(value)) return null;

  const rawId = cleanString(value.id) ?? cleanString(value.model) ?? cleanString(value.name);
  if (!rawId) return null;
  const id = rawId.startsWith("models/") ? rawId.slice("models/".length) : rawId;
  if (!id) return null;
  const name = cleanString(value.display_name)
    ?? cleanString(value.displayName)
    ?? (cleanString(value.id) || cleanString(value.model) ? cleanString(value.name) : undefined);
  return name && name !== id ? { id, name } : { id };
}

function listFromResponse(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (!isRecord(value)) return [];
  for (const key of ["data", "models", "results", "items"]) {
    const candidate = value[key];
    if (Array.isArray(candidate)) return candidate;
    if (isRecord(candidate)) return Object.values(candidate);
  }
  return [];
}

export function parseDiscoveredModels(value: unknown): DiscoveredModel[] {
  const seen = new Set<string>();
  const models: DiscoveredModel[] = [];
  for (const item of listFromResponse(value)) {
    const model = modelFromValue(item);
    if (!model || seen.has(model.id)) continue;
    seen.add(model.id);
    models.push(model);
  }
  return models.sort((a, b) => (a.name ?? a.id).localeCompare(b.name ?? b.id, undefined, {
    numeric: true,
    sensitivity: "base",
  }));
}

export function buildModelsListUrl(baseUrl: string, api: string): URL {
  const url = new URL(normalizeProviderBaseUrl(baseUrl, api));
  const trimmedPath = url.pathname.replace(/\/+$/, "");

  if (!/\/models$/i.test(trimmedPath)) {
    let path = trimmedPath;
    if (api === "anthropic-messages" && !/\/v\d+(?:beta)?$/i.test(path)) path += "/v1";
    if (api === "google-generative-ai" && !/\/v\d+(?:beta)?$/i.test(path)) path += "/v1beta";
    url.pathname = `${path}/models`.replace(/\/+/g, "/");
  }

  if (api === "anthropic-messages" && !url.searchParams.has("limit")) {
    url.searchParams.set("limit", "1000");
  }
  if (api === "google-generative-ai" && !url.searchParams.has("pageSize")) {
    url.searchParams.set("pageSize", "1000");
  }
  return url;
}

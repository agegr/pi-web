import { NextResponse } from "next/server";
import { isIP } from "node:net";
import { isApiRequestAllowed } from "@/lib/request-security";
import { resolveModelDiscoveryAuth } from "@/lib/model-discovery-auth";
import { buildModelsListUrl, parseDiscoveredModels } from "@/lib/model-discovery";

export const dynamic = "force-dynamic";

const DISCOVERY_TIMEOUT_MS = 20_000;

/**
 * SSRF guard: refuse to issue the upstream fetch when the resolved hostname
 * points at the loopback interface, a private network, a link-local address,
 * or an IPv6 ULA. Cloud metadata endpoints (169.254.169.254 and friends) are
 * the most attractive target — they sit in 169.254.0.0/16. This is a
 * best-effort block; DNS rebinding still applies, but it raises the bar.
 */
function isBlockedHost(hostname: string): boolean {
  if (isIP(hostname) === 4) {
    const parts = hostname.split(".").map(Number);
    // 127.0.0.0/8 loopback, 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16 private,
    // 169.254.0.0/16 link-local (AWS / GCP / Azure metadata).
    if (parts[0] === 127) return true;
    if (parts[0] === 10) return true;
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
    if (parts[0] === 192 && parts[1] === 168) return true;
    if (parts[0] === 169 && parts[1] === 254) return true;
    if (parts[0] === 0) return true;
    return false;
  }
  if (isIP(hostname) === 6) {
    const lower = hostname.toLowerCase();
    if (lower === "::1" || lower === "[::1]") return true;
    if (lower.startsWith("fc") || lower.startsWith("fd")) return true; // fc00::/7 ULA
    if (lower.startsWith("fe8") || lower.startsWith("fe9") || lower.startsWith("fea") || lower.startsWith("feb")) return true; // fe80::/10 link-local
    return false;
  }
  // Hostname literals: nothing to check here — DNS resolution happens at
  // fetch time. Document the residual risk in the operator docs.
  return false;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasHeader(headers: Headers, name: string): boolean {
  return headers.has(name);
}

function buildHeaders(api: string, apiKey: string | undefined, configured: Record<string, string>): Headers {
  const headers = new Headers(configured);
  if (!hasHeader(headers, "accept")) headers.set("Accept", "application/json");
  if (!apiKey) return headers;

  if (api === "anthropic-messages") {
    if (!hasHeader(headers, "x-api-key")) headers.set("x-api-key", apiKey);
    if (!hasHeader(headers, "anthropic-version")) headers.set("anthropic-version", "2023-06-01");
  } else if (api === "google-generative-ai") {
    if (!hasHeader(headers, "x-goog-api-key")) headers.set("x-goog-api-key", apiKey);
  } else if (!hasHeader(headers, "authorization")) {
    headers.set("Authorization", `Bearer ${apiKey}`);
  }
  return headers;
}

export async function POST(req: Request) {
  if (!isApiRequestAllowed(req)) {
    return NextResponse.json({ error: "Untrusted API request" }, { status: 403 });
  }
  try {
    const body = await req.json() as { providerName?: unknown; provider?: unknown };
    const providerName = typeof body.providerName === "string" ? body.providerName.trim() : "";
    if (!providerName) return NextResponse.json({ error: "providerName is required" }, { status: 400 });
    if (!isRecord(body.provider)) return NextResponse.json({ error: "provider is required" }, { status: 400 });

    const baseUrl = typeof body.provider.baseUrl === "string" ? body.provider.baseUrl.trim() : "";
    if (!baseUrl) return NextResponse.json({ error: "Base URL is required" }, { status: 400 });
    const api = typeof body.provider.api === "string" && body.provider.api
      ? body.provider.api
      : "openai-completions";

    let endpoint: URL;
    try {
      endpoint = buildModelsListUrl(baseUrl, api);
    } catch {
      return NextResponse.json({ error: "Base URL is invalid" }, { status: 400 });
    }

    // SSRF block: refuse loopback / private / link-local upstreams.
    if (isBlockedHost(endpoint.hostname)) {
      return NextResponse.json({ error: `Refusing to fetch upstream: ${endpoint.hostname} is loopback, private, or link-local` }, { status: 400 });
    }
    if (endpoint.protocol !== "http:" && endpoint.protocol !== "https:") {
      return NextResponse.json({ error: `Refusing non-HTTP(S) upstream: ${endpoint.protocol}` }, { status: 400 });
    }

    const auth = await resolveModelDiscoveryAuth(providerName, body.provider);
    if (typeof body.provider.apiKey === "string" && body.provider.apiKey.trim() && !auth.apiKey) {
      return NextResponse.json({ error: `No API key found for "${providerName}"` }, { status: 400 });
    }

    const response = await fetch(endpoint, {
      cache: "no-store",
      headers: buildHeaders(api, auth.apiKey, auth.headers),
      signal: AbortSignal.timeout(DISCOVERY_TIMEOUT_MS),
    });
    const responseText = await response.text();
    if (!response.ok) {
      return NextResponse.json({
        error: responseText.slice(0, 500) || `Upstream returned HTTP ${response.status}`,
        status: response.status,
      }, { status: 502 });
    }

    let payload: unknown;
    try {
      payload = JSON.parse(responseText);
    } catch {
      return NextResponse.json({ error: "Upstream model list was not valid JSON" }, { status: 502 });
    }
    const models = parseDiscoveredModels(payload);
    if (models.length === 0) {
      return NextResponse.json({ error: "No models found in the upstream response" }, { status: 502 });
    }

    return NextResponse.json({ models, endpoint: endpoint.toString() });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = error instanceof DOMException && error.name === "TimeoutError" ? 504 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}

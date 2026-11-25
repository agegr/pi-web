import { existsSync } from "node:fs";
import { NextResponse } from "next/server";
import type { HttpProxySettingsResponse } from "@/lib/api-types";
import { getGlobalSettingsPath, readGlobalSettings, updateGlobalSettings } from "@/lib/global-settings-file";
import { parseHttpProxy, resolveHttpProxies, setHttpProxy } from "@/lib/http-dispatcher";
import { hasJsonContentType, isApiRequestAllowed } from "@/lib/request-security";

export const dynamic = "force-dynamic";

class MissingProxyError extends Error {}

function proxyResponse(proxyUrl: string | undefined) {
  const url = proxyUrl ? new URL(proxyUrl) : undefined;
  return NextResponse.json({
    enabled: !!url,
    // Display only: the saved URL may include proxy credentials.
    displayAddress: url ? `${url.protocol}//${url.host}` : null,
    sources: resolveHttpProxies(proxyUrl).sources,
  } satisfies HttpProxySettingsResponse, { headers: { "Cache-Control": "no-store" } });
}

function errorResponse(error: unknown) {
  const message = error instanceof SyntaxError ? "Invalid JSON in global settings.json"
    : error instanceof Error ? error.message : String(error);
  return NextResponse.json({ error: message }, { status: 500 });
}

export async function GET() {
  try {
    const proxyUrl = await readGlobalSettings(getGlobalSettingsPath(), (settings) => parseHttpProxy(settings.httpProxy));
    return proxyResponse(proxyUrl);
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PUT(req: Request) {
  if (!isApiRequestAllowed(req)) {
    return NextResponse.json({ error: "Untrusted API request" }, { status: 403 });
  }
  if (!hasJsonContentType(req)) {
    return NextResponse.json({ error: "Content-Type must be application/json" }, { status: 415 });
  }
  let body: { enabled?: unknown; httpProxy?: unknown; port?: unknown } | null;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (typeof body?.enabled !== "boolean") {
    return NextResponse.json({ error: "enabled must be a boolean" }, { status: 400 });
  }
  const proxyUrl = body.enabled ? parseHttpProxy(body.httpProxy) : undefined;
  const port = body.enabled && body.httpProxy === undefined ? body.port : undefined;
  if (port !== undefined && port !== null && (typeof port !== "number" || !Number.isInteger(port) || port < 1 || port > 65535)) {
    return NextResponse.json({ error: "Expected a port between 1 and 65535, or null for the default" }, { status: 400 });
  }
  if (body.enabled && port === undefined && !proxyUrl) {
    const missing = body.httpProxy == null || (typeof body.httpProxy === "string" && !body.httpProxy.trim());
    return NextResponse.json(missing
      ? { reason: "proxy-required", error: "A proxy URL is required" }
      : { reason: "invalid-proxy", error: "Invalid proxy URL" }, { status: 400 });
  }
  try {
    const settingsPath = getGlobalSettingsPath();
    if (proxyUrl || existsSync(settingsPath)) {
      await updateGlobalSettings(settingsPath, (settings) => {
        if (port !== undefined) {
          // The browser only sees the origin. Edit the port on the full URL from disk.
          const current = parseHttpProxy(settings.httpProxy);
          if (!current) throw new MissingProxyError();
          const url = new URL(current);
          url.port = port === null ? "" : String(port);
          settings.httpProxy = url.href;
        } else if (proxyUrl) settings.httpProxy = proxyUrl;
        else delete settings.httpProxy;
      });
    } else if (port !== undefined) {
      throw new MissingProxyError();
    }
    // Apply the latest saved value under the read lock, including a concurrent save.
    return await readGlobalSettings(settingsPath, (settings) => {
      const savedProxy = parseHttpProxy(settings.httpProxy);
      setHttpProxy(savedProxy);
      return proxyResponse(savedProxy);
    });
  } catch (error) {
    if (error instanceof MissingProxyError) return NextResponse.json({ error: "No configured proxy to edit" }, { status: 409 });
    return errorResponse(error);
  }
}

import { NextResponse } from "next/server";
import { applyEffectiveProxyConfiguration } from "@/lib/http-dispatcher";
import {
  clearSavedNetworkProxyConfig,
  resolveEffectiveNetworkProxy,
  toPublicNetworkProxyStatus,
  writeSavedNetworkProxyConfig,
} from "@/lib/network-proxy";
import { hasJsonContentType, isApiRequestAllowed } from "@/lib/request-security";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!isApiRequestAllowed(req)) {
    return NextResponse.json({ error: "Untrusted API request" }, { status: 403 });
  }
  return NextResponse.json(toPublicNetworkProxyStatus(await resolveEffectiveNetworkProxy()));
}

export async function PUT(req: Request) {
  if (!isApiRequestAllowed(req)) {
    return NextResponse.json({ error: "Untrusted API request" }, { status: 403 });
  }
  if (!hasJsonContentType(req)) {
    return NextResponse.json({ error: "Content-Type must be application/json" }, { status: 415 });
  }

  try {
    const body = await req.json() as {
      action?: unknown;
      enabled?: unknown;
      httpProxy?: unknown;
      httpsProxy?: unknown;
      noProxy?: unknown;
    };

    if (body.action === "clear") {
      clearSavedNetworkProxyConfig();
    } else {
      if (typeof body.enabled !== "boolean") {
        return NextResponse.json({ error: "enabled must be a boolean" }, { status: 400 });
      }
      for (const field of ["httpProxy", "httpsProxy", "noProxy"] as const) {
        if (body[field] !== undefined && typeof body[field] !== "string") {
          return NextResponse.json({ error: `${field} must be a string` }, { status: 400 });
        }
      }
      writeSavedNetworkProxyConfig({
        enabled: body.enabled,
        httpProxy: body.httpProxy as string | undefined,
        httpsProxy: body.httpsProxy as string | undefined,
        noProxy: body.noProxy as string | undefined,
      });
    }

    const resolved = await resolveEffectiveNetworkProxy();
    await applyEffectiveProxyConfiguration(resolved.effective);
    return NextResponse.json({ success: true, ...toPublicNetworkProxyStatus(resolved) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}

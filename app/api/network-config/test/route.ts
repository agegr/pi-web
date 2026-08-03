import { NextResponse } from "next/server";
import { createHttpDispatcher } from "@/lib/http-dispatcher";
import { normalizeProxySettings } from "@/lib/network-proxy";
import { hasJsonContentType, isApiRequestAllowed } from "@/lib/request-security";

export const dynamic = "force-dynamic";

const TEST_TIMEOUT_MS = 15_000;
const TEST_TARGETS = {
  anthropic: "https://api.anthropic.com/v1/models",
  openai: "https://api.openai.com/v1/models",
  google: "https://generativelanguage.googleapis.com/v1beta/models",
} as const;

type TestTarget = keyof typeof TEST_TARGETS;

export async function POST(req: Request) {
  if (!isApiRequestAllowed(req)) {
    return NextResponse.json({ ok: false, error: "Untrusted API request" }, { status: 403 });
  }
  if (!hasJsonContentType(req)) {
    return NextResponse.json({ ok: false, error: "Content-Type must be application/json" }, { status: 415 });
  }

  let dispatcher: ReturnType<typeof createHttpDispatcher> | undefined;
  try {
    const body = await req.json() as {
      target?: unknown;
      enabled?: unknown;
      httpProxy?: unknown;
      httpsProxy?: unknown;
      noProxy?: unknown;
    };
    if (typeof body.target !== "string" || !(body.target in TEST_TARGETS)) {
      return NextResponse.json({ ok: false, error: "Unknown proxy test target" }, { status: 400 });
    }
    if (typeof body.enabled !== "boolean") {
      return NextResponse.json({ ok: false, error: "enabled must be a boolean" }, { status: 400 });
    }
    for (const field of ["httpProxy", "httpsProxy", "noProxy"] as const) {
      if (body[field] !== undefined && typeof body[field] !== "string") {
        return NextResponse.json({ ok: false, error: `${field} must be a string` }, { status: 400 });
      }
    }

    const settings = normalizeProxySettings({
      enabled: body.enabled,
      httpProxy: body.httpProxy as string | undefined,
      httpsProxy: body.httpsProxy as string | undefined,
      noProxy: body.noProxy as string | undefined,
    });
    dispatcher = createHttpDispatcher(settings, TEST_TIMEOUT_MS);
    const target = body.target as TestTarget;
    const url = TEST_TARGETS[target];
    const startedAt = Date.now();
    const response = await fetch(url, {
      dispatcher,
      redirect: "manual",
      signal: AbortSignal.timeout(TEST_TIMEOUT_MS),
    } as RequestInit & { dispatcher: ReturnType<typeof createHttpDispatcher> });

    return NextResponse.json({
      ok: true,
      target,
      status: response.status,
      latencyMs: Date.now() - startedAt,
    });
  } catch (error) {
    return NextResponse.json({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  } finally {
    await dispatcher?.close().catch(() => {});
  }
}

import type { AuthEvent, AuthPrompt } from "@earendil-works/pi-ai";
import { randomBytes } from "node:crypto";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { invalidateModelsCache } from "@/lib/models-cache";
import { subscribeSessionInvalidation } from "@/lib/pi-web-auth";
import { authError, getAuthenticatedSession, getSessionToken, readAuthJson } from "@/lib/pi-web-auth-route";

export const dynamic = "force-dynamic";

// In-memory registry: loginToken -> resolve/reject for the manualCodeInput promise
declare global {
  var __piLoginCallbacks: Map<string, { resolve: (v: string) => void; reject: (e: Error) => void }> | undefined;
}

function getCallbackRegistry() {
  if (!globalThis.__piLoginCallbacks) globalThis.__piLoginCallbacks = new Map();
  return globalThis.__piLoginCallbacks;
}

// POST /api/auth/login/[provider] — frontend sends redirect URL or auth code
export async function POST(
  req: Request,
  { params }: { params: Promise<{ provider: string }> }
) {
  if (!getAuthenticatedSession(req).valid) return authError("未认证", 401);
  const { provider } = await params;
  let body: Record<string, unknown>;
  try {
    body = await readAuthJson(req);
  } catch (error) {
    const status = (error as { status?: number }).status;
    return authError(status ? (error as Error).message : "请求体无效", status ?? 400);
  }
  const { token, code } = body as { token?: string; code?: string };

  if (!token || !code) {
    return Response.json({ error: "token and code required" }, { status: 400 });
  }

  const registry = getCallbackRegistry();
  const callbacks = registry.get(token);
  if (!callbacks) {
    return Response.json({ error: "No pending login for token" }, { status: 404 });
  }
  // Verify token belongs to this provider (token format: "<provider>-<ts>-<random>")
  if (!token.startsWith(`${provider}-`)) {
    return Response.json({ error: "Token does not match provider" }, { status: 400 });
  }

  callbacks.resolve(code);
  registry.delete(token);
  return Response.json({ ok: true, provider });
}

// GET /api/auth/login/[provider] — SSE stream for OAuth flow
export async function GET(
  req: Request,
  { params }: { params: Promise<{ provider: string }> }
) {
  if (!getAuthenticatedSession(req).valid) return authError("未认证", 401);
  const { provider } = await params;
  if (req.signal.aborted) return new Response(null, { status: 204 });

  const encoder = new TextEncoder();
  // AbortController propagates client disconnect into ModelRuntime.login().
  const abort = new AbortController();
  req.signal.addEventListener("abort", () => abort.abort());
  let closed = false;
  let controller: ReadableStreamDefaultController | undefined;
  let cleanup = () => {
    if (closed) return;
    closed = true;
    abort.abort();
    try { controller?.close(); } catch { /* stream already closed */ }
  };

  const stream = new ReadableStream({
    async start(streamController) {
      controller = streamController;
      let unsubscribeAuth = () => {};
      const registry = getCallbackRegistry();
      const activeTokens = new Set<string>();
      let pendingManualRequest: { token: string; promise: Promise<string> } | undefined;

      cleanup = () => {
        if (closed) return;
        closed = true;
        abort.abort();
        for (const token of activeTokens) {
          registry.get(token)?.reject(new Error("Login cancelled"));
          registry.delete(token);
        }
        activeTokens.clear();
        unsubscribeAuth();
        try { controller?.close(); } catch { /* stream already closed */ }
      };

      const send = (data: unknown) => {
        if (closed) return;
        try {
          streamController.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
        } catch {
          cleanup();
        }
      };

      const sessionToken = getSessionToken(req);
      unsubscribeAuth = sessionToken
        ? subscribeSessionInvalidation(sessionToken, cleanup)
        : () => {};
      if (abort.signal.aborted) {
        cleanup();
        return;
      }
      if (closed) return;

      const modelRuntime = await ModelRuntime.create();
      if (closed) return;
      if (!modelRuntime.getProvider(provider)?.auth.oauth) {
        send({ type: "error", message: `Unknown provider: ${provider}` });
        cleanup();
        return;
      }

      const createClientInputRequest = () => {
        if (closed) throw new Error("Login cancelled");
        const token = `${provider}-${Date.now()}-${randomBytes(18).toString("base64url")}`;
        activeTokens.add(token);

        const promise = new Promise<string>((resolve, reject) => {
          registry.set(token, {
            resolve: (value) => {
              activeTokens.delete(token);
              registry.delete(token);
              resolve(value);
            },
            reject: (error) => {
              activeTokens.delete(token);
              registry.delete(token);
              reject(error);
            },
          });
        });

        return { token, promise };
      };

      const getManualInputRequest = () => {
        if (!pendingManualRequest) {
          pendingManualRequest = createClientInputRequest();
          pendingManualRequest.promise
            .finally(() => {
              pendingManualRequest = undefined;
            })
            .catch(() => {});
        }
        return pendingManualRequest;
      };

      // Also cancel on client disconnect
      abort.signal.addEventListener("abort", cleanup);

      try {
        await modelRuntime.login(provider, "oauth", {
          prompt: async (prompt: AuthPrompt) => {
            if (closed) throw new Error("Login cancelled");
            const request = prompt.type === "manual_code"
              ? getManualInputRequest()
              : createClientInputRequest();
            if (prompt.type === "select") {
              send({
                type: "select_request",
                message: prompt.message,
                options: prompt.options,
                token: request.token,
              });
            } else {
              send({
                type: "prompt_request",
                message: prompt.message,
                placeholder: prompt.placeholder ?? null,
                token: request.token,
              });
            }
            return request.promise;
          },
          notify: (event: AuthEvent) => {
            if (closed) return;
            if (event.type === "auth_url") {
              const request = getManualInputRequest();
              send({
                type: "auth",
                url: event.url,
                instructions: event.instructions ?? null,
                token: request.token,
              });
            } else if (event.type === "device_code") {
              send({
                type: "device_code",
                userCode: event.userCode,
                verificationUri: event.verificationUri,
                intervalSeconds: event.intervalSeconds ?? null,
                expiresInSeconds: event.expiresInSeconds ?? null,
              });
            } else {
              send({ type: "progress", message: event.message });
            }
          },
          signal: abort.signal,
        });

        invalidateModelsCache();
        send({ type: "success" });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg !== "Login cancelled") {
          send({ type: "error", message: msg });
        } else {
          send({ type: "cancelled" });
        }
      } finally {
        cleanup();
      }
    },
    cancel() {
      cleanup();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}

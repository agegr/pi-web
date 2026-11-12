import type { AuthEvent, AuthPrompt } from "@earendil-works/pi-ai";
import { randomUUID } from "node:crypto";
import { invalidateModelsCache } from "@/lib/models-cache";
import { createLoginOptions, createModelRuntimeWithExtensions } from "@/lib/model-runtime";

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
  const { provider } = await params;
  const { token, code } = (await req.json()) as { token?: string; code?: string };

  if (!token || !code) {
    return Response.json({ error: "token and code required" }, { status: 400 });
  }

  const registry = getCallbackRegistry();
  const callbacks = registry.get(token);
  if (!callbacks) {
    return Response.json({ error: "No pending login for token" }, { status: 404 });
  }
  // Verify token belongs to this provider (token format: "<provider>-<uuid>")
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
  const { provider } = await params;

  const encoder = new TextEncoder();
  let closed = false;
  const send = (controller: ReadableStreamDefaultController, data: unknown) => {
    if (closed) return;
    try {
      // A `notify` callback (e.g. from a provider's local OAuth callback
      // server reporting `listening`) can fire after the stream has already
      // been closed — either by `finally` below or by a client disconnect.
      // `desiredSize` is `null` once the controller is closed/errored, and
      // `enqueue` on a closed controller throws "Controller is already closed",
      // which otherwise escapes as an uncaughtException and kills the server.
      // Mirror the guard used in app/api/terminal/[id]/events/route.ts.
      if ((controller.desiredSize ?? 0) <= 0) {
        closed = true;
        return;
      }
      controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
    } catch {
      closed = true;
    }
  };

  // Login must survive a client (SSE) disconnect. kiro's OAuth/IDC flow opens a
  // local callback server and then polls a device code for 10–30s; if the
  // browser drops the EventSource (tab switch, proxy blip, a ~3.5s disconnect
  // seen in logs) we used to abort login() — which meant it never resolved, so
  // the credential was never persisted to auth.json and the provider stayed
  // "not authenticated" even though kiro itself logged in. Now we only close the
  // SSE and reject pending client-input prompts on disconnect; login keeps
  // running and persists its result, which the frontend picks up via
  // /api/auth/providers.
  const loginAbort = new AbortController();

  // Shared so `cancel()` (stream consumer disconnect) can reach the same
  // controller/cleanup that `start()` owns.
  let activeController: ReadableStreamDefaultController | null = null;
  let activeCleanup: (() => void) | null = null;

  const stream = new ReadableStream({
    async start(controller) {
      activeController = controller;
      const modelRuntime = await createModelRuntimeWithExtensions();
      if (!modelRuntime.getProvider(provider)?.auth.oauth) {
        send(controller, { type: "error", message: `Unknown provider: ${provider}` });
        controller.close();
        return;
      }

      const registry = getCallbackRegistry();
      const activeTokens = new Set<string>();
      let pendingManualRequest: { token: string; promise: Promise<string> } | undefined;

      const createClientInputRequest = () => {
        // Manual-code handshake token; crypto randomness so a pending OAuth
        // manual flow cannot be hijacked by predicting Math.random().
        const token = `${provider}-${randomUUID()}`;
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

      // Cleanup: remove pending token and abort any waiting promise
      const cleanup = () => {
        for (const token of activeTokens) {
          registry.get(token)?.reject(new Error("Login cancelled"));
          registry.delete(token);
        }
        activeTokens.clear();
      };
      activeCleanup = cleanup;

      // On client (SSE) disconnect: close the stream and reject any pending
      // client-input prompts (manual code / text), but do NOT abort loginAbort —
      // the OAuth device/IDC flow must run to completion so its credential gets
      // persisted to auth.json. The frontend reflects the final state via
      // /api/auth/providers.
      req.signal.addEventListener("abort", () => {
        closed = true;
        try {
          controller.close();
        } catch {
          /* already closed */
        }
        cleanup();
      });

      const loginOptions = createLoginOptions();
      try {
        await modelRuntime.login(provider, "oauth", {
          prompt: async (prompt: AuthPrompt) => {
            const request = prompt.type === "manual_code"
              ? getManualInputRequest()
              : createClientInputRequest();
            if (prompt.type === "select") {
              send(controller, {
                type: "select_request",
                message: prompt.message,
                options: prompt.options,
                token: request.token,
              });
            } else {
              send(controller, {
                type: "prompt_request",
                message: prompt.message,
                placeholder: prompt.placeholder ?? null,
                token: request.token,
              });
            }
            return request.promise;
          },
          notify: (event: AuthEvent) => {
            if (event.type === "auth_url") {
              const request = getManualInputRequest();
              send(controller, {
                type: "auth",
                url: event.url,
                instructions: event.instructions ?? null,
                token: request.token,
              });
            } else if (event.type === "device_code") {
              send(controller, {
                type: "device_code",
                userCode: event.userCode,
                verificationUri: event.verificationUri,
                intervalSeconds: event.intervalSeconds ?? null,
                expiresInSeconds: event.expiresInSeconds ?? null,
              });
            } else {
              send(controller, { type: "progress", message: event.message });
            }
          },
          signal: loginAbort.signal,
        }, loginOptions.options);

        invalidateModelsCache();
        send(controller, { type: "success" });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg !== "Login cancelled") {
          send(controller, { type: "error", message: msg });
        } else {
          send(controller, { type: "cancelled" });
        }
      } finally {
        cleanup();
        try {
          await loginOptions.flush();
        } catch {
          /* flush best-effort */
        }
        try {
          controller.close();
        } catch {
          /* already closed by client disconnect */
        }
        closed = true;
      }
    },
    cancel() {
      // Client cancelled the stream: close the SSE and reject any pending
      // client-input prompts, but do NOT abort loginAbort — let the OAuth flow
      // finish so credentials still get persisted.
      closed = true;
      try {
        activeController?.close();
      } catch {
        /* already closed */
      }
      activeCleanup?.();
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

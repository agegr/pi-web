import { AuthStorage } from "@mariozechner/pi-coding-agent";

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
  const { provider } = await params;

  const encoder = new TextEncoder();
  const send = (controller: ReadableStreamDefaultController, data: unknown) => {
    controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
  };

  // AbortController propagates client disconnect into authStorage.login()
  const abort = new AbortController();
  req.signal.addEventListener("abort", () => abort.abort());

  const stream = new ReadableStream({
    async start(controller) {
      const authStorage = AuthStorage.create();
      const providers = authStorage.getOAuthProviders();
      const providerInfo = providers.find((p) => p.id === provider);
      if (!providerInfo) {
        send(controller, { type: "error", message: `Unknown provider: ${provider}` });
        controller.close();
        return;
      }

      // Token to correlate the manual code POST
      const token = `${provider}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const registry = getCallbackRegistry();

      let manualCodeResolve: ((v: string) => void) | undefined;
      let manualCodeReject: ((e: Error) => void) | undefined;
      const manualCodePromise = new Promise<string>((resolve, reject) => {
        manualCodeResolve = resolve;
        manualCodeReject = reject;
      });

      // Register for POST callback
      registry.set(token, {
        resolve: manualCodeResolve!,
        reject: manualCodeReject!,
      });

      // Cleanup: remove pending token and abort any waiting promise
      const cleanup = () => {
        registry.delete(token);
        manualCodeReject?.(new Error("Login cancelled"));
      };

      // Also cancel on client disconnect
      abort.signal.addEventListener("abort", cleanup);

      try {
        await authStorage.login(provider, {
          onAuth: (info: { url: string; instructions?: string }) => {
            send(controller, {
              type: "auth",
              url: info.url,
              instructions: info.instructions ?? null,
              token,
            });
          },
          onPrompt: async (prompt: { message: string; placeholder?: string }) => {
            send(controller, {
              type: "prompt_request",
              message: prompt.message,
              placeholder: prompt.placeholder ?? null,
              token,
            });
            const value = await manualCodePromise;
            return value;
          },
          onProgress: (message: string) => {
            send(controller, { type: "progress", message });
          },
          onManualCodeInput: () => manualCodePromise,
          signal: abort.signal,
        });

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
        controller.close();
      }
    },
    cancel() {
      abort.abort();
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

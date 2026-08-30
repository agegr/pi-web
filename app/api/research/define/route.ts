import { createAgentSessionServices, getAgentDir, ModelRuntime } from "@earendil-works/pi-coding-agent";
import { hasJsonContentType, isApiRequestAllowed } from "@/lib/request-security";
import { projectTrustReloadOptions } from "@/lib/project-trust";
import { searchWeb } from "@/lib/web-search";
import {
  buildExplainMessages,
  buildFollowupMessages,
  buildWebContextBlock,
  MAX_CONTEXT_LENGTH,
  MAX_TERM_LENGTH,
  RESEARCH_DEPTH_ORDER,
  type ResearchAncestor,
  type ResearchDepth,
} from "@/lib/term-research";

export const dynamic = "force-dynamic";

const MAX_OUTPUT_TOKENS = 1200;

// Slow-path runtimes (created via full services so npm-package providers
// register their models) are cached per cwd: extension factories only need
// to run once, and plain ModelRuntime.create() would not see them.
const runtimeCacheKey = "__piResearchRuntimes";
const globalStore = globalThis as typeof globalThis & {
  [runtimeCacheKey]?: Map<string, Promise<ModelRuntime>>;
};

async function resolveRuntime(provider: string, cwd: string): Promise<ModelRuntime> {
  const fast = await ModelRuntime.create();
  if (fast.getModel(provider, "")) return fast;

  if (!globalStore[runtimeCacheKey]) globalStore[runtimeCacheKey] = new Map();
  const cache = globalStore[runtimeCacheKey];
  const cached = cache.get(cwd);
  if (cached) return cached;

  const promise = (async () => {
    const agentDir = getAgentDir();
    const trust = projectTrustReloadOptions(cwd, agentDir);
    const services = await createAgentSessionServices({
      cwd,
      agentDir,
      ...(trust ? { resourceLoaderReloadOptions: trust } : {}),
    });
    return services.modelRuntime;
  })();
  cache.set(cwd, promise);
  return promise;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sanitizeAncestors(value: unknown): ResearchAncestor[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(isRecord)
    .map((item) => ({
      term: typeof item.term === "string" ? item.term.slice(0, MAX_TERM_LENGTH) : "",
      summary: typeof item.summary === "string" ? item.summary.slice(0, 300) : "",
    }))
    .filter((item) => item.term.length > 0)
    .slice(0, 16);
}

export async function POST(req: Request) {
  if (!isApiRequestAllowed(req)) {
    return Response.json({ error: "Untrusted API request" }, { status: 403 });
  }
  if (!hasJsonContentType(req)) {
    return Response.json({ error: "Content-Type must be application/json" }, { status: 415 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json() as Record<string, unknown>;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const term = typeof body.term === "string" ? body.term.trim().slice(0, MAX_TERM_LENGTH) : "";
  if (!term) return Response.json({ error: "term is required" }, { status: 400 });

  const provider = typeof body.provider === "string" ? body.provider.trim() : "";
  const modelId = typeof body.modelId === "string" ? body.modelId.trim() : "";
  if (!provider || !modelId) {
    return Response.json({ error: "provider and modelId are required" }, { status: 400 });
  }

  const depth: ResearchDepth = RESEARCH_DEPTH_ORDER.includes(body.depth as ResearchDepth)
    ? (body.depth as ResearchDepth)
    : "standard";
  const lang = typeof body.lang === "string" && body.lang.trim() ? body.lang.trim().slice(0, 40) : "en";
  const context = typeof body.context === "string" ? body.context.slice(0, MAX_CONTEXT_LENGTH) : "";
  const ancestors = sanitizeAncestors(body.ancestors);
  const wantWeb = body.web === true;

  // "联网核实": look the term (or follow-up question) up on the web first
  // and inject the results as grounding context. Best-effort — a failed
  // search silently degrades to pure model knowledge.
  let webContext: string | undefined;
  if (wantWeb) {
    const mode = body.mode === "followup" ? "followup" : "explain";
    const question = mode === "followup" && typeof body.question === "string"
      ? body.question.trim().slice(0, 120)
      : "";
    const searchOutcome = await searchWeb(question ? `${term} ${question}` : term, {
      maxResults: 5,
      signal: req.signal,
    });
    if (searchOutcome.ok) {
      webContext = buildWebContextBlock(searchOutcome.query, searchOutcome.results);
    }
  }

  // Resolve model + credentials before switching to SSE: once the stream
  // starts, HTTP error statuses are no longer possible.
  let model;
  let resolved;
  let modelRuntime;
  try {
    const cwd = typeof body.cwd === "string" && body.cwd.trim() ? body.cwd.trim() : process.cwd();
    modelRuntime = await resolveRuntime(provider, cwd);
    const loadError = modelRuntime.getError();
    if (loadError) return Response.json({ error: loadError }, { status: 500 });
    model = modelRuntime.getModel(provider, modelId);
    if (!model) {
      return Response.json({ error: `Model not found: ${provider}/${modelId}` }, { status: 400 });
    }
    resolved = await modelRuntime.getAuth(model);
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
  if (!resolved || (!resolved.auth.apiKey && !resolved.auth.headers)) {
    return Response.json({ error: `No credentials found for "${provider}"` }, { status: 400 });
  }

  const messages = body.mode === "followup"
    ? (() => {
        const question = typeof body.question === "string" ? body.question.trim().slice(0, 500) : "";
        if (!question) return null;
        const parentExplanation = typeof body.parentExplanation === "string"
          ? body.parentExplanation
          : "";
        return buildFollowupMessages({
          term,
          explanation: parentExplanation,
          question,
          ancestors,
          depth,
          langName: mapLang(lang),
          webContext: webContext ?? undefined,
        });
      })()
    : buildExplainMessages({
        term,
        context,
        ancestors,
        depth,
        langName: mapLang(lang),
        webContext: webContext ?? undefined,
      });
  if (!messages) {
    return Response.json({ error: "question is required for followup mode" }, { status: 400 });
  }
  const { system, user } = messages;

  const encoder = new TextEncoder();
  const sse = (payload: Record<string, unknown>) =>
    encoder.encode(`data: ${JSON.stringify(payload)}\n\n`);

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const send = (payload: Record<string, unknown>) => {
        if (!closed) controller.enqueue(sse(payload));
      };
      if (wantWeb) {
        send({ type: "web", status: webContext ? "ok" : "failed" });
      }
      try {
        // streamSimple on the runtime (not pi-ai's standalone one) so
        // package-registered custom API providers are available.
        const events = modelRuntime.streamSimple(model, {
          messages: [
            { role: "user", content: user, timestamp: Date.now() },
          ],
          systemPrompt: system,
        }, {
          apiKey: resolved.auth.apiKey,
          headers: resolved.auth.headers,
          maxTokens: MAX_OUTPUT_TOKENS,
          maxRetries: 1,
          cacheRetention: "none",
          signal: req.signal,
        });

        for await (const event of events) {
          if (event.type === "text_delta" && event.delta) {
            send({ type: "delta", text: event.delta });
          } else if (event.type === "thinking_delta" && event.delta) {
            // Stream the model's reasoning so the wait is visible instead of
            // a silent spinner.
            send({ type: "thinking", text: event.delta });
          }
        }

        const final = await events.result();
        if (final.stopReason === "error" || final.stopReason === "aborted") {
          send({ type: "error", error: final.errorMessage ?? "Model request failed" });
        } else {
          send({ type: "done" });
        }
      } catch (error) {
        send({ type: "error", error: error instanceof Error ? error.message : String(error) });
      } finally {
        closed = true;
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

function mapLang(lang: string): string {
  if (lang === "zh-CN") return "Simplified Chinese (简体中文)";
  if (lang === "zh-TW") return "Traditional Chinese (繁體中文)";
  return "English";
}

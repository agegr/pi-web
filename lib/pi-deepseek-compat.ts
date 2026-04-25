/**
 * Pi DeepSeek + anthropic-messages thinking compatibility shim.
 *
 * Pi's anthropic provider only emits `output_config: {effort}` (with
 * `thinking: {type: "adaptive"}`) for hard-coded Anthropic Claude model ids
 * (Opus 4.6/4.7, Sonnet 4.6). For third-party DeepSeek V4 endpoints that speak
 * the anthropic-messages protocol, DeepSeek expects this same effort field —
 * but pi falls into the budget-based branch and sends
 * `thinking: {type: "enabled", budget_tokens: N}` instead, which the
 * proxy doesn't translate into the right back-end thinking strength.
 *
 * This shim re-registers the `anthropic-messages` api provider with a wrapper
 * that, for deepseek models, rewrites the outgoing payload to the adaptive
 * shape via the `onPayload` hook so the request body matches what
 * `provider=deepseek` would send through openai-completions (i.e.
 * minimal/low/medium/high → "high", xhigh → "max").
 */

import {
  registerApiProvider,
  streamAnthropic,
  streamSimpleAnthropic,
  type Api,
  type Model,
  type Context,
  type SimpleStreamOptions,
  type AnthropicOptions,
  type AnthropicEffort,
  type ThinkingLevel,
  type AssistantMessageEventStream,
} from "@mariozechner/pi-ai";

function isDeepseekModel(model: Model<"anthropic-messages">): boolean {
  const id = (model.id || "").toLowerCase();
  return id.includes("deepseek");
}

function mapDeepseekEffort(level: ThinkingLevel | undefined): AnthropicEffort | undefined {
  if (!level) return undefined;
  switch (level) {
    case "minimal":
    case "low":
    case "medium":
    case "high":
      return "high";
    case "xhigh":
      return "max";
    default:
      return undefined;
  }
}

interface AdaptiveThinkingPayload {
  thinking?: { type: string; budget_tokens?: number; display?: string };
  output_config?: { effort: string };
  max_tokens?: number;
  [key: string]: unknown;
}

/** Chain user-provided onPayload (if any) after our deepseek rewrite */
function buildOnPayload(
  effort: AnthropicEffort,
  display: "summarized" | "omitted" | undefined,
  userOnPayload: ((payload: unknown, model: Model<Api>) => unknown) | undefined,
) {
  return async (payload: unknown, model: Model<Api>) => {
    const p = payload as AdaptiveThinkingPayload;
    p.thinking = { type: "adaptive", ...(display ? { display } : {}) };
    p.output_config = { effort };
    // Drop any pre-existing budget-based fields just in case
    delete (p.thinking as { budget_tokens?: number }).budget_tokens;
    const next = await userOnPayload?.(p, model);
    return next ?? p;
  };
}

function wrapStreamSimple(
  model: Model<"anthropic-messages">,
  context: Context,
  options: SimpleStreamOptions | undefined,
): AssistantMessageEventStream {
  if (!options?.reasoning || !isDeepseekModel(model)) {
    return streamSimpleAnthropic(model, context, options);
  }
  const effort = mapDeepseekEffort(options.reasoning);
  if (!effort) {
    return streamSimpleAnthropic(model, context, options);
  }
  // Call streamAnthropic directly with adaptive shape; rewrite payload via onPayload
  // to bypass pi's hard-coded supportsAdaptiveThinking() guard.
  const display = (options as { thinkingDisplay?: "summarized" | "omitted" }).thinkingDisplay;
  const anthropicOptions: AnthropicOptions = {
    ...options,
    thinkingEnabled: true,
    effort,
    onPayload: buildOnPayload(effort, display, options.onPayload as never),
  };
  return streamAnthropic(model, context, anthropicOptions);
}

function wrapStream(
  model: Model<"anthropic-messages">,
  context: Context,
  options: AnthropicOptions | undefined,
): AssistantMessageEventStream {
  // Only intercept when the budget-based path would have been taken
  if (!options?.thinkingEnabled || !isDeepseekModel(model)) {
    return streamAnthropic(model, context, options);
  }
  // If caller already supplied an effort (adaptive), trust them
  if (options.effort) {
    return streamAnthropic(model, context, options);
  }
  // Derive an effort from any user-visible reasoning hint baked in via budget tokens.
  // We only get here if pi's high-level wrapper set thinkingBudgetTokens; we don't
  // have the original ThinkingLevel here, so default to "high".
  const effort: AnthropicEffort = "high";
  return streamAnthropic(model, context, {
    ...options,
    effort,
    onPayload: buildOnPayload(effort, options.thinkingDisplay, options.onPayload as never),
  });
}

let installed = false;

/**
 * Install the deepseek + anthropic-messages compatibility shim. Idempotent.
 * Must be called once on the Node/Next.js server before any agent session
 * is created.
 */
export function installPiDeepseekCompat(): void {
  if (installed) return;
  installed = true;
  registerApiProvider({
    api: "anthropic-messages",
    stream: wrapStream as never,
    streamSimple: wrapStreamSimple as never,
  });
}

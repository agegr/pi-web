/**
 * The provider-usage tool.
 *
 * Server-only (loaded by the extension). Reads subscription quota through the
 * pi model registry's own provider auth, so no credentials ever pass through
 * this tool.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { fetchSubscriptionUsage, formatSubscriptionUsage } from "./provider-usage.ts";

export function registerProviderTools(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "provider_usage",
    label: "Check provider usage",
    description:
      "Read the current account-level subscription quota usage and reset times reported by OpenAI Codex and Anthropic Claude. Returns percentages and timestamps only; never returns credentials.",
    promptSnippet: "provider_usage — read OpenAI and Anthropic subscription quota windows",
    promptGuidelines: [
      "Use provider_usage whenever the user asks about account quota, subscription allowance, remaining model usage, or reset times; never estimate those values.",
    ],
    parameters: Type.Object({}),
    async execute(_toolCallId, _params, signal, _onUpdate, ctx) {
      const usage = await fetchSubscriptionUsage(
        async (provider) => {
          const resolved = await ctx.modelRegistry.getProviderAuth(provider);
          return { token: resolved?.auth.apiKey, source: resolved?.source };
        },
        { signal },
      );
      return {
        content: [{ type: "text", text: formatSubscriptionUsage(usage) }],
        details: { providers: usage },
      };
    },
  });
}

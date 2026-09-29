import type { InlineExtension } from "@earendil-works/pi-coding-agent";

export const EXACT_SYSTEM_PROMPT_EXTENSION_NAME = "pi-web-exact-system-prompt";

/**
 * Replace the whole system prompt of every agent run with the text `getPrompt` returns.
 *
 * Pi 0.86 moved the prompt into the session transcript: `agent.state.systemPrompt` is
 * replayed from persisted system messages and can no longer be assigned, and the agent
 * loop's request context carries no `systemPrompt` field. The one supported way for a
 * host to send an exact prompt is a `before_agent_start` handler returning
 * `systemPrompt`: the SDK projects that text as the provider's leading system prompt
 * for the run while the transcript keeps recording Pi's structured sections.
 *
 * Used for Chat-only sessions (context files only) and subagent profiles whose prompt
 * mode replaces Pi's prompt. `getPrompt` is read on every run, so a session that reloads
 * its context files sends the new contents on its next prompt.
 */
export function createExactSystemPromptExtension(
  getPrompt: () => string | undefined,
): InlineExtension {
  return {
    name: EXACT_SYSTEM_PROMPT_EXTENSION_NAME,
    hidden: true,
    factory: (pi) => {
      pi.on("before_agent_start", () => {
        const systemPrompt = getPrompt();
        return systemPrompt === undefined ? undefined : { systemPrompt };
      });
    },
  };
}

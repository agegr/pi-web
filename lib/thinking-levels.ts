import type { ThinkingLevel } from "@earendil-works/pi-agent-core";

// pi-ai's MODEL_THINKING_LEVELS, spelled out so client code can use it
// without loading pi's schema module; thinking-levels.test.mjs keeps the two equal.
export const THINKING_LEVELS: readonly ThinkingLevel[] = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];

const THINKING_LEVEL_SET: ReadonlySet<string> = new Set(THINKING_LEVELS);

export function isThinkingLevel(value: unknown): value is ThinkingLevel {
  return typeof value === "string" && THINKING_LEVEL_SET.has(value);
}

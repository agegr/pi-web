import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const PLAN_TOOL_NAMES = new Set(["read", "grep", "find", "ls", "questionnaire"]);
const STATE_TYPE = "pi-web-plan-mode";

interface PlanModeState {
  enabled: boolean;
  previousTools?: string[];
}

function isPlanModeState(value: unknown): value is PlanModeState {
  if (!value || typeof value !== "object") return false;
  const state = value as { enabled?: unknown; previousTools?: unknown };
  return typeof state.enabled === "boolean"
    && (state.previousTools === undefined
      || (Array.isArray(state.previousTools) && state.previousTools.every((tool) => typeof tool === "string")));
}

export function getPlanToolNames(availableTools: string[]): string[] {
  return availableTools.filter((tool) => PLAN_TOOL_NAMES.has(tool));
}

export function isPlanBlockedTool(toolName: string): boolean {
  return !PLAN_TOOL_NAMES.has(toolName);
}

export function planModeExtension(pi: ExtensionAPI): void {
  let enabled = false;
  let previousTools: string[] | undefined;

  const updateStatus = (setStatus: (key: string, text: string | undefined) => void) => {
    setStatus("plan-mode", enabled ? "PLAN" : undefined);
  };

  const enable = () => {
    previousTools ??= pi.getActiveTools();
    pi.setActiveTools(getPlanToolNames(pi.getAllTools().map((tool) => tool.name)));
  };

  const persist = () => pi.appendEntry<PlanModeState>(STATE_TYPE, { enabled, previousTools });

  pi.registerCommand("plan", {
    description: "Toggle read-only plan mode",
    handler: async (_args, ctx) => {
      enabled = !enabled;
      if (enabled) {
        enable();
      } else if (previousTools) {
        pi.setActiveTools(previousTools);
        previousTools = undefined;
      }
      updateStatus(ctx.ui.setStatus);
      persist();
      ctx.ui.notify(enabled
        ? "Plan mode enabled. Only read-only exploration tools are available."
        : "Plan mode disabled. Previous tools restored.");
    },
  });

  pi.on("before_agent_start", () => {
    if (!enabled) return;
    return {
      message: {
        customType: "pi-web-plan-context",
        content: `[PLAN MODE ACTIVE]
Explore and reason without changing files or running shell commands. Ask clarifying questions when needed, then return a concrete numbered plan. Do not implement the plan until plan mode is disabled.`,
        display: false,
      },
    };
  });

  pi.on("tool_call", (event) => {
    if (!enabled || !isPlanBlockedTool(event.toolName)) return;
    return {
      block: true,
      reason: "Plan mode is read-only. Disable plan mode before using this tool.",
    };
  });

  pi.on("context", (event) => {
    if (enabled) return;
    return {
      messages: event.messages.filter((message) => (
        !("customType" in message) || message.customType !== "pi-web-plan-context"
      )),
    };
  });

  pi.on("session_start", (_event, ctx) => {
    const entry = [...ctx.sessionManager.getEntries()].reverse().find((candidate) => (
      candidate.type === "custom" && candidate.customType === STATE_TYPE
    ));
    if (entry?.type === "custom" && isPlanModeState(entry.data)) {
      enabled = entry.data.enabled;
      previousTools = entry.data.previousTools;
    }
    if (enabled) enable();
    updateStatus(ctx.ui.setStatus);
  });
}

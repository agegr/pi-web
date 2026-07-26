import type { ExtensionFactory } from "@earendil-works/pi-coding-agent";

export const SESSION_POLICY_ENTRY_TYPE = "pi-web-session-policy";
export const MAX_SESSION_GOAL_LENGTH = 4000;
export const PLAN_MODE_TOOLS = ["read", "grep", "find", "ls"] as const;

export type SessionMode = "execute" | "plan";

export interface SessionPolicy {
  goal: string;
  mode: SessionMode;
  toolsBeforePlan: string[];
}

export const EMPTY_SESSION_POLICY: SessionPolicy = {
  goal: "",
  mode: "execute",
  toolsBeforePlan: [],
};

type PolicyEntry = {
  type?: unknown;
  customType?: unknown;
  data?: unknown;
};

function normalizeToolNames(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((name): name is string => typeof name === "string" && name.length > 0))];
}

export function normalizeSessionPolicy(value: unknown): SessionPolicy {
  const candidate = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const goal = typeof candidate.goal === "string" ? candidate.goal.trim() : "";
  if (goal.length > MAX_SESSION_GOAL_LENGTH) {
    throw new Error(`Session goal must be ${MAX_SESSION_GOAL_LENGTH} characters or fewer`);
  }

  return {
    goal,
    mode: candidate.mode === "plan" ? "plan" : "execute",
    toolsBeforePlan: normalizeToolNames(candidate.toolsBeforePlan),
  };
}

export function getSessionPolicyFromEntries(entries: readonly PolicyEntry[]): SessionPolicy {
  for (let i = entries.length - 1; i >= 0; i -= 1) {
    const entry = entries[i];
    if (entry?.type === "custom" && entry.customType === SESSION_POLICY_ENTRY_TYPE) {
      try {
        return normalizeSessionPolicy(entry.data);
      } catch {
        // A manually edited or newer-version entry must not make a session unloadable.
      }
    }
  }
  return { ...EMPTY_SESSION_POLICY, toolsBeforePlan: [] };
}

function escapePolicyDelimiter(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

export function getToolsForPolicyTransition(previous: SessionPolicy, next: SessionPolicy): string[] | null {
  if (next.mode === "plan") return [...PLAN_MODE_TOOLS];
  if (previous.mode === "plan") return [...previous.toolsBeforePlan];
  return null;
}

export function buildSessionPolicyPrompt(policy: SessionPolicy): string {
  const sections: string[] = [];
  if (policy.goal) {
    sections.push(`The user has set the following persistent session goal. Keep advancing it when relevant, but the user's current request and explicit constraints take precedence. Do not invent work or continue autonomously.\n\n<session_goal>\n${escapePolicyDelimiter(policy.goal)}\n</session_goal>`);
  }
  if (policy.mode === "plan") {
    sections.push(`PLAN MODE ACTIVE\nYou are in a read-only planning mode. Inspect relevant files and context, ask focused clarifying questions when needed, and produce or refine an actionable plan. Do not implement, edit files, or run commands that can change state. Clearly identify assumptions, risks, and validation steps.`);
  }
  return sections.join("\n\n");
}

export function createSessionPolicyExtension(getPolicy: () => SessionPolicy): { name: string; hidden: true; factory: ExtensionFactory } {
  return {
    name: "pi-web-session-policy",
    hidden: true,
    factory(pi) {
      pi.on("before_agent_start", (event) => {
        const policyPrompt = buildSessionPolicyPrompt(getPolicy());
        if (!policyPrompt) return;
        return { systemPrompt: `${event.systemPrompt}\n\n${policyPrompt}` };
      });
    },
  };
}

import type { SubagentProfile, SubagentScope } from "./subagents";

const SUBAGENT_SCOPE_PRIORITY: Record<SubagentScope, number> = {
  builtin: 0,
  global: 1,
  workspace: 2,
  project: 3,
};

export function isSubagentProfileOverridden(
  profile: Pick<SubagentProfile, "name" | "scope">,
  profiles: readonly Pick<SubagentProfile, "name" | "scope">[],
): boolean {
  const name = profile.name.toLowerCase();
  const priority = SUBAGENT_SCOPE_PRIORITY[profile.scope];
  return profiles.some((candidate) =>
    candidate.name.toLowerCase() === name
    && SUBAGENT_SCOPE_PRIORITY[candidate.scope] > priority
  );
}

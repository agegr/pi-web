import type { SourceSkill } from "./types";

export const providerLabels: Record<SourceSkill["provider"], string> = { "skills.sh": "skills.sh", skillsmp: "SkillsMP", "agentskill.sh": "agentskill.sh" };
export function isProvider(value: unknown): value is SourceSkill["provider"] {
  return typeof value === "string" && Object.hasOwn(providerLabels, value);
}

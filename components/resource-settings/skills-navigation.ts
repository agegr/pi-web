import type { SkillNavItem } from "./resource-settings-types";

export interface FilteredSkillsNavigation {
  active: SkillNavItem[];
  dormant: SkillNavItem[];
  /** Dormant group is shown when searching or when explicitly expanded. */
  dormantOpen: boolean;
}

export function skillIdentity(skill: Pick<SkillNavItem, "filePath">): string {
  return skill.filePath;
}

export function filterSkillsNavigation(
  skills: readonly SkillNavItem[],
  query: string,
  dormantOpen: boolean,
): FilteredSkillsNavigation {
  const q = query.trim().toLocaleLowerCase();
  const matches = (skill: SkillNavItem): boolean => {
    if (!q) return true;
    return [skill.name, skill.description, skill.filePath]
      .some((value) => value.toLocaleLowerCase().includes(q));
  };
  const filtered = skills.filter(matches);
  const active = filtered.filter((skill) => !skill.disableModelInvocation);
  const dormant = filtered.filter((skill) => skill.disableModelInvocation);
  return {
    active,
    dormant,
    dormantOpen: q ? dormant.length > 0 : dormantOpen,
  };
}

export function resolveSkillsSelection(
  selected: string | null,
  skills: readonly SkillNavItem[],
): string | null {
  if (!selected) return null;
  return skills.some((skill) => skill.filePath === selected) ? selected : null;
}

export function skillsSelectionLabel(
  selected: string | null,
  skills: readonly SkillNavItem[],
): { title: string; subtitle?: string } {
  const skill = skills.find((item) => item.filePath === selected);
  return skill ? { title: skill.name, subtitle: skill.filePath } : { title: "" };
}

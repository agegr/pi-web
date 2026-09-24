import { readFileSync } from "fs";
import {
  formatSkillsForPrompt,
  type InlineExtension,
  type ResourceDiagnostic,
  type Skill,
} from "@earendil-works/pi-coding-agent";
import { parseFrontmatter } from "./frontmatter";

/**
 * Keep only the skills a profile's `skills:` list names.
 *
 * undefined keeps every discovered skill (the `skills: true` spelling) and an
 * empty scope keeps none (`skills: []`). Names are matched exactly, the way
 * pi-subagents resolves them.
 *
 * Unscoped discovery respects `disable-model-invocation`, like Pi's own skill
 * catalog. A named scope is different: it is an explicit user preload, matching
 * pi-subagents, so an explicitly named skill is still selected.
 */
export function selectSubagentSkills(
  skills: readonly Skill[],
  scope: readonly string[] | undefined,
): Skill[] {
  if (scope === undefined) {
    return skills.filter((skill) => !skill.disableModelInvocation);
  }
  const byName = new Map(skills.map((skill) => [skill.name, skill]));
  return [...new Set(scope)].flatMap((name) => {
    const skill = byName.get(name);
    return skill ? [skill] : [];
  });
}

/**
 * A resource-loader override that narrows discovery to the profile scope.
 *
 * The loader discovers the same skills a plain Pi session sees (default roots,
 * project and user `.agents/skills`, settings and package skills), so replace
 * mode formats this result instead of scanning its own roots — that is what
 * keeps both prompt modes and pi-subagents looking at the same skill set.
 */
export function subagentSkillsOverride(
  scope: readonly string[] | undefined,
): (base: { skills: Skill[]; diagnostics: ResourceDiagnostic[] }) => {
  skills: Skill[];
  diagnostics: ResourceDiagnostic[];
} {
  return (base) => ({ ...base, skills: selectSubagentSkills(base.skills, scope) });
}

/**
 * Render skills as self-contained prompt blocks in Pi's `/skill:` expansion
 * shape: name and location, a relative-path hint, and the frontmatter-stripped
 * body.
 *
 * A skill whose file cannot be read is dropped rather than thrown: discovery
 * happened in an earlier pass, so one stale entry out of many must not sink the
 * whole run.
 */
export function formatSubagentSkillBlocks(skills: readonly Skill[]): string[] {
  return skills.flatMap((skill) => {
    let source: string;
    try {
      source = readFileSync(skill.filePath, "utf8");
    } catch {
      return [];
    }
    const { rest } = parseFrontmatter(source);
    return [
      `<skill name="${skill.name}" location="${skill.filePath}">\n`
      + `References are relative to ${skill.baseDir}.\n\n${rest.trim()}\n</skill>`,
    ];
  });
}

/**
 * Append explicitly preloaded skill bodies to Pi's normal prompt.
 *
 * Used by append-mode profiles. The getter runs on every turn, so edits to
 * SKILL.md are picked up without persisting skill bodies in the child snapshot.
 */
export function createSubagentSkillPreloadExtension(
  getSkillText: () => string | undefined,
): InlineExtension {
  return {
    name: "pi-web-subagent-skill-preload",
    hidden: true,
    factory: (pi) => {
      pi.on("before_agent_start", (event) => {
        const skillText = getSkillText()?.trim();
        if (!skillText) return undefined;
        return { systemPrompt: `${event.systemPrompt}\n\n${skillText}` };
      });
    },
  };
}

/**
 * The skill text a profile preloads into its system prompt.
 *
 * An explicit `skills:` list inlines those bodies — the profile named them, so
 * the count is bounded by a deliberate choice. Everything else is Pi's
 * on-demand listing, wrapped the way Pi wraps its own `<skills>` section, which
 * is how a plain session exposes skills too: with no scope there is nothing
 * bounding the set, and inlining every installed skill costs the full text of all
 * of them on every request when the subagent can read the one it needs.
 *
 * The listing is omitted entirely when the subagent has no tool that could open a
 * skill file, matching Pi's own `skillFileReadTool` gate — a listing that names a
 * tool the profile did not get is worse than no listing.
 */
export function subagentSkillPromptText(options: {
  skills: readonly Skill[];
  scope?: readonly string[];
  tools: readonly string[];
}): string {
  const { skills, scope, tools } = options;
  const selected = selectSubagentSkills(skills, scope);
  if (selected.length === 0) return "";
  // Inlined bodies need no tool, so the explicit-scope branch renders regardless.
  if (scope?.length) return formatSubagentSkillBlocks(selected).join("\n\n");
  // Pi picks the same pair in the same order; `bash` may already have been
  // resolved to `powershell` upstream, so neither name being active is possible.
  const readTool = (["read", "bash"] as const).find((tool) => tools.includes(tool));
  if (!readTool) return "";
  return `<skills>\n${formatSkillsForPrompt([...selected], readTool).trim()}\n</skills>`;
}

import { readFileSync } from "node:fs";
import { formatSkillsForPrompt, type DefaultResourceLoader, type InlineExtension, type Skill } from "@earendil-works/pi-coding-agent";
import { parseFrontmatter } from "./frontmatter";
import { validateSubagentSkills } from "./subagents";

/** One discovery binding and one prompt projection, shared by spawn and reopen. */
export function createSubagentSkillsBinding(options: {
  loadSkills: boolean;
  skills?: readonly string[];
  exactSystemPrompt?: string;
}) {
  const names = options.skills === undefined ? undefined : validateSubagentSkills(options.skills);
  let discovered: Skill[] = [];
  let activeTools: () => readonly string[] = () => [];
  let effectiveExactPrompt = options.exactSystemPrompt;
  const suffix = (): string => {
    if (!options.loadSkills) return "";
    if (names === undefined) {
      const tools = activeTools();
      const reader = tools.includes("read") ? "read" : tools.includes("bash") ? "bash" : undefined;
      return reader ? formatSkillsForPrompt(discovered, reader) : "";
    }
    return names.map((name) => {
      if (name.length > 128 || !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(name)) {
        return `Skill ${JSON.stringify(name)} skipped: unsafe name.`;
      }
      const skill = discovered.find((item) => item.name === name);
      if (!skill) return `Skill ${JSON.stringify(name)} not found in SDK discovery.`;
      try {
        const { rest } = parseFrontmatter(readFileSync(skill.filePath, "utf8"));
        return `## Skill: ${name}\nLocation: ${skill.filePath}\nBase directory for relative references: ${skill.baseDir}\n\n${rest.trim()}`;
      } catch (error) {
        return `Skill ${JSON.stringify(name)} unreadable at ${skill.filePath}: ${error instanceof Error ? error.message : String(error)}`;
      }
    }).join("\n\n");
  };
  const compose: InlineExtension = {
    name: "pi-web-subagent-skills",
    hidden: true,
    factory: (pi) => {
      pi.on("before_agent_start", (event) => {
        const base = options.exactSystemPrompt ?? event.systemPrompt;
        const skillsText = suffix();
        const prompt = skillsText ? `${base}\n\n${skillsText}` : base;
        if (options.exactSystemPrompt !== undefined) effectiveExactPrompt = prompt;
        return { systemPrompt: prompt };
      });
    },
  };
  const needsProjection = (options.loadSkills && names !== undefined) || options.exactSystemPrompt !== undefined;
  const loaderOptions: Pick<ConstructorParameters<typeof DefaultResourceLoader>[0], "noSkills" | "skillsOverride" | "extensionFactories"> = {
    noSkills: !options.loadSkills,
    ...(!options.loadSkills || needsProjection ? {
      skillsOverride: (base) => {
        // Keep SDK collision winners and diagnostics, but hide the catalog in named mode.
        discovered = base.skills;
        return !options.loadSkills || names !== undefined ? { ...base, skills: [] } : base;
      },
    } : {}),
    ...(needsProjection ? { extensionFactories: [compose] } : {}),
  };
  return {
    loaderOptions,
    setActiveToolsGetter(getter: () => readonly string[]) { activeTools = getter; },
    getExactSystemPrompt: options.exactSystemPrompt === undefined ? undefined : () => effectiveExactPrompt!,
  };
}

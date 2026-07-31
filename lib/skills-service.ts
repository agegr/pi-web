import { readFileSync } from "fs";
import { getAgentDir, loadSkills } from "@oh-my-pi/pi-coding-agent";
import { parseFrontmatter } from "@oh-my-pi/pi-utils";
import type { SkillInfo, SkillsResponse } from "@/lib/api-types";
import { annotateSkillsWithInstallInfo } from "@/lib/skill-lock";
import { getProjectTrustStatus } from "@/lib/project-trust";
import { getSettingsForCwd } from "@/lib/omp-runtime";

/**
 * Skills exactly as an omp session would see them.
 *
 * `loadSkills` is the same entry point `createAgentSession` uses, so the panel
 * lists `.omp/skills`, `~/.omp/agent/skills`, `.claude/skills`, plugin skills
 * and `.agents/skills` with omp's own precedence and collision warnings.
 */
export async function loadSkillsWithInstallInfo(cwd: string): Promise<SkillsResponse> {
  const agentDir = getAgentDir();
  const settings = await getSettingsForCwd(cwd);
  const { skills, warnings } = await loadSkills({ cwd, ...settings.getGroup("skills") });

  const infos: SkillInfo[] = skills.map((skill) => ({
    name: skill.name,
    description: skill.description,
    filePath: skill.filePath,
    baseDir: skill.baseDir,
    disableModelInvocation: readDisableModelInvocation(skill.filePath),
    sourceInfo: {
      ...(skill.source ? { source: skill.source } : {}),
      ...(skill._source?.level ? { scope: skill._source.level } : {}),
    },
  }));

  return {
    skills: annotateSkillsWithInstallInfo(infos, { cwd, agentDir }),
    diagnostics: warnings.map((warning) => ({
      type: "warning" as const,
      message: warning.message,
      path: warning.skillPath,
    })),
    projectResourcesLoaded: getProjectTrustStatus(cwd, agentDir).trusted,
  };
}

/**
 * omp's `Skill` does not carry the raw frontmatter, and the toggle in the panel
 * edits exactly one key, so read it back from the file the skill came from.
 */
function readDisableModelInvocation(filePath: string): boolean {
  try {
    const { frontmatter } = parseFrontmatter(readFileSync(filePath, "utf8"));
    return Boolean(frontmatter["disable-model-invocation"]);
  } catch {
    return false;
  }
}

import { DefaultResourceLoader, getAgentDir } from "@earendil-works/pi-coding-agent";
import type { SkillInfo, SkillsResponse } from "@/lib/api-types";
import { annotateSkillsWithInstallInfo } from "@/lib/skill-lock";
import { runAgentServiceLoad } from "@/lib/agent-session-services";
import { getProjectTrustStatus, projectTrustReloadOptions } from "@/lib/project-trust";

export async function loadSkillsWithInstallInfo(cwd: string): Promise<SkillsResponse> {
  const agentDir = getAgentDir();
  // This endpoint only enumerates static skills. It has no session runtime to
  // dispatch resources_discover or session_shutdown, so evaluating extension
  // factories here can only leak factory-level state such as pi-chrome's
  // process singleton into the next real AgentSession.
  const loader = new DefaultResourceLoader({ cwd, agentDir, noExtensions: true });
  await runAgentServiceLoad(
    () => loader.reload(projectTrustReloadOptions(cwd, agentDir)),
    { transientExtensions: true },
  );
  const { skills, diagnostics } = loader.getSkills();
  return {
    skills: annotateSkillsWithInstallInfo(skills as SkillInfo[], { cwd, agentDir }),
    diagnostics,
    projectResourcesLoaded: getProjectTrustStatus(cwd, agentDir).trusted,
  };
}

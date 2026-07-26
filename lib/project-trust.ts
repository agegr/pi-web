import { hasTrustRequiringProjectResources, ProjectTrustStore } from "@earendil-works/pi-coding-agent";

/**
 * Reload options that gate project-local, trust-requiring resources — a
 * repository's `.pi/extensions`, project `.pi/settings.json` extension
 * entries, and `.agents/skills` — behind the SDK's project-trust store.
 *
 * Pi Web *executes* project extensions when it builds session services: their
 * factory runs on import and their `session_start` handlers run on startup.
 * Without a trust gate, merely opening an untrusted repository in Pi Web runs
 * repository-controlled code locally (issue #236). The SDK's resource loader
 * only imports project extensions once `resolveProjectTrust` resolves true, so
 * denying trust keeps them dormant.
 *
 * Pi Web has no in-app trust prompt yet, so this honors decisions already
 * persisted by the `pi` CLI (the trust store is shared) and otherwise defaults
 * to untrusted. Returns `undefined` when the project has no trust-requiring
 * resources, leaving ordinary projects on their existing load path.
 */
export function projectTrustReloadOptions(
  cwd: string,
  agentDir: string,
): { resolveProjectTrust: () => Promise<boolean> } | undefined {
  if (!cwd || !hasTrustRequiringProjectResources(cwd)) return undefined;
  const trustStore = new ProjectTrustStore(agentDir);
  return { resolveProjectTrust: async () => trustStore.get(cwd) === true };
}

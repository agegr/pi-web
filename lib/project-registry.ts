import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { writePrivateFileAtomicSync } from "./atomic-file";
import { normalizeProjectPreferences, type ProjectPreference } from "./project-registry-core";

export { normalizeProjectPreferences, type ProjectPreference } from "./project-registry-core";

interface ProjectRegistryFile {
  version: 1;
  projects: ProjectPreference[];
}

export function getProjectRegistryPath(): string {
  return join(getAgentDir(), "pi-web-projects.json");
}

export function readProjectPreferences(
  registryPath = getProjectRegistryPath(),
): ProjectPreference[] {
  if (!existsSync(registryPath)) return [];
  try {
    const parsed = JSON.parse(readFileSync(registryPath, "utf8")) as Partial<ProjectRegistryFile>;
    return parsed.version === 1 ? normalizeProjectPreferences(parsed.projects) : [];
  } catch {
    return [];
  }
}

export function writeProjectPreferences(
  projects: unknown,
  registryPath = getProjectRegistryPath(),
): ProjectPreference[] {
  const normalized = normalizeProjectPreferences(projects);
  const parent = dirname(registryPath);
  if (!existsSync(parent)) mkdirSync(parent, { recursive: true, mode: 0o700 });
  writePrivateFileAtomicSync(
    registryPath,
    JSON.stringify({ version: 1, projects: normalized } satisfies ProjectRegistryFile, null, 2),
  );
  return normalized;
}

import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import lockfile from "proper-lockfile";
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

async function withProjectRegistryLock<T>(
  registryPath: string,
  operation: () => T,
): Promise<T> {
  const parent = dirname(registryPath);
  if (!existsSync(parent)) mkdirSync(parent, { recursive: true, mode: 0o700 });
  if (!existsSync(registryPath)) writeProjectPreferences([], registryPath);

  const release = await lockfile.lock(registryPath, {
    retries: { retries: 10, factor: 2, minTimeout: 100, maxTimeout: 10_000, randomize: true },
    stale: 30_000,
  });
  try {
    return operation();
  } finally {
    await release();
  }
}

export function replaceProjectPreferences(
  projects: unknown,
  registryPath = getProjectRegistryPath(),
): Promise<ProjectPreference[]> {
  return withProjectRegistryLock(registryPath, () => writeProjectPreferences(projects, registryPath));
}

export function updateProjectPreference(
  path: string,
  update: Partial<Omit<ProjectPreference, "path">>,
  registryPath = getProjectRegistryPath(),
): Promise<ProjectPreference[]> {
  return withProjectRegistryLock(registryPath, () => {
    const projects = readProjectPreferences(registryPath);
    const index = projects.findIndex((project) => project.path === path);
    if (index < 0) throw new Error("Project not found");
    const next = projects.map((project, projectIndex) => projectIndex === index
      ? { ...project, ...update, path: project.path }
      : project);
    return writeProjectPreferences(next, registryPath);
  });
}

export function addProjectPreference(
  project: ProjectPreference,
  registryPath = getProjectRegistryPath(),
): Promise<ProjectPreference[]> {
  return withProjectRegistryLock(registryPath, () => {
    const projects = readProjectPreferences(registryPath);
    const existing = projects.findIndex((candidate) => candidate.path === project.path);
    const next = existing < 0
      ? [...projects, project]
      : projects.map((candidate, index) => index === existing ? { ...candidate, ...project } : candidate);
    return writeProjectPreferences(next, registryPath);
  });
}

export function reorderProjectPreferences(
  paths: string[],
  registryPath = getProjectRegistryPath(),
): Promise<ProjectPreference[]> {
  return withProjectRegistryLock(registryPath, () => {
    const projects = readProjectPreferences(registryPath);
    const orderByPath = new Map(paths.map((path, order) => [path, order]));
    const next = projects.map((project) => orderByPath.has(project.path)
      ? { ...project, order: orderByPath.get(project.path)! }
      : project);
    return writeProjectPreferences(next, registryPath);
  });
}

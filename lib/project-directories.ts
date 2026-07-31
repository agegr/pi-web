import { existsSync, mkdirSync, readFileSync, statSync } from "fs";
import { dirname, resolve } from "path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { writePrivateFileAtomicSync } from "./atomic-file";

interface ProjectDirectoriesFile {
  projects: string[];
}

export function getProjectDirectoriesPath(): string {
  return resolve(getAgentDir(), "pi-web-projects.json");
}

export function readProjectDirectories(path = getProjectDirectoriesPath()): string[] {
  if (!existsSync(path)) return [];
  try {
    const data = JSON.parse(readFileSync(path, "utf8")) as Partial<ProjectDirectoriesFile>;
    if (!Array.isArray(data.projects)) return [];
    return [...new Set(data.projects.filter((project): project is string => typeof project === "string" && project.length > 0))];
  } catch (error) {
    console.error("读取 Pi Web 项目目录配置失败", error);
    return [];
  }
}

export function normalizeProjectDirectory(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) throw new Error("cwd required");
  const cwd = resolve(value.trim());
  if (!statSync(cwd).isDirectory()) throw new Error("cwd must be a directory");
  return cwd;
}

function writeProjectDirectories(projects: string[], path = getProjectDirectoriesPath()): void {
  mkdirSync(dirname(path), { recursive: true });
  writePrivateFileAtomicSync(path, `${JSON.stringify({ projects }, null, 2)}\n`);
}

export function addProjectDirectory(cwd: string, path = getProjectDirectoriesPath()): string[] {
  const projects = readProjectDirectories(path);
  const next = [cwd, ...projects.filter((project) => project !== cwd)];
  writeProjectDirectories(next, path);
  return next;
}

export function removeProjectDirectory(cwd: string, path = getProjectDirectoriesPath()): string[] {
  const next = readProjectDirectories(path).filter((project) => project !== cwd);
  writeProjectDirectories(next, path);
  return next;
}

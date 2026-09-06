import { execFile } from "child_process";
import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { promisify } from "util";
import type {
  SkillInstallInfo,
  SkillUpdateResult,
} from "@/lib/api-types";

const CHECK_TIMEOUT_MS = 15_000;
const GIT_CHECK_TIMEOUT_MS = 30_000;
const DEFAULT_SKILLS_API_BASE = process.env.SKILLS_API_URL || "https://skills.sh";
const execFileAsync = promisify(execFile);

type Fetcher = (input: string, init?: RequestInit) => Promise<Response>;
type GitTreeResolver = (install: SkillInstallInfo) => Promise<string>;

interface CheckOptions {
  fetcher?: Fetcher;
  skillsApiBase?: string;
  githubToken?: string;
  resolveGitTreeHash?: GitTreeResolver;
}

interface GitHubTreeEntry {
  path?: unknown;
  type?: unknown;
  sha?: unknown;
}

interface GitHubTreeResponse {
  sha?: unknown;
  tree?: unknown;
}

interface SnapshotResponse {
  hash?: unknown;
}

class HttpError extends Error {
  constructor(readonly status: number) {
    super(`HTTP ${status}`);
  }
}

export function skillUpdateKey(install: Pick<SkillInstallInfo, "scope" | "package">): string {
  return `${install.scope}\0${install.package}`;
}

export function buildSkillUpdateArgs(install: SkillInstallInfo): string[] {
  const folder = skillFolder(install.skillPath ?? "");
  const source = folder ? `${install.source}/${folder}` : install.source;
  const ref = install.ref ? `#${encodeURIComponent(install.ref)}` : "";
  const args = [
    "skills",
    "add",
    `${source}${ref}`,
    "--skill",
    skillNameFromPackage(install.package),
    "-y",
    "--agent",
    "pi",
  ];
  if (install.scope === "global") args.push("-g");
  return args;
}

function skillSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[\s_]+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function skillNameFromPackage(pkg: string): string {
  const at = pkg.lastIndexOf("@");
  return at >= 0 ? pkg.slice(at + 1) : pkg;
}

function skillFolder(skillPath: string): string {
  let folder = skillPath.replace(/\\/g, "/");
  if (folder.toLowerCase().endsWith("/skill.md")) folder = folder.slice(0, -9);
  else if (folder.toLowerCase().endsWith("skill.md")) folder = folder.slice(0, -8);
  return folder.replace(/\/$/, "");
}

function result(
  install: SkillInstallInfo,
  state: SkillUpdateResult["state"],
  latestVersion?: string,
  message?: string,
): SkillUpdateResult {
  return {
    package: install.package,
    scope: install.scope,
    state,
    currentVersion: install.versionHash,
    latestVersion,
    message,
  };
}

async function fetchJson(
  url: string,
  fetcher: Fetcher,
  headers?: HeadersInit,
): Promise<unknown> {
  const response = await fetcher(url, {
    cache: "no-store",
    headers,
    signal: AbortSignal.timeout(CHECK_TIMEOUT_MS),
  });
  if (!response.ok) throw new HttpError(response.status);
  return response.json();
}

async function resolveGitTreeHash(install: SkillInstallInfo): Promise<string> {
  const repository = `https://github.com/${install.source}.git`;
  const ref = install.ref || "HEAD";
  const folder = skillFolder(install.skillPath!);
  const gitDir = await mkdtemp(join(tmpdir(), "pi-web-skill-check-"));

  try {
    await execFileAsync("git", ["init", "--bare", gitDir], {
      timeout: GIT_CHECK_TIMEOUT_MS,
    });
    await execFileAsync("git", [
      `--git-dir=${gitDir}`,
      "fetch",
      "--depth=1",
      "--filter=blob:none",
      "--no-tags",
      repository,
      ref,
    ], { timeout: GIT_CHECK_TIMEOUT_MS });
    const revision = folder ? `FETCH_HEAD:${folder}` : "FETCH_HEAD^{tree}";
    const { stdout } = await execFileAsync(
      "git",
      [`--git-dir=${gitDir}`, "rev-parse", revision],
      { timeout: GIT_CHECK_TIMEOUT_MS },
    );
    const hash = stdout.trim();
    if (!/^[0-9a-f]{40}$/i.test(hash)) throw new Error("Invalid Git tree hash");
    return hash;
  } finally {
    await rm(gitDir, { recursive: true, force: true });
  }
}

async function checkGlobalSkill(
  install: SkillInstallInfo,
  options: Required<Pick<CheckOptions, "fetcher" | "resolveGitTreeHash">> & CheckOptions,
): Promise<SkillUpdateResult> {
  const ref = install.ref || "HEAD";
  const url = `https://api.github.com/repos/${install.source}/git/trees/${encodeURIComponent(ref)}?recursive=1`;
  const headers: Record<string, string> = {
    Accept: "application/vnd.github.v3+json",
    "User-Agent": "pi-web",
  };
  if (options.githubToken) headers.Authorization = `Bearer ${options.githubToken}`;
  const folder = skillFolder(install.skillPath!);
  let latestVersion: string | undefined;

  try {
    const raw = (await fetchJson(url, options.fetcher, headers)) as GitHubTreeResponse;
    latestVersion = typeof raw.sha === "string" && !folder ? raw.sha : undefined;

    if (folder && Array.isArray(raw.tree)) {
      const entry = (raw.tree as GitHubTreeEntry[]).find(
        (item) => item.type === "tree" && item.path === folder,
      );
      if (entry && typeof entry.sha === "string") latestVersion = entry.sha;
    }
  } catch (error) {
    if (!(error instanceof HttpError) || ![401, 403, 429].includes(error.status)) {
      throw error;
    }
    latestVersion = await options.resolveGitTreeHash(install);
  }

  if (!latestVersion) {
    return result(install, "error", undefined, "Remote skill path was not found.");
  }
  return result(
    install,
    latestVersion === install.versionHash ? "up-to-date" : "update-available",
    latestVersion,
  );
}

async function checkProjectSkill(
  install: SkillInstallInfo,
  options: Required<Pick<CheckOptions, "fetcher" | "skillsApiBase">> & CheckOptions,
): Promise<SkillUpdateResult> {
  const [owner, repo] = install.source.split("/");
  const name = skillSlug(skillNameFromPackage(install.package));
  const url = `${options.skillsApiBase}/api/download/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/${encodeURIComponent(name)}`;
  const raw = (await fetchJson(url, options.fetcher)) as SnapshotResponse;
  const latestVersion = typeof raw.hash === "string" ? raw.hash : undefined;
  if (!latestVersion) {
    return result(install, "error", undefined, "skills.sh did not return a version hash.");
  }
  return result(
    install,
    latestVersion === install.versionHash ? "up-to-date" : "update-available",
    latestVersion,
  );
}

export async function checkSkillUpdate(
  install: SkillInstallInfo,
  options: CheckOptions = {},
): Promise<SkillUpdateResult> {
  if (!install.canCheckForUpdates || !install.versionHash || !install.skillPath) {
    return result(install, "unsupported", undefined, "This lock entry cannot be checked automatically.");
  }

  const resolvedOptions = {
    ...options,
    fetcher: options.fetcher ?? fetch,
    skillsApiBase: options.skillsApiBase ?? DEFAULT_SKILLS_API_BASE,
    resolveGitTreeHash: options.resolveGitTreeHash ?? resolveGitTreeHash,
  };

  try {
    return install.scope === "global"
      ? await checkGlobalSkill(install, resolvedOptions)
      : await checkProjectSkill(install, resolvedOptions);
  } catch (error) {
    return result(
      install,
      "error",
      undefined,
      error instanceof Error ? error.message : String(error),
    );
  }
}

export async function checkSkillUpdates(
  installs: SkillInstallInfo[],
  options: CheckOptions = {},
): Promise<SkillUpdateResult[]> {
  const fetcher = options.fetcher ?? fetch;
  const requests = new Map<string, Promise<Response>>();
  const cachedFetcher: Fetcher = async (input, init) => {
    let request = requests.get(input);
    if (!request) {
      request = fetcher(input, init);
      requests.set(input, request);
    }
    return (await request).clone();
  };

  return Promise.all(
    installs.map((install) => checkSkillUpdate(install, {
      ...options,
      fetcher: cachedFetcher,
    })),
  );
}

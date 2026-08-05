import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { getSafeNpxEnv, redactNpxOutput } from "@/lib/npx";
import type {
  OmpWebInstallPlan,
  OmpWebPackageInfo,
  OmpWebReleaseInfo,
  OmpWebUpdateResponse,
} from "@/lib/api-types";

export const OMP_WEB_GITHUB_RELEASE_API_URL = "https://api.github.com/repos/ddallabenetta/omp-web/releases/latest";
export const OMP_WEB_NPM_LATEST_URL = "https://registry.npmjs.org/omp-web/latest";

const RELEASE_CACHE_SECONDS = 60 * 60;
const REQUEST_TIMEOUT_MS = 12_000;
const UPDATE_TIMEOUT_MS = 120_000;
const MAX_CHANGELOG_LENGTH = 40_000;
const execFileAsync = promisify(execFile);

type Fetcher = (input: string, init?: RequestInit) => Promise<Response>;
type UpdateManager = OmpWebInstallPlan["manager"];

interface ParsedVersion {
  major: number;
  minor: number;
  patch: number;
  prerelease: string[] | null;
}

interface GitHubReleasePayload {
  tag_name?: unknown;
  name?: unknown;
  body?: unknown;
  html_url?: unknown;
  published_at?: unknown;
}

interface NpmPackagePayload {
  version?: unknown;
}

interface UpdateStatusOptions {
  currentAppVersion?: string;
  fetcher?: Fetcher;
  env?: NodeJS.ProcessEnv;
  runtime?: "bun" | "node";
}

interface InstallOptions {
  manager: UpdateManager;
}

export interface OmpWebUpdateInstallResult {
  output: string;
}

function parseVersion(value: unknown): ParsedVersion | null {
  const normalized = String(value ?? "").trim().replace(/^[^0-9]*/, "");
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?/.exec(normalized);
  if (!match) return null;

  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] ? match[4].split(".") : null,
  };
}

function canonicalVersion(value: unknown): string | null {
  const parsed = parseVersion(value);
  if (!parsed) return null;
  const core = `${parsed.major}.${parsed.minor}.${parsed.patch}`;
  return parsed.prerelease ? `${core}-${parsed.prerelease.join(".")}` : core;
}

/** Compare SemVer-like values without throwing on malformed upstream data. */
export function compareVersions(left: unknown, right: unknown): number {
  const a = parseVersion(left);
  const b = parseVersion(right);
  if (!a || !b) return 0;

  for (const key of ["major", "minor", "patch"] as const) {
    if (a[key] !== b[key]) return a[key] > b[key] ? 1 : -1;
  }

  if (!a.prerelease && !b.prerelease) return 0;
  if (!a.prerelease) return 1;
  if (!b.prerelease) return -1;

  const length = Math.max(a.prerelease.length, b.prerelease.length);
  for (let index = 0; index < length; index += 1) {
    const leftPart = a.prerelease[index];
    const rightPart = b.prerelease[index];
    if (leftPart === undefined) return -1;
    if (rightPart === undefined) return 1;
    if (leftPart === rightPart) continue;

    const leftNumeric = /^\d+$/.test(leftPart);
    const rightNumeric = /^\d+$/.test(rightPart);
    if (leftNumeric && rightNumeric) {
      const leftNumber = Number(leftPart);
      const rightNumber = Number(rightPart);
      if (leftNumber !== rightNumber) return leftNumber > rightNumber ? 1 : -1;
      continue;
    }
    if (leftNumeric !== rightNumeric) return leftNumeric ? -1 : 1;
    return leftPart > rightPart ? 1 : -1;
  }
  return 0;
}

function isNewerVersion(latest: string | null, current: string | null): boolean {
  return Boolean(latest && current && compareVersions(latest, current) > 0);
}

function releaseFromPayload(payload: GitHubReleasePayload): OmpWebReleaseInfo {
  const version = canonicalVersion(payload.tag_name);
  if (!version) throw new Error("The omp-web release did not contain a valid version tag");

  const tagName = typeof payload.tag_name === "string" && payload.tag_name.trim()
    ? payload.tag_name.trim()
    : `v${version}`;
  const htmlUrl = typeof payload.html_url === "string" && payload.html_url.startsWith("https://github.com/ddallabenetta/omp-web/")
    ? payload.html_url
    : `https://github.com/ddallabenetta/omp-web/releases/tag/${encodeURIComponent(tagName)}`;
  const body = typeof payload.body === "string" ? payload.body.slice(0, MAX_CHANGELOG_LENGTH) : "";

  return {
    version,
    tagName,
    name: typeof payload.name === "string" && payload.name.trim() ? payload.name.trim() : tagName,
    body,
    htmlUrl,
    publishedAt: typeof payload.published_at === "string" ? payload.published_at : null,
  };
}

function releaseFromPackage(version: string): OmpWebReleaseInfo {
  const tagName = `v${version}`;
  return {
    version,
    tagName,
    name: tagName,
    body: "",
    htmlUrl: `https://github.com/ddallabenetta/omp-web/releases/tag/${encodeURIComponent(tagName)}`,
    publishedAt: null,
  };
}

function publishedPackageFromPayload(payload: NpmPackagePayload): OmpWebPackageInfo | null {
  const version = canonicalVersion(payload.version);
  return version ? { version } : null;
}

async function fetchJson(url: string, fetcher: Fetcher): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetcher(url, {
      headers: {
        Accept: "application/json",
        "User-Agent": "omp-web-update-check",
      },
      signal: controller.signal,
      // Next.js caches this server-side request so every browser tab does not
      // consume a GitHub API request. The injected fetcher in tests ignores it.
      next: { revalidate: RELEASE_CACHE_SECONDS },
    } as RequestInit & { next: { revalidate: number } });
    if (!response.ok) throw new Error(`Update source returned HTTP ${response.status}`);
    return await response.json() as unknown;
  } finally {
    clearTimeout(timeout);
  }
}

function selectManager(env: NodeJS.ProcessEnv, runtime: "bun" | "node"): UpdateManager {
  if (env.OMP_WEB_UPDATE_MANAGER === "npm") return "npm";
  if (env.OMP_WEB_UPDATE_MANAGER === "bun") return "bun";
  if (env.npm_config_user_agent?.toLowerCase().includes("npm")) return "npm";
  return runtime === "node" ? "npm" : "bun";
}

function commandForManager(manager: UpdateManager): { executable: string; args: string[]; command: string } {
  if (manager === "npm") {
    const executable = process.platform === "win32" ? "npm.cmd" : "npm";
    const args = ["install", "--global", "omp-web@latest", "--no-audit", "--no-fund"];
    return { executable, args, command: "npm install --global omp-web@latest" };
  }
  const executable = process.platform === "win32" ? "bun.exe" : "bun";
  const args = ["add", "--global", "omp-web@latest"];
  return { executable, args, command: "bun add --global omp-web@latest" };
}

export function buildInstallPlan({
  currentAppVersion,
  latestPackage,
  env = process.env,
  runtime = "bun",
}: {
  currentAppVersion: string | null;
  latestPackage: OmpWebPackageInfo | null;
  env?: NodeJS.ProcessEnv;
  runtime?: "bun" | "node";
}): OmpWebInstallPlan {
  const manager = selectManager(env, runtime);
  const command = commandForManager(manager);
  const alternate = commandForManager(manager === "bun" ? "npm" : "bun");
  const updateAvailable = Boolean(
    latestPackage
    && isNewerVersion(latestPackage.version, currentAppVersion),
  );
  const canInstall = updateAvailable && env.OMP_WEB_DISABLE_SELF_UPDATE !== "1";

  let reason: OmpWebInstallPlan["reason"];
  if (env.OMP_WEB_DISABLE_SELF_UPDATE === "1") reason = "disabled";
  else if (!latestPackage) reason = "latest-package-unavailable";
  else if (!currentAppVersion) reason = "current-version-unknown";

  return {
    canInstall,
    manager,
    command: command.command,
    alternateCommand: alternate.command,
    packageVersion: latestPackage?.version,
    reason,
    restartRequired: true,
  };
}

export async function getOmpWebUpdateStatus(options: UpdateStatusOptions = {}): Promise<OmpWebUpdateResponse> {
  const fetcher = options.fetcher ?? fetch;
  const currentAppVersion = canonicalVersion(options.currentAppVersion ?? process.env.NEXT_PUBLIC_APP_VERSION) ?? "unknown";

  const packagePayload = await fetchJson(OMP_WEB_NPM_LATEST_URL, fetcher) as NpmPackagePayload;
  const latestPackage = publishedPackageFromPayload(packagePayload);
  if (!latestPackage) throw new Error("The npm registry did not return a valid omp-web version");

  let latestRelease = releaseFromPackage(latestPackage.version);
  try {
    const releasePayload = await fetchJson(OMP_WEB_GITHUB_RELEASE_API_URL, fetcher) as GitHubReleasePayload;
    const candidate = releaseFromPayload(releasePayload);
    if (compareVersions(candidate.version, latestPackage.version) === 0) latestRelease = candidate;
  } catch {
    // npm is the source of truth for installability; GitHub only enriches it with
    // release notes and a release link.
  }

  const install = buildInstallPlan({
    currentAppVersion,
    latestPackage,
    env: options.env,
    runtime: options.runtime,
  });
  const updateAvailable = isNewerVersion(latestPackage.version, currentAppVersion);
  const availability: OmpWebUpdateResponse["availability"] = !updateAvailable
    ? "up-to-date"
    : install.canInstall
      ? "installable"
      : "manual";

  return {
    currentAppVersion,
    latestRelease,
    latestPackage,
    updateAvailable,
    availability,
    install,
    checkedAt: new Date().toISOString(),
  };
}

export async function installOmpWebUpdate({ manager }: InstallOptions): Promise<OmpWebUpdateInstallResult> {
  const command = commandForManager(manager);
  const result = await execFileAsync(command.executable, command.args, {
    timeout: UPDATE_TIMEOUT_MS,
    maxBuffer: 1_000_000,
    env: getSafeNpxEnv({
      CI: "1",
      NPM_CONFIG_UPDATE_NOTIFIER: "false",
      npm_config_yes: "true",
    }),
  });
  return { output: redactNpxOutput(`${result.stdout ?? ""}${result.stderr ?? ""}`).slice(-2000) };
}
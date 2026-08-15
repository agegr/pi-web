import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { assertSafeDiscoveryTarget } from "./model-discovery";
import type { VisionToolkitSnapshot } from "./vision-toolkit-config";
import { readStoredVisionApiKey } from "./vision-toolkit-config";

export type HealthStatus = "ok" | "warning" | "error" | "not_tested";
export type HealthCheck = { status: HealthStatus; detail: string };
export type HealthResult = {
  pluginVersion?: string;
  checks: Record<string, HealthCheck>;
  healthy: boolean;
  connectionTested: boolean;
};

export type VisionHealthCommandResult = { ok: boolean; stdout: string; stderr: string };

export type VisionHealthOptions = {
  testConnection: boolean;
  snapshot: VisionToolkitSnapshot;
  fetchImpl?: typeof fetch;
  lookPath?: (command: string) => string | undefined;
  runCommand?: (command: string, args: string[]) => VisionHealthCommandResult;
  fileExists?: (path: string) => boolean;
  readStoredApiKey?: () => string | undefined;
};

const CONNECTION_TIMEOUT_MS = 20_000;
const VISION_CLIS = ["glance", "ground", "detect", "trace", "crop"] as const;
const PYTHON_COMMANDS = ["python3", "python"];
const CHROME_COMMANDS = [
  "google-chrome",
  "google-chrome-stable",
  "chromium",
  "chromium-browser",
  "microsoft-edge",
  "msedge",
];
const CHROME_FILES = process.platform === "darwin"
  ? [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
  ]
  : process.platform === "win32"
    ? [
      "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
      "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    ]
    : [
      "/usr/bin/google-chrome",
      "/usr/bin/chromium",
      "/usr/bin/chromium-browser",
      "/usr/bin/microsoft-edge",
    ];

function defaultLookPath(command: string): string | undefined {
  try {
    const output = execFileSync(process.platform === "win32" ? "where" : "which", [command], {
      encoding: "utf8",
      timeout: 3_000,
      stdio: ["ignore", "pipe", "ignore"],
    });
    return output.trim().split(/\r?\n/)[0] || undefined;
  } catch {
    return undefined;
  }
}

function defaultRunCommand(command: string, args: string[]): VisionHealthCommandResult {
  try {
    const stdout = execFileSync(command, args, {
      encoding: "utf8",
      timeout: 8_000,
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { ok: true, stdout: String(stdout), stderr: "" };
  } catch (error) {
    const err = error as { stdout?: string; stderr?: string; message?: string };
    return {
      ok: false,
      stdout: String(err.stdout ?? ""),
      stderr: String(err.stderr ?? err.message ?? error),
    };
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseVisionHealthRequest(
  body: unknown,
): { ok: true; testConnection: boolean } | { ok: false; error: string } {
  if (!isRecord(body) || typeof body.testConnection !== "boolean") {
    return { ok: false, error: "Body must be { testConnection: boolean }" };
  }
  return { ok: true, testConnection: body.testConnection };
}

function redact(text: string, secret?: string): string {
  let out = text.replace(/\r/g, " ").replace(/\n/g, " ");
  if (secret) out = out.split(secret).join("<redacted>");
  return out;
}

function checkPython(
  lookPath: (command: string) => string | undefined,
  runCommand: (command: string, args: string[]) => VisionHealthCommandResult,
): HealthCheck & { path?: string } {
  for (const command of PYTHON_COMMANDS) {
    const path = lookPath(command);
    if (!path) continue;
    const result = runCommand(path, ["--version"]);
    const version = (result.stdout || result.stderr).trim().split(/\r?\n/)[0] || "Python";
    if (result.ok) return { status: "ok", detail: `${version} via ${path}`, path };
  }
  return { status: "error", detail: "Python was not found." };
}

function checkChrome(
  lookPath: (command: string) => string | undefined,
  fileExists: (path: string) => boolean,
): HealthCheck {
  for (const command of CHROME_COMMANDS) {
    const path = lookPath(command);
    if (path) return { status: "ok", detail: `Browser available via ${path}` };
  }
  for (const path of CHROME_FILES) {
    if (fileExists(path)) return { status: "ok", detail: `Browser available via ${path}` };
  }
  return {
    status: "warning",
    detail: "Chrome, Chromium, or Edge was not found; HTML Screenshot is unavailable.",
  };
}

function checkDependencies(
  snapshot: VisionToolkitSnapshot,
  pythonPath: string | undefined,
  lookPath: (command: string) => string | undefined,
  runCommand: (command: string, args: string[]) => VisionHealthCommandResult,
  fileExists: (path: string) => boolean,
): HealthCheck {
  if (!pythonPath) {
    return { status: "error", detail: "Dependencies were not checked because Python is missing." };
  }

  const missing = VISION_CLIS.filter((name) => !lookPath(name));
  const skillDir = dirname(snapshot.install.skill.path);
  const scriptsExist = snapshot.install.skill.present
    || fileExists(join(skillDir, "scripts"))
    || fileExists(join(skillDir, "html_shot.py"));
  let pillowOk = true;
  if (scriptsExist) {
    pillowOk = runCommand(pythonPath, ["-c", "import PIL"]).ok;
  }

  if (missing.length === 0 && pillowOk) {
    return { status: "ok", detail: "Vision CLIs and Python image dependencies are available." };
  }

  const parts = [];
  if (missing.length > 0) parts.push(`missing CLIs: ${missing.join(", ")}`);
  if (!pillowOk) parts.push("Pillow is not importable");
  return { status: "warning", detail: parts.join("; ") };
}

function modelsEndpoint(baseUrl: string): string | undefined {
  const trimmed = baseUrl.trim();
  if (!trimmed) return undefined;
  try {
    const url = new URL(trimmed.endsWith("/") ? trimmed : `${trimmed}/`);
    if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
    return `${trimmed.replace(/\/+$/, "")}/models`;
  } catch {
    return undefined;
  }
}

function classifyHttp(status: number, endpoint: string): HealthCheck {
  if (status === 200) {
    return { status: "ok", detail: `Service responded at ${endpoint} (HTTP ${status}).` };
  }
  if (status === 401 || status === 403) {
    return { status: "error", detail: `Service rejected the configured credential (HTTP ${status}).` };
  }
  if (status === 404) {
    return { status: "warning", detail: `Service is reachable but does not expose GET /models (HTTP ${status}).` };
  }
  if (status === 429) {
    return { status: "warning", detail: "Service is reachable but rate-limited the connection test (HTTP 429)." };
  }
  return { status: "error", detail: `Service connection test failed with HTTP ${status}.` };
}

async function checkService(
  snapshot: VisionToolkitSnapshot,
  secret: string | undefined,
  fetchImpl: typeof fetch,
): Promise<{ check: HealthCheck; tested: boolean }> {
  if (!secret) {
    return {
      check: {
        status: "error",
        detail: "Connection test skipped because the configured credential is unavailable.",
      },
      tested: false,
    };
  }
  const endpoint = modelsEndpoint(snapshot.settings.baseUrl);
  if (!endpoint) {
    return {
      check: { status: "error", detail: "Connection test skipped because the API address is missing or invalid." },
      tested: false,
    };
  }

  try {
    assertSafeDiscoveryTarget(new URL(endpoint), { apiKey: secret });
  } catch (error) {
    return {
      check: {
        status: "error",
        detail: error instanceof Error ? error.message : String(error),
      },
      tested: false,
    };
  }

  try {
    const response = await fetchImpl(endpoint, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${secret}`,
        Accept: "application/json",
        "User-Agent": "pi-web-vision-toolkit",
      },
      signal: AbortSignal.timeout(CONNECTION_TIMEOUT_MS),
    });
    return { check: classifyHttp(response.status, endpoint), tested: true };
  } catch (error) {
    const timedOut = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
    if (timedOut) {
      return {
        check: { status: "error", detail: `Service connection test timed out at ${endpoint}.` },
        tested: true,
      };
    }
    const message = redact(error instanceof Error ? error.message : String(error), secret);
    return {
      check: {
        status: "error",
        detail: redact(`Service could not be reached at ${endpoint}. ${message}`.trim(), secret),
      },
      tested: true,
    };
  }
}

export async function runVisionToolkitHealth(opts: VisionHealthOptions): Promise<HealthResult> {
  const lookPath = opts.lookPath ?? defaultLookPath;
  const runCommand = opts.runCommand ?? defaultRunCommand;
  const fileExists = opts.fileExists ?? existsSync;
  const readStoredApiKey = opts.readStoredApiKey ?? readStoredVisionApiKey;
  const fetchImpl = opts.fetchImpl ?? fetch;
  const snapshot = opts.snapshot;

  const python = checkPython(lookPath, runCommand);
  const checks: Record<string, HealthCheck> = {
    python: { status: python.status, detail: python.detail },
    dependencies: checkDependencies(snapshot, python.path, lookPath, runCommand, fileExists),
    chrome: checkChrome(lookPath, fileExists),
    credential: snapshot.credential.configured
      ? { status: "ok", detail: "API key is configured." }
      : { status: "error", detail: "API key is not configured." },
    configFile: fileExists(snapshot.configPath)
      ? snapshot.writable
        ? { status: "ok", detail: `Config file is writable: ${snapshot.configPath}` }
        : { status: "error", detail: `Config file is not writable: ${snapshot.configPath}` }
      : { status: "warning", detail: `Config file does not exist yet: ${snapshot.configPath}` },
    extension: snapshot.install.extension.present
      ? { status: "ok", detail: snapshot.install.extension.path }
      : { status: "warning", detail: `Extension not found: ${snapshot.install.extension.path}` },
    skill: snapshot.install.skill.present
      ? { status: "ok", detail: snapshot.install.skill.path }
      : { status: "warning", detail: `Skill not found: ${snapshot.install.skill.path}` },
  };

  let connectionTested = false;
  if (opts.testConnection) {
    const service = await checkService(snapshot, readStoredApiKey(), fetchImpl);
    checks.service = service.check;
    connectionTested = service.tested;
  }

  for (const check of Object.values(checks)) {
    check.detail = redact(check.detail, readStoredApiKey());
  }

  return {
    checks,
    healthy: Object.values(checks).every((check) => check.status !== "error"),
    connectionTested,
  };
}

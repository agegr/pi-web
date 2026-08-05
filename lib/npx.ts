import { execFile } from "child_process";
import { promisify } from "util";
import { existsSync } from "fs";
import { dirname, join } from "path";
import { execPath } from "process";

const execFileAsync = promisify(execFile);

/**
 * Locate `npx-cli.js` shipped with the running Node.js installation.
 *
 * On Windows the `npx` on PATH is actually `npx.cmd`, which Node.js (since
 * 20.12 due to CVE-2024-27980) refuses to spawn from `execFile`/`spawn`
 * without `shell: true`. Going through a shell reintroduces quoting bugs for
 * user-supplied args. Instead we find the real `npx-cli.js` and invoke it
 * directly via the current `node` binary, which works identically on every
 * platform and needs no shell.
 */
function findNpxCli(): string | null {
  const nodeDir = dirname(execPath);
  const candidates = [
    // Windows MSI installer layout: node.exe and node_modules share a dir
    join(nodeDir, "node_modules", "npm", "bin", "npx-cli.js"),
    // Unix layout: .../bin/node + .../lib/node_modules/npm/bin/npx-cli.js
    join(nodeDir, "..", "lib", "node_modules", "npm", "bin", "npx-cli.js"),
  ];
  for (const p of candidates) {
    try {
      if (existsSync(p)) return p;
    } catch {
      // ignore
    }
  }
  return null;
}

export interface RunNpxOptions {
  timeout?: number;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
}

export interface RunNpxResult {
  stdout: string;
  stderr: string;
}
const SENSITIVE_ENV_NAME_RE = /(?:^|_)(?:API_KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL|PRIVATE_KEY|AUTH)(?:$|_)/i;
const SENSITIVE_ENV_FRAGMENT_RE = /(?:auth(?:token)?|userconfig|globalconfig)/i;

function isSensitiveEnvName(name: string): boolean {
  return SENSITIVE_ENV_NAME_RE.test(name) || SENSITIVE_ENV_FRAGMENT_RE.test(name);
}

/**
 * Keep the environment needed by npm/skills while withholding credentials from
 * package code executed by npx. Explicit overrides are still allowed for
 * non-secret process controls such as FORCE_COLOR.
 */
export function getSafeNpxEnv(overrides: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  const safe = {} as NodeJS.ProcessEnv;
  for (const [name, value] of Object.entries(process.env)) {
    if (value !== undefined && !isSensitiveEnvName(name)) safe[name] = value;
  }
  for (const [name, value] of Object.entries(overrides)) {
    if (value !== undefined) safe[name] = value;
  }
  return safe;
}

/** Redact inherited credentials before subprocess output reaches the browser. */
export function redactNpxOutput(value: string, env: Record<string, string | undefined> = process.env): string {
  let redacted = value;
  const secrets = [...new Set(
    Object.entries(env)
      .filter(([name, secret]) => isSensitiveEnvName(name) && typeof secret === "string" && secret.length >= 4)
      .map(([, secret]) => secret as string),
  )].sort((a, b) => b.length - a.length);
  for (const secret of secrets) redacted = redacted.replaceAll(secret, "[REDACTED]");
  return redacted.replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi, "$1 [REDACTED]");
}

/**
 * Cross-platform wrapper for invoking `npx <args>` without ever using a
 * shell, so user-controlled arguments are never interpreted as shell syntax.
 */
export async function runNpx(args: string[], opts: RunNpxOptions = {}): Promise<RunNpxResult> {
  const npxCli = findNpxCli();
  const { command, commandArgs } = npxCli
    ? { command: execPath, commandArgs: [npxCli, ...args] }
    : { command: "npx", commandArgs: args };
  return execFileAsync(command, commandArgs, {
    timeout: opts.timeout,
    cwd: opts.cwd,
    env: opts.env,
  });
}

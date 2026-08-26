import { execFile } from "child_process";
import { existsSync } from "fs";
import { dirname, join } from "path";
import { promisify } from "util";
import { fileURLToPath } from "url";

const execFileAsync = promisify(execFile);

type PiCodingAgentModule = {
  getPackageDir: () => string;
};

export async function getPiPackageDir(): Promise<string | null> {
  try {
    const { getPackageDir } = (await import("@earendil-works/pi-coding-agent")) as PiCodingAgentModule;
    return getPackageDir();
  } catch {
    return null;
  }
}

export async function getPiCliPath(): Promise<string | null> {
  const candidates = new Set<string>();
  const packageDir = await getPiPackageDir();

  if (packageDir) {
    candidates.add(join(packageDir, "dist", "cli.js"));
  }

  try {
    const resolver = (import.meta as ImportMeta & {
      resolve?: (specifier: string) => string | Promise<string>;
    }).resolve;
    if (typeof resolver === "function") {
      const indexUrl = await resolver("@earendil-works/pi-coding-agent");
      candidates.add(join(dirname(fileURLToPath(indexUrl)), "cli.js"));
    }
  } catch {
    // Next.js production bundles can strip import.meta.resolve.
  }

  candidates.add(
    join(
      process.cwd(),
      "node_modules",
      "@earendil-works",
      "pi-coding-agent",
      "dist",
      "cli.js",
    ),
  );

  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

export interface RunPiCliOptions {
  cwd?: string;
  timeout?: number;
  env?: NodeJS.ProcessEnv;
}

export interface RunPiCliResult {
  stdout: string;
  stderr: string;
}

export async function runPiCli(
  args: string[],
  options: RunPiCliOptions = {},
): Promise<RunPiCliResult> {
  const cliPath = await getPiCliPath();
  const timeout = options.timeout ?? 10 * 60 * 1000;
  const env = options.env ?? process.env;
  const execOptions = {
    cwd: options.cwd,
    timeout,
    env,
    maxBuffer: 10 * 1024 * 1024,
  };

  if (cliPath) {
    return execFileAsync(process.execPath, [cliPath, ...args], execOptions);
  }

  return execFileAsync("pi", args, execOptions);
}

export async function runPiExtensionsUpdate(cwd: string): Promise<RunPiCliResult> {
  return runPiCli(["update", "--extensions"], { cwd });
}

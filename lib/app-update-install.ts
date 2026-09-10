import { spawn } from "node:child_process";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";

export type AppInstallState = {
  status: "idle" | "running" | "reloading" | "succeeded" | "failed";
  sourceDir?: string;
  updatedAt?: string;
  error?: string;
};

export function getAppInstallPaths(homeDir = homedir()) {
  const dir = join(homeDir, "Library", "Application Support", "Pi Web");
  return {
    dir,
    statePath: join(dir, "update-state.json"),
    lockPath: join(dir, "update.lock"),
    logPath: join(homeDir, "Library", "Logs", "Pi Web", "update.log"),
  };
}

export function readAppInstallState(homeDir = homedir()): AppInstallState {
  try {
    return JSON.parse(readFileSync(getAppInstallPaths(homeDir).statePath, "utf8")) as AppInstallState;
  } catch {
    return { status: "idle" };
  }
}

export function defaultUpdateSourceDir(cwd = process.cwd()): string {
  return existsSync(join(cwd, "package-lock.json")) ? cwd : "";
}

export function launchAppUpdate(sourceDir: string, options: {
  platform?: NodeJS.Platform;
  homeDir?: string;
  helperPath?: string;
  spawnProcess?: typeof spawn;
} = {}) {
  if ((options.platform ?? process.platform) !== "darwin") {
    throw new Error("App updates are currently supported only on macOS.");
  }
  if (!sourceDir.trim() || !isAbsolute(sourceDir)) {
    throw new Error("Choose an absolute Pi Web source directory.");
  }

  const resolvedDir = resolve(sourceDir);
  try {
    const pkg = JSON.parse(readFileSync(join(resolvedDir, "package.json"), "utf8")) as { name?: unknown };
    if (pkg.name !== "@agegr/pi-web" || !existsSync(join(resolvedDir, "package-lock.json"))) throw new Error();
  } catch {
    throw new Error("Choose a Pi Web source directory containing package.json and package-lock.json.");
  }

  const paths = getAppInstallPaths(options.homeDir);
  mkdirSync(paths.dir, { recursive: true, mode: 0o700 });
  mkdirSync(dirname(paths.logPath), { recursive: true, mode: 0o700 });
  if (existsSync(paths.lockPath)) throw new Error("A Pi Web update is already running.");

  const logFd = openSync(paths.logPath, "a", 0o600);
  try {
    const child = (options.spawnProcess ?? spawn)(process.execPath, [
      options.helperPath ?? join(process.cwd(), "bin", "detached-update.js"),
      resolvedDir,
      paths.statePath,
      paths.lockPath,
    ], {
      detached: true,
      stdio: ["ignore", logFd, logFd],
      env: process.env,
    });
    child.unref();
  } finally {
    closeSync(logFd);
  }

  return { sourceDir: resolvedDir, logPath: paths.logPath };
}

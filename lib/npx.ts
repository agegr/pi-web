import { execFile } from "child_process";
import { promisify } from "util";
import { nodeCliInvocation } from "./node-cli";
import { sanitizeProjectCommandEnvironment } from "./project-command-env";

const execFileAsync = promisify(execFile);

export interface RunNpxOptions {
  timeout?: number;
  cwd?: string;
}

export interface RunNpxResult {
  stdout: string;
  stderr: string;
}

/**
 * What an `npx` child inherits: the host's environment without what belongs to
 * this server (`PORT`, `NODE_ENV`, `NEXT_*` and the `PI_WEB_PASSWORD` login
 * secret, as for project commands in ADR 0001). The package it runs is
 * third-party code fetched from npm. Colors are off: the output is parsed.
 */
export function npxEnvironment(base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  return { ...sanitizeProjectCommandEnvironment(base), FORCE_COLOR: "0" };
}

/**
 * Cross-platform wrapper for invoking `npx <args>` without ever using a
 * shell, so user-controlled arguments are never interpreted as shell syntax.
 * See `lib/node-cli.ts` for why the bundled `npx-cli.js` is preferred over the
 * `npx` (or `npx.cmd`) on PATH.
 */
export async function runNpx(args: string[], opts: RunNpxOptions = {}): Promise<RunNpxResult> {
  const { command, args: commandArgs } = nodeCliInvocation("npx", args);
  return execFileAsync(command, commandArgs, {
    timeout: opts.timeout,
    cwd: opts.cwd,
    env: npxEnvironment(),
  });
}

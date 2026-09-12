import { execFile, spawn } from "child_process";
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
  onSpawn?: (pid: number) => void;
  terminateTreeOnTimeout?: boolean;
}

export interface RunNpxResult {
  stdout: string;
  stderr: string;
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
  if (opts.terminateTreeOnTimeout) return runManagedProcess(command, commandArgs, opts);
  const pending = execFileAsync(command, commandArgs, {
    timeout: opts.timeout,
    windowsHide: true,
    cwd: opts.cwd,
    env: opts.env,
  });
  if (pending.child.pid) opts.onSpawn?.(pending.child.pid);
  return pending;
}

/** A timeout settles after one additional termination budget, even if pipes stay open. */
export function runManagedProcess(command: string, args: string[], opts: RunNpxOptions): Promise<RunNpxResult> {
  const timeout = opts.timeout;
  if (!timeout || !Number.isFinite(timeout) || timeout < 0) return Promise.reject(new TypeError("Managed processes require a positive timeout"));
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: opts.cwd, env: opts.env, shell: false, windowsHide: true, detached: process.platform !== "win32", stdio: ["ignore", "pipe", "pipe"] });
    let stdout = ""; let stderr = ""; let terminating = false; let settled = false;
    let terminationTimer: ReturnType<typeof setTimeout> | undefined;
    let terminator: ReturnType<typeof execFile> | undefined;
    let terminationReason = "CLI timeout";
    // Bound retained process output independently of the child pipe; always drain it.
    const maxOutput = 1024 * 1024;
    child.stdout.on("data", data => { stdout = (stdout + data.toString()).slice(-maxOutput); });
    child.stderr.on("data", data => { stderr = (stderr + data.toString()).slice(-maxOutput); });

    function finish(error?: Error) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (terminationTimer) clearTimeout(terminationTimer);
      if (error) {
        // Unknown descendants may still run. Stop retaining their pipes without
        // representing this cleanup as successful process-tree termination.
        child.unref(); child.stdout.destroy(); child.stderr.destroy();
        reject(error);
      } else resolve({ stdout, stderr });
    }
    function finishTermination(treeTerminated: boolean) {
      finish(Object.assign(new Error(terminationReason), { stdout, stderr, killed: true, treeTerminated, processId: child.pid ?? null }));
    }
    function groupStopped() {
      if (!child.pid) return true;
      try { process.kill(-child.pid, 0); return false; }
      catch (error) { return (error as NodeJS.ErrnoException).code === "ESRCH"; }
    }
    function terminate(reason = "CLI timeout") {
      if (terminating || settled) return;
      terminating = true; terminationReason = reason;
      const pid = child.pid;
      if (!pid) { finishTermination(true); return; }
      terminationTimer = setTimeout(() => {
        // execFile's timeout can itself wait for inherited output pipes. This
        // independent deadline guarantees the managed call still settles.
        terminator?.kill("SIGKILL");
        finishTermination(process.platform !== "win32" && groupStopped());
      }, timeout);
      if (process.platform === "win32") {
        // A dead wrapper PID is not evidence that its descendants stopped.
        // Only successful /T termination confirms the tree on Windows.
        terminator = execFile("taskkill", ["/PID", String(pid), "/T", "/F"], { timeout, windowsHide: true, shell: false }, error => finishTermination(!error));
      } else {
        try { process.kill(-pid, "SIGKILL"); if (groupStopped()) finishTermination(true); }
        catch { finishTermination(groupStopped()); }
      }
    }
    const timer = setTimeout(terminate, timeout);
    child.on("spawn", () => { if (child.pid) try { opts.onSpawn?.(child.pid); } catch { terminate("CLI process registration failed"); } });
    child.on("error", error => { if (!terminating) finish(error); });
    child.on("close", code => {
      if (terminating) {
        if (process.platform !== "win32" && groupStopped()) finishTermination(true);
      } else if (code !== 0) finish(Object.assign(new Error(`CLI exited ${code}`), { stdout, stderr, killed: false }));
      else finish();
    });
  });
}

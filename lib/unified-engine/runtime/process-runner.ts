// process-runner.ts —— 受控子进程执行（M3 / Q4 / 等价迁移 autoplan runtime/process/runner.go:40-42,205）
//
// 纯 TS 等价：仅以 argv 数组经 child_process.spawn 启动（严禁 shell:true），
// 二进制经共享白名单解析（lib/allowed-commands），参数经注入校验。
// 提供两类能力：
//  - runCommand：一次性执行并返回 {code, stdout, stderr}（用于测试/构建验证）；
//  - spawnTracked：受控长驻进程，回报 pid（供进程树/PTY 集成），并转发输出到回调。
import { spawn, type ChildProcess } from "node:child_process";
import { resolveExecutable, assertSafeArgs } from "../../allowed-commands";

export interface RunCommandOptions {
  cwd?: string;
  /** 超时（毫秒）；超时则杀进程并以 code=-1 结束。默认 120000。 */
  timeoutMs?: number;
  /** 追加环境变量（合并 process.env）。 */
  env?: Record<string, string>;
  /** 输入经由 stdin 写入（可选）。 */
  stdin?: string;
}

export interface RunCommandResult {
  code: number | null;
  signal: string | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

export interface TrackedProcess {
  pid: number;
  proc: ChildProcess;
  kill: (signal?: NodeJS.Signals) => boolean;
}

/** 一次性执行受控命令（argv 数组，无 shell）。 */
export function runCommand(
  binary: string,
  args: readonly string[],
  opts: RunCommandOptions = {},
): Promise<RunCommandResult> {
  const exe = resolveExecutable(binary, opts.cwd);
  assertSafeArgs(args);
  const timeoutMs = opts.timeoutMs ?? 120_000;

  return new Promise<RunCommandResult>((resolvePromise) => {
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const proc = spawn(exe, [...args], {
      cwd: opts.cwd,
      shell: false,
      env: opts.env ? { ...process.env, ...opts.env } : process.env,
    });

    const finish = (code: number | null, signal: string | null) => {
      if (timer) clearTimeout(timer);
      resolvePromise({ code, signal, stdout, stderr, timedOut });
    };

    if (timeoutMs > 0) {
      timer = setTimeout(() => {
        timedOut = true;
        try {
          proc.kill("SIGKILL");
        } catch {
          /* ignore */
        }
      }, timeoutMs);
      if (typeof timer.unref === "function") timer.unref();
    }

    proc.stdout?.on("data", (d) => (stdout += d.toString()));
    proc.stderr?.on("data", (d) => (stderr += d.toString()));
    proc.on("error", (e) => {
      stderr += String(e.message);
      finish(-1, null);
    });
    proc.on("close", (code, signal) => finish(code, signal));

    if (opts.stdin !== undefined && proc.stdin) {
      try {
        proc.stdin.end(opts.stdin);
      } catch {
        /* ignore */
      }
    }
  });
}

/** 受控长驻进程：回报 pid，转发输出到回调（供进程树/终端集成）。 */
export function spawnTracked(
  binary: string,
  args: readonly string[],
  opts: {
    cwd?: string;
    env?: Record<string, string>;
    onStdout?: (chunk: string) => void;
    onStderr?: (chunk: string) => void;
    onExit?: (code: number | null, signal: string | null) => void;
  } = {},
): TrackedProcess {
  const exe = resolveExecutable(binary, opts.cwd);
  assertSafeArgs(args);
  const proc = spawn(exe, [...args], {
    cwd: opts.cwd,
    shell: false,
    env: opts.env ? { ...process.env, ...opts.env } : process.env,
  });
  const pid = proc.pid ?? -1;
  proc.stdout?.on("data", (d) => opts.onStdout?.(d.toString()));
  proc.stderr?.on("data", (d) => opts.onStderr?.(d.toString()));
  proc.on("exit", (code, signal) => opts.onExit?.(code, signal));

  return {
    pid,
    proc,
    kill: (signal?: NodeJS.Signals) => proc.kill(signal),
  };
}

/** 杀进程组（Unix：负 pid 杀整个组；Windows 退化为单进程 kill）。 */
export function killProcessGroup(pid: number, signal: NodeJS.Signals = "SIGTERM"): boolean {
  if (pid <= 0) return false;
  if (process.platform === "win32") {
    try {
      // Windows：进程组概念弱，直接杀进程；子树清理交由调用方 taskkill。
      return process.kill(pid, signal);
    } catch {
      return false;
    }
  }
  try {
    return process.kill(-pid, signal); // 杀整个进程组
  } catch {
    try {
      return process.kill(pid, signal);
    } catch {
      return false;
    }
  }
}

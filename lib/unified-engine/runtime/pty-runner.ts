// pty-runner.ts —— PTY 终端运行器（M3 / Q4 / 等价迁移 autoplan terminal/pty_unix.go:36）
//
// 纯 TS 等价：优先使用 node-pty 起伪终端（保留 TTY 语义、信号、进度条等交互能力），
// 若运行环境未安装原生 node-pty 模块，则优雅降级为受控 spawn（无 PTY，但输出与进程树仍可用），
// 保证引擎「全链路可运行」且不依赖可选的本地构建产物。进程组杀除复用 process-runner。
//
// 安全：二进制经共享白名单解析（resolveExecutable），参数经注入校验，绝不 shell:true。
import { resolveExecutable, assertSafeArgs } from "../../allowed-commands";
import { spawnTracked, killProcessGroup } from "./process-runner";

export interface TerminalOptions {
  cwd?: string;
  /** 终端标题（用于 UI 展示）。 */
  title?: string;
  cols?: number;
  rows?: number;
  /** 数据输出回调（含 ANSI 序列）。 */
  onData?: (chunk: string) => void;
  onExit?: (code: number | null, signal: string | null) => void;
}

export interface TerminalHandle {
  pid: number;
  /** 写入终端输入（PTY 模式透传；spawn 降级模式忽略）。 */
  write: (data: string) => void;
  /** 调整窗口尺寸（PTY 模式）。 */
  resize: (cols: number, rows: number) => void;
  /** 杀除终端进程（含进程组，Unix）。 */
  kill: (signal?: NodeJS.Signals) => void;
  /** 是否真实 PTY 模式（false = spawn 降级）。 */
  isPty: boolean;
}

/** 探测 node-pty 是否可用（动态 import，避免静态依赖未安装的原生模块）。 */
async function tryLoadPty(): Promise<{
  spawn: (
    file: string,
    args: string[],
    opt: Record<string, unknown>,
  ) => {
    pid?: number;
    onData: (cb: (d: string) => void) => void;
    onExit: (cb: (code: number, signal?: string) => void) => void;
    write: (d: string) => void;
    resize: (cols: number, rows: number) => void;
    kill: (sig: string) => void;
  };
} | null> {
  try {
    const mod = (await import("node-pty")) as unknown;
    const m = mod as { spawn?: unknown };
    if (typeof m.spawn === "function") return m as never;
    return null;
  } catch {
    return null;
  }
}

/** 打开一个受控终端（执行指定命令的 argv 数组）。 */
export async function openTerminal(
  binary: string,
  args: readonly string[],
  opts: TerminalOptions = {},
): Promise<TerminalHandle> {
  const exe = resolveExecutable(binary, opts.cwd);
  assertSafeArgs(args);
  const pty = await tryLoadPty();

  if (pty) {
    const term = pty.spawn(exe, [...args], {
      cwd: opts.cwd,
      cols: opts.cols ?? 80,
      rows: opts.rows ?? 24,
      env: process.env,
    });
    const pid = term.pid ?? -1;
    term.onData((d: string) => opts.onData?.(d));
    term.onExit((code: number, signal?: string) => {
      opts.onExit?.(code, (signal as string) ?? null);
    });
    return {
      pid,
      isPty: true,
      write: (data: string) => term.write(data),
      resize: (cols: number, rows: number) => {
        try {
          term.resize(cols, rows);
        } catch {
          /* ignore */
        }
      },
      kill: (signal: NodeJS.Signals = "SIGTERM") => {
        killProcessGroup(pid, signal);
        try {
          term.kill(signal);
        } catch {
          /* ignore */
        }
      },
    };
  }

  // 降级：受控 spawn（无 PTY），输出照常转发，进程组杀除仍可用。
  const tracked = spawnTracked(exe, args, {
    cwd: opts.cwd,
    onStdout: (c) => opts.onData?.(c),
    onStderr: (c) => opts.onData?.(c),
    onExit: (code, signal) => opts.onExit?.(code, signal),
  });
  return {
    pid: tracked.pid,
    isPty: false,
    write: () => {
      /* spawn 降级模式无 TTY 输入通道 */
    },
    resize: () => {
      /* 无 PTY，无需 resize */
    },
    kill: (signal: NodeJS.Signals = "SIGTERM") => {
      killProcessGroup(tracked.pid, signal);
    },
  };
}

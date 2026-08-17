import { existsSync } from "node:fs";
import { delimiter, isAbsolute, join } from "node:path";
import type { IPtyForkOptions } from "node-pty";

/**
 * The shell already runs with the full privileges of the Pi Web process, so this
 * allowlist is defence in depth rather than a boundary. SSH_AUTH_SOCK is on it
 * deliberately: without the agent socket every `git push` over SSH fails, which
 * is the one thing a terminal in a coding tool is most often opened for.
 */
const SAFE_ENV_KEYS = new Set([
  "HOME",
  "LANG",
  "LOGNAME",
  "PATH",
  "SSH_AGENT_PID",
  "SSH_AUTH_SOCK",
  "TEMP",
  "TMP",
  "TMPDIR",
  "USER",
  "USERPROFILE",
  "SystemDrive",
  "SystemRoot",
  "windir",
]);

export interface TerminalSpawnConfig {
  file: string;
  args: string[];
  options: IPtyForkOptions;
}

function safeEnvironment(source: NodeJS.ProcessEnv, cwd: string, shell: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(source)) {
    if (typeof value !== "string") continue;
    if (key === "PATH") {
      env.PATH = [...new Set(value.split(delimiter).filter((entry) => isAbsolute(entry)))].join(delimiter);
    } else if (SAFE_ENV_KEYS.has(key) || key.startsWith("LC_")) {
      env[key] = value;
    }
  }
  env.COLORTERM = "truecolor";
  env.PWD = cwd;
  env.SHELL = shell;
  env.TERM = "xterm-256color";
  env.TERM_PROGRAM = "pi-web";
  return env;
}

function unixShell(): { file: string; args: string[] } {
  if (existsSync("/bin/bash")) {
    return { file: "/bin/bash", args: ["--noprofile", "--norc", "-i"] };
  }
  return { file: "/bin/sh", args: ["-i"] };
}

function windowsShell(source: NodeJS.ProcessEnv): { file: string; args: string[] } {
  const root = source.SystemRoot || source.windir || "C:\\Windows";
  const fixedShell = join(root, "System32", "cmd.exe");
  return { file: existsSync(fixedShell) ? fixedShell : "cmd.exe", args: ["/D", "/Q"] };
}

export function buildTerminalSpawnConfig(
  cwd: string,
  columns: number,
  rows: number,
  source: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): TerminalSpawnConfig {
  const shell = platform === "win32" ? windowsShell(source) : unixShell();
  return {
    ...shell,
    options: {
      name: "xterm-256color",
      cols: columns,
      rows,
      cwd,
      env: safeEnvironment(source, cwd, shell.file),
    },
  };
}

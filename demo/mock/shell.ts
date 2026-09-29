/**
 * A tiny simulated shell for `!command` prompts, bash tool calls and the
 * terminal panel. It understands a handful of read-only commands against the
 * virtual project files and explains the demo for everything else.
 */
import { currentDemoLocale } from "./locale";
import { listDirectory, lookup, readFileText } from "./files";
import { changedFiles } from "./git";
import { HOME, PROJECT_BRANCH, PROJECT_ROOT } from "./paths";

export interface ShellResult {
  output: string;
  exitCode: number;
}

const GIT_LOG = [
  "79c2a44 chore(deps): trim the production install and bump next, semver, undici (#948)",
  "040fadd Release v0.9.2",
  "234e19e perf(session): #928 + #912 rebased onto main, with fixes (#940)",
  "1bd40e4 feat(minimap): show a per-turn tool-call count in the hover preview (#939)",
  "058341d feat(models): add a manual \"Refresh catalog\" button to the Models panel (#914) (#938)",
  "6f1d2b0 fix(sidebar): keep the file explorer height when switching worktrees",
  "c3a9e11 feat(terminal): restore terminal tabs after reload",
  "8b47d5e docs: add worktree guide in English and Chinese",
];

function resolvePath(cwd: string, target: string | undefined): string {
  if (!target || target === ".") return cwd;
  if (target === "~") return HOME;
  if (target.startsWith("~/")) return `${HOME}/${target.slice(2)}`;
  const base = target.startsWith("/") ? target : `${cwd}/${target}`;
  const parts: string[] = [];
  for (const part of base.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") parts.pop();
    else parts.push(part);
  }
  return `/${parts.join("/")}`;
}

function notAvailable(command: string): ShellResult {
  const zh = currentDemoLocale() === "zh";
  return {
    output: zh
      ? `${command}: 这是 Pi Web 的静态演示，没有真实的 shell。\n可以试试：ls、pwd、cat <文件>、git status、git log、git branch、node -v、date、echo、help\n运行真实版本：npx @agegr/pi-web@latest`
      : `${command}: this is a static Pi Web demo, so there is no real shell.\nTry: ls, pwd, cat <file>, git status, git log, git branch, node -v, date, echo, help\nRun the real thing: npx @agegr/pi-web@latest`,
    exitCode: 127,
  };
}

async function gitStatus(cwd: string): Promise<ShellResult> {
  if (!cwd.startsWith(PROJECT_ROOT)) return { output: "fatal: not a git repository (or any of the parent directories): .git", exitCode: 128 };
  const files = await changedFiles();
  const modified = files.filter((file) => file.status === "modified").map((file) => `\tmodified:   ${file.path}`);
  const untracked = files.filter((file) => file.status === "untracked").map((file) => `\t${file.path}`);
  const lines = [`On branch ${PROJECT_BRANCH}`, "Your branch is up to date with 'origin/main'.", ""];
  if (modified.length) lines.push("Changes not staged for commit:", '  (use "git add <file>..." to update what will be committed)', ...modified, "");
  if (untracked.length) lines.push("Untracked files:", '  (use "git add <file>..." to include in what will be committed)', ...untracked, "");
  if (!modified.length && !untracked.length) lines.push("nothing to commit, working tree clean");
  else lines.push('no changes added to commit (use "git add" and/or "git commit -a")');
  return { output: lines.join("\n"), exitCode: 0 };
}

/** Run one command line; pipes are ignored except `| head -n`. */
export async function runShellCommand(commandLine: string, cwd: string): Promise<ShellResult> {
  const trimmed = commandLine.trim();
  if (!trimmed) return { output: "", exitCode: 0 };
  const [main, ...pipes] = trimmed.split("|").map((part) => part.trim());
  const headMatch = pipes.map((pipe) => /^head(?:\s+-n?\s*(\d+)|\s+-(\d+))?$/.exec(pipe)).find(Boolean);
  const headLimit = headMatch ? Number(headMatch[1] ?? headMatch[2] ?? 10) : undefined;
  const result = await runSingle(main, cwd);
  if (headLimit !== undefined) {
    result.output = result.output.split("\n").slice(0, headLimit).join("\n");
  }
  return result;
}

async function runSingle(commandLine: string, cwd: string): Promise<ShellResult> {
  const args = commandLine.match(/"[^"]*"|'[^']*'|\S+/g)?.map((arg) => arg.replace(/^["']|["']$/g, "")) ?? [];
  const [command, ...rest] = args;
  const flags = rest.filter((arg) => arg.startsWith("-"));
  const operands = rest.filter((arg) => !arg.startsWith("-"));
  switch (command) {
    case "pwd":
      return { output: cwd, exitCode: 0 };
    case "whoami":
      return { output: "demo", exitCode: 0 };
    case "echo":
      return { output: rest.join(" "), exitCode: 0 };
    case "date":
      return { output: new Date().toString(), exitCode: 0 };
    case "node":
      return flags.includes("-v") || flags.includes("--version") ? { output: "v22.19.0", exitCode: 0 } : notAvailable(commandLine);
    case "npm":
      return flags.includes("-v") || flags.includes("--version") ? { output: "10.9.3", exitCode: 0 } : notAvailable(commandLine);
    case "pi-web":
      return { output: "pi-web 0.9.2 — you are looking at it. ✨", exitCode: 0 };
    case "help":
      return notAvailable("help");
    case "ls": {
      const target = resolvePath(cwd, operands[0]);
      const entries = await listDirectory(target);
      if (!entries) {
        const file = await lookup(target);
        if (file?.kind === "file") return { output: operands[0] ?? target, exitCode: 0 };
        return { output: `ls: cannot access '${operands[0] ?? target}': No such file or directory`, exitCode: 2 };
      }
      const long = flags.some((flag) => flag.includes("l"));
      return {
        output: entries.map((entry) => (long ? `${entry.isDir ? "drwxr-xr-x" : "-rw-r--r--"}  demo  staff  ${entry.name}${entry.isDir ? "/" : ""}` : entry.name + (entry.isDir && flags.some((flag) => flag.includes("F")) ? "/" : ""))).join("\n"),
        exitCode: 0,
      };
    }
    case "cat":
    case "head":
    case "wc": {
      if (!operands[0]) return { output: `${command}: missing file operand`, exitCode: 1 };
      const found = await lookup(resolvePath(cwd, operands[0]));
      if (!found || found.kind !== "file") return { output: `${command}: ${operands[0]}: No such file or directory`, exitCode: 1 };
      const text = await readFileText(found.file);
      if (command === "wc") return { output: `${String(text.split("\n").length).padStart(8)} ${operands[0]}`, exitCode: 0 };
      if (command === "head") return { output: text.split("\n").slice(0, 10).join("\n"), exitCode: 0 };
      return { output: text, exitCode: 0 };
    }
    case "git": {
      const sub = operands[0];
      if (sub === "status") return gitStatus(cwd);
      if (sub === "log") return { output: GIT_LOG.join("\n"), exitCode: 0 };
      if (sub === "branch") return { output: `* ${PROJECT_BRANCH}\n  feat/session-timer`, exitCode: 0 };
      if (sub === "diff") return { output: "(run the Changes view in the file explorer to see diffs)", exitCode: 0 };
      return notAvailable(commandLine);
    }
    default:
      return notAvailable(command ?? commandLine);
  }
}

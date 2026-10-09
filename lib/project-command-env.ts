import { Type } from "@earendil-works/pi-ai";
import {
  createBashToolDefinition,
  createLocalBashOperations,
  getAgentDir,
  type BashOperations,
  type InlineExtension,
  type LoadExtensionsResult,
} from "@earendil-works/pi-coding-agent";
import { join } from "node:path";
import { createWriteStream } from "node:fs";
import { readFile } from "node:fs/promises";
import {
  bgLogPath,
  FOREGROUND_AUTO_BACKGROUND_MS,
  PreHandoffBuffer,
  trackBgTask,
  untrackBgTask,
} from "./bash-bg-tasks";
import { buildBgTaskNotification } from "./bg-task-notification";

const HOST_EXTENSION_NAME = "pi-web-project-command-environment";
const HOST_EXTENSION_PATH = `<inline:${HOST_EXTENSION_NAME}>`;
// Pi's own abort path settles well within this once the process tree is gone.
const ABORT_SETTLE_GRACE_MS = 1000;
const MAX_TIMER_DELAY_MS = 2_147_483_647;

type ProjectShellSettings = {
  getShellCommandPrefix(): string | undefined;
  getShellPath(): string | undefined;
};

type BgTaskOptions = {
  /** Delivers the completion notification into the parent session. */
  notify(sessionId: string, text: string): Promise<void>;
};

type ProjectCommandBashOperationsOptions = {
  abortSettleGraceMs?: number;
  agentBinDir?: string;
  baseEnvironment?: NodeJS.ProcessEnv;
  localOperations?: BashOperations;
  platform?: NodeJS.Platform;
  shellPath?: string;
  /** When set, foreground commands without an explicit timeout hand off to background after this long. */
  autoBackgroundMs?: number;
  bgTask?: {
    sessionId: string;
    notify: BgTaskOptions["notify"];
  };
};

type BashExecResult = Awaited<ReturnType<BashOperations["exec"]>>;

function isHostRuntimeVariable(name: string, platform: NodeJS.Platform): boolean {
  const comparableName = platform === "win32" ? name.toUpperCase() : name;
  return comparableName === "PORT"
    || comparableName === "NODE_ENV"
    || comparableName.startsWith("NEXT_")
    // The browser login password guards this server; commands run on behalf of
    // a project (and the model reading their output) have no use for it.
    || comparableName === "PI_WEB_PASSWORD";
}

export function sanitizeProjectCommandEnvironment(
  baseEnvironment: NodeJS.ProcessEnv,
  platform: NodeJS.Platform = process.platform,
): NodeJS.ProcessEnv {
  const environment = { ...baseEnvironment };
  for (const name of Object.keys(environment)) {
    if (isHostRuntimeVariable(name, platform)) delete environment[name];
  }
  return environment;
}

function withAgentBinDirectory(
  environment: NodeJS.ProcessEnv,
  agentBinDir: string,
  platform: NodeJS.Platform,
): NodeJS.ProcessEnv {
  const pathKey = platform === "win32"
    ? Object.keys(environment).find((name) => name.toUpperCase() === "PATH") ?? "PATH"
    : "PATH";
  const pathDelimiter = platform === "win32" ? ";" : ":";
  const currentPath = environment[pathKey] ?? "";
  const pathEntries = currentPath.split(pathDelimiter).filter(Boolean);
  if (!pathEntries.includes(agentBinDir)) {
    environment[pathKey] = [agentBinDir, currentPath].filter(Boolean).join(pathDelimiter);
  }
  return environment;
}

export function createProjectCommandBashOperations(
  options: ProjectCommandBashOperationsOptions = {},
): BashOperations {
  const {
    abortSettleGraceMs = ABORT_SETTLE_GRACE_MS,
    agentBinDir = join(getAgentDir(), "bin"),
    baseEnvironment = process.env,
    localOperations = createLocalBashOperations({ shellPath: options.shellPath }),
    platform = process.platform,
    autoBackgroundMs,
    bgTask,
  } = options;

  return {
    exec(command, cwd, executionOptions) {
      const environment = withAgentBinDirectory(
        sanitizeProjectCommandEnvironment(executionOptions.env ?? baseEnvironment, platform),
        agentBinDir,
        platform,
      );
      const { onData, signal, timeout } = executionOptions;
      let released = false;
      // The local ops only listens to our controller, so a tool-call abort after
      // the auto-background handoff can no longer kill the backgrounded process.
      // Before the handoff, abort forwards into the controller (see below);
      // after it, the wrapper's abort listener is gone and the process survives.
      const bgController = bgTask ? new AbortController() : undefined;
      if (bgController && bgTask) trackBgTask(bgTask.sessionId, bgController);
      const execSignal = bgController ? bgController.signal : signal;
      let handedOff = false;
      // With auto-background armed, capture everything the model has not seen
      // yet so the handoff log keeps it. An explicit timeout does not disable
      // the handoff; it stays the process's own hard limit.
      const autoBgArmed = autoBackgroundMs !== undefined && bgTask !== undefined;
      const buffer = autoBgArmed ? new PreHandoffBuffer() : undefined;
      let bgStream: ReturnType<typeof createWriteStream> | undefined;
      const startedAtMs = Date.now();
      const execution = localOperations.exec(command, cwd, {
        ...executionOptions,
        env: environment,
        signal: execSignal,
        // Callers finalize their output once the command is released; a
        // survivor must not append to it afterwards.
        onData: (data) => {
          if (!released) onData(data);
          if (bgStream) bgStream.write(data);
          else buffer?.push(data);
        },
      });
      // Pi rejects any other timeout before it starts the command.
      const timeoutMs = typeof timeout === "number" && Number.isFinite(timeout) && timeout > 0
        ? timeout * 1000
        : undefined;
      if (!execSignal && timeoutMs === undefined && !autoBgArmed) return execution;

      // On Stop or a timeout, pi kills the shell's process tree but then keeps
      // reading until every inherited stdout/stderr handle falls idle. A
      // descendant the kill cannot reach (its own session on POSIX, an orphan
      // `taskkill /T` misses on Windows) can keep writing and hold the tool
      // call, and with it Stop and any steering, until the script ends on its
      // own (#647). The errors are pi's own, so the bash tool reports them as
      // "Command aborted" and "Command timed out".
      return new Promise<BashExecResult>((resolve, reject) => {
        const timers: ReturnType<typeof setTimeout>[] = [];
        const release = () => {
          released = true;
          for (const timer of timers) clearTimeout(timer);
          signal?.removeEventListener("abort", onAbort);
          execSignal?.removeEventListener("abort", onAbort);
        };
        const releaseAfter = (delayMs: number, error: Error) => {
          timers.push(setTimeout(() => {
            release();
            reject(error);
          }, Math.min(delayMs, MAX_TIMER_DELAY_MS)));
        };
        const onAbort = () => {
          if (!handedOff) bgController?.abort();
          releaseAfter(abortSettleGraceMs, new Error("aborted"));
        };
        if (timeoutMs !== undefined) {
          releaseAfter(timeoutMs + abortSettleGraceMs, new Error(`timeout:${timeout}`));
        }
        if (autoBgArmed && buffer && bgTask) {
          const timer = setTimeout(() => {
            handedOff = true;
            released = true;
            const logPath = bgLogPath();
            bgStream = createWriteStream(logPath);
            for (const chunk of buffer.dump()) bgStream.write(chunk);
            execution.then(
              (result) => {
                bgStream?.end();
                void reportBgTask(bgTask, command, logPath, startedAtMs, result.exitCode ?? null, undefined);
              },
              (error: unknown) => {
                bgStream?.end();
                void reportBgTask(bgTask, command, logPath, startedAtMs, null, error instanceof Error ? error.message : String(error));
              },
            );
            release();
            reject(new Error(`bg-task-backgrounded:${logPath}`));
          }, autoBackgroundMs);
          (timer as { unref?: () => void }).unref?.();
          timers.push(timer);
        }
        if (bgController && bgTask) {
          // Auto-bg completion reports through bg.onEnd; a handoff already
          // rejected the promise, so settle both branches only on non-handoff.
          execution.then(
            () => untrackBgTask(bgTask.sessionId, bgController),
            () => untrackBgTask(bgTask.sessionId, bgController),
          );
        }
        execution.then((result) => {
          release();
          resolve(result);
        }, (error: unknown) => {
          release();
          reject(error);
        });
        if (execSignal?.aborted) onAbort();
        else execSignal?.addEventListener("abort", onAbort, { once: true });
        // The tool call's own signal is what Stop fires, and with a bg task the
        // child listens to our controller instead. Forward one into the other;
        // after a handoff onAbort leaves the backgrounded process alone.
        if (signal && signal !== execSignal) {
          if (signal.aborted) onAbort();
          else signal.addEventListener("abort", onAbort, { once: true });
        }
      });
    },
  };
}

async function reportBgTask(
  bgTask: { sessionId: string; notify: BgTaskOptions["notify"] },
  command: string,
  logPath: string,
  startedAtMs: number,
  exitCode: number | null,
  error: string | undefined,
): Promise<void> {
  const tail = await readLogTail(logPath);
  try {
    await bgTask.notify(bgTask.sessionId, buildBgTaskNotification({
      command, logPath, startedAtMs, finishedAtMs: Date.now(), exitCode, error,
    }, tail));
  } catch (cause) {
    console.error("[pi-web] failed to deliver bg task notification:", cause instanceof Error ? cause.message : cause);
  }
}

async function readLogTail(path: string, maxBytes = 4096): Promise<string> {
  try {
    const content = await readFile(path);
    return (content.length > maxBytes ? content.subarray(content.length - maxBytes) : content).toString("utf8");
  } catch {
    return "";
  }
}

export function createProjectCommandBashExtension(options: {
  cwd: string;
  settings: ProjectShellSettings;
  bgTasks?: { notify(sessionId: string, text: string): Promise<void> };
}): InlineExtension {
  return {
    name: HOST_EXTENSION_NAME,
    hidden: true,
    factory: (pi) => {
      const bg = options.bgTasks;
      const displayDefinition = createBashToolDefinition(options.cwd);
      pi.registerTool({
        ...displayDefinition,
        ...(bg
          ? {
              parameters: Type.Object({
                command: Type.String({ description: "Shell command to execute" }),
                timeout: Type.Optional(Type.Number({ description: "Timeout in seconds (optional, no default timeout)" })),
                run_in_background: Type.Optional(Type.Boolean({ description: "Run this command in the background immediately; you will be notified when it completes." })),
              }),
              description: `${displayDefinition.description} Supports background execution: pass run_in_background=true for long-running commands, or let foreground commands auto-background after ${FOREGROUND_AUTO_BACKGROUND_MS / 1000} seconds; you are notified when a background command finishes.`,
              promptGuidelines: [
                ...(displayDefinition.promptGuidelines ?? []),
                "When you can already expect a command to run for a long time (dev server, watcher, long build, large download), do NOT force a timeout: set run_in_background=true and continue with other work.",
                "A foreground command auto-backgrounds after 120 seconds; treat that as a handoff, not a failure.",
                "After starting a background command you are notified on completion — do not wait, poll, or sleep for it; do work that does not depend on its result, like an async request.",
              ],
            }
          : {}),
        async execute(toolCallId, params, signal, onUpdate, context) {
          const input = params as { command: string; timeout?: number; run_in_background?: boolean };
          if (bg && input.run_in_background === true) {
            return startBackgroundCommand(options, input, context);
          }
          const executionDefinition = createBashToolDefinition(options.cwd, {
            commandPrefix: options.settings.getShellCommandPrefix(),
            operations: createProjectCommandBashOperations({
              shellPath: options.settings.getShellPath(),
              autoBackgroundMs: bg ? FOREGROUND_AUTO_BACKGROUND_MS : undefined,
              bgTask: bg && context?.sessionManager
                ? { sessionId: context.sessionManager.getSessionId(), notify: bg.notify }
                : undefined,
            }),
          });
          try {
            return await executionDefinition.execute(toolCallId, params, signal, onUpdate, context);
          } catch (error) {
            if (error instanceof Error && error.message.startsWith("bg-task-backgrounded:")) {
              const logPath = error.message.slice("bg-task-backgrounded:".length);
              return {
                content: [{ type: "text" as const, text: `Command auto-backgrounded after ${FOREGROUND_AUTO_BACKGROUND_MS / 1000}s.\nLog file: ${logPath}\nYou will be notified when it completes — do not wait or poll; continue with other work.` }],
                details: undefined,
              };
            }
            throw error;
          }
        },
      });
    },
  };
}

function startBackgroundCommand(
  options: { cwd: string; settings: ProjectShellSettings; bgTasks?: { notify(sessionId: string, text: string): Promise<void> } },
  params: { command: string; timeout?: number },
  context?: { cwd?: string; sessionManager?: { getSessionId(): string } },
) {
  const sessionId = context?.sessionManager?.getSessionId();
  const cwd = context?.cwd ?? options.cwd;
  const logPath = bgLogPath();
  const stream = createWriteStream(logPath);
  const controller = new AbortController();
  const startedAtMs = Date.now();
  if (sessionId) trackBgTask(sessionId, controller);
  const prefix = options.settings.getShellCommandPrefix();
  const commandText = prefix ? `${prefix}\n${params.command}` : params.command;
  const ops = createProjectCommandBashOperations({ shellPath: options.settings.getShellPath() });
  const execution = ops.exec(commandText, cwd, {
    onData: (data) => stream.write(data),
    signal: controller.signal,
    timeout: params.timeout,
  });
  void (async () => {
    let exitCode: number | null = null;
    let error: string | undefined;
    try {
      const result = await execution;
      exitCode = result.exitCode;
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
      if (error === "aborted") error = "aborted (session stopped)";
      else if (error.startsWith("timeout:")) error = `timed out after ${error.split(":")[1]}s`;
    }
    stream.end();
    if (sessionId) untrackBgTask(sessionId, controller);
    if (sessionId && options.bgTasks) {
      try {
        const tail = await readLogTail(logPath);
        await options.bgTasks.notify(sessionId, buildBgTaskNotification({
          command: params.command, logPath, startedAtMs, finishedAtMs: Date.now(), exitCode, error,
        }, tail));
      } catch (cause) {
        console.error("[pi-web] failed to deliver bg task notification:", cause instanceof Error ? cause.message : cause);
      }
    }
  })();
  return Promise.resolve({
    content: [{ type: "text" as const, text: `Command started in background.\nLog file: ${logPath}\nYou will be notified when it completes — do not wait or poll; continue with other work.` }],
    details: undefined,
  });
}

export function preferUserBashExtension(base: LoadExtensionsResult): LoadExtensionsResult {
  const hostExtensionIndex = base.extensions.findIndex((extension) => extension.path === HOST_EXTENSION_PATH);
  if (hostExtensionIndex < 0) return base;

  const userBashOwner = base.extensions
    .slice(0, hostExtensionIndex)
    .find((extension) => extension.tools.has("bash"));
  if (!userBashOwner) return base;

  return {
    ...base,
    extensions: base.extensions.filter((_, index) => index !== hostExtensionIndex),
    errors: base.errors.filter((error) => !(
      error.path === HOST_EXTENSION_PATH
      && error.error === `Tool "bash" conflicts with ${userBashOwner.path}`
    )),
  };
}

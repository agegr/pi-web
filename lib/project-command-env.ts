import {
  createBashToolDefinition,
  createLocalBashOperations,
  createLocalPowerShellOperations,
  createPowerShellToolDefinition,
  getAgentDir,
  type BashOperations,
  type InlineExtension,
  type LoadExtensionsResult,
} from "@earendil-works/pi-coding-agent";
import { join } from "node:path";

const HOST_EXTENSION_NAME = "pi-web-project-command-environment";
const HOST_EXTENSION_PATH = `<inline:${HOST_EXTENSION_NAME}>`;
// Its own extension, so a user's `powershell` or `bash` replaces only the tool it names.
const POWERSHELL_HOST_EXTENSION_NAME = "pi-web-project-command-powershell";
const POWERSHELL_HOST_EXTENSION_PATH = `<inline:${POWERSHELL_HOST_EXTENSION_NAME}>`;
// Pi's own abort path settles well within this once the process tree is gone.
const ABORT_SETTLE_GRACE_MS = 1000;
const MAX_TIMER_DELAY_MS = 2_147_483_647;

type ProjectShellSettings = {
  getShellCommandPrefix(): string | undefined;
  getShellPath(): string | undefined;
};

type ProjectCommandBashOperationsOptions = {
  abortSettleGraceMs?: number;
  agentBinDir?: string;
  baseEnvironment?: NodeJS.ProcessEnv;
  localOperations?: BashOperations;
  platform?: NodeJS.Platform;
  shellPath?: string;
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
      const execution = localOperations.exec(command, cwd, {
        ...executionOptions,
        env: environment,
        // Callers finalize their output once the command is released; a
        // survivor must not append to it afterwards.
        onData: (data) => {
          if (!released) onData(data);
        },
      });
      // Pi rejects any other timeout before it starts the command.
      const timeoutMs = typeof timeout === "number" && Number.isFinite(timeout) && timeout > 0
        ? timeout * 1000
        : undefined;
      if (!signal && timeoutMs === undefined) return execution;

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
        };
        const releaseAfter = (delayMs: number, error: Error) => {
          timers.push(setTimeout(() => {
            release();
            reject(error);
          }, Math.min(delayMs, MAX_TIMER_DELAY_MS)));
        };
        const onAbort = () => releaseAfter(abortSettleGraceMs, new Error("aborted"));
        if (timeoutMs !== undefined) {
          releaseAfter(timeoutMs + abortSettleGraceMs, new Error(`timeout:${timeout}`));
        }
        execution.then((result) => {
          release();
          resolve(result);
        }, (error: unknown) => {
          release();
          reject(error);
        });
        if (signal?.aborted) onAbort();
        else signal?.addEventListener("abort", onAbort, { once: true });
      });
    },
  };
}

export function createProjectCommandBashExtension(options: {
  cwd: string;
  settings: ProjectShellSettings;
}): InlineExtension {
  return {
    name: HOST_EXTENSION_NAME,
    hidden: true,
    factory: (pi) => {
      const displayDefinition = createBashToolDefinition(options.cwd);
      pi.registerTool({
        ...displayDefinition,
        // This stands in for pi's built-in bash, so like it, it is active only when named:
        // by `defaultTools` (pi's default list names it), a preset or `set_tools`. Otherwise
        // pi turns it on at every start and reload, as it does any extension tool, whatever
        // `defaultTools` leaves out (#1235).
        defaultActive: false,
        execute(toolCallId, params, signal, onUpdate, context) {
          const executionDefinition = createBashToolDefinition(options.cwd, {
            commandPrefix: options.settings.getShellCommandPrefix(),
            operations: createProjectCommandBashOperations({
              shellPath: options.settings.getShellPath(),
            }),
          });
          return executionDefinition.execute(toolCallId, params, signal, onUpdate, context);
        },
      });
    },
  };
}

/**
 * pi's built-in `powershell` runs commands with the server's whole environment, as its
 * `bash` does; this stands in for it with the same sanitized operations (ADR 0001). pi
 * registers `powershell` on every platform and resolves the PowerShell executable only
 * when a command runs, so this needs no platform check either.
 */
export function createProjectCommandPowerShellExtension(options: { cwd: string }): InlineExtension {
  return {
    name: POWERSHELL_HOST_EXTENSION_NAME,
    hidden: true,
    factory: (pi) => {
      pi.registerTool({
        ...createPowerShellToolDefinition(options.cwd),
        // Active only when named (`defaultTools`, the PowerShell switch, a preset), as pi's own is (#1235).
        defaultActive: false,
        execute(toolCallId, params, signal, onUpdate, context) {
          const executionDefinition = createPowerShellToolDefinition(options.cwd, {
            operations: createProjectCommandBashOperations({
              localOperations: createLocalPowerShellOperations(),
            }),
          });
          return executionDefinition.execute(toolCallId, params, signal, onUpdate, context);
        },
      });
    },
  };
}

/** Drop a host extension when a user extension loaded before it already owns its tool. */
function preferUserToolExtension(base: LoadExtensionsResult, hostPath: string, toolName: string): LoadExtensionsResult {
  const hostExtensionIndex = base.extensions.findIndex((extension) => extension.path === hostPath);
  if (hostExtensionIndex < 0) return base;

  const userToolOwner = base.extensions
    .slice(0, hostExtensionIndex)
    .find((extension) => extension.tools.has(toolName));
  if (!userToolOwner) return base;

  return {
    ...base,
    extensions: base.extensions.filter((_, index) => index !== hostExtensionIndex),
    errors: base.errors.filter((error) => !(
      error.path === hostPath
      && error.error === `Tool "${toolName}" conflicts with ${userToolOwner.path}`
    )),
  };
}

export function preferUserBashExtension(base: LoadExtensionsResult): LoadExtensionsResult {
  return preferUserToolExtension(base, HOST_EXTENSION_PATH, "bash");
}

export function preferUserPowerShellExtension(base: LoadExtensionsResult): LoadExtensionsResult {
  return preferUserToolExtension(base, POWERSHELL_HOST_EXTENSION_PATH, "powershell");
}

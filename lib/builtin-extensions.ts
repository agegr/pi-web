import { join } from "node:path";
import {
  CONFIG_DIR_NAME,
  createCodemodeExtension,
  createMcpExtension,
  createToolSearchExtension,
  DefaultPackageManager,
  SettingsManager,
  type ExtensionAPI,
  type ExtensionContext,
  type ExtensionFactory,
  type InlineExtension,
  type LoadedMcpConfig,
  type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { McpHost, type McpHostOptions } from "./mcp-host";
import { CODEMODE_EXTENSION_PATH } from "./mcp-command";
import { createPiWebMcpTransportFactory } from "./mcp-transport";
import { loadPiSdkInternals, type PiSdkInternals, type PiSdkInternalsResult } from "./pi-sdk-internals";
import { mayReadProjectConfigNow } from "./project-trust";
import { PROJECT_SETTINGS_MAX_BYTES, readRegularFileText } from "./regular-file";

// The built-in extensions the pi CLI prepends from a module the SDK does not
// export (ADR 0006, "Loading"). Normal sessions load them under the CLI's
// names, so `-builtin:<name>`, project overrides, `noExtensions`, and
// replacement by a third-party extension that registers `/mcp`, `codemode`, or
// `tool_search` behave as in the CLI. `llama.cpp` is not among them: it serves
// a local model server, not a feature of the session. Chat-only and subagent
// sessions load none of them.

export const MCP_DISABLE_VARIABLE = "PI_WEB_DISABLE_MCP";

export type BuiltinFeatureStatus = { available: true } | { available: false; reason: string };

/**
 * Whether the operator turned MCP off for the whole server. Any value other
 * than empty, `0`, or `false` counts: a switch that guards a server should not
 * be undone by spelling `yes` instead of `1`.
 */
export function isMcpDisabledByOperator(environment: NodeJS.ProcessEnv = process.env): boolean {
  const value = environment[MCP_DISABLE_VARIABLE]?.trim().toLowerCase();
  return value !== undefined && value !== "" && value !== "0" && value !== "false";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// ---------------------------------------------------------------------------
// Code mode sandbox self-test
// ---------------------------------------------------------------------------

const SELF_TEST_SCRIPT = "return 6 * 7";
const SELF_TEST_OUTPUT = "42";
const SELF_TEST_TIMEOUT_MS = 10_000;

export interface CodemodeSelfTestOptions {
  timeoutMs?: number;
  /** The codemode tool to run; tests replace it. Defaults to the SDK's. */
  createDefinition?: () => Promise<ToolDefinition>;
}

/**
 * The SDK's codemode tool definition, taken from its public extension factory.
 * Only `registerTool` is used while loading; the stubs cover what a script
 * without tool calls, store writes, or `models` reaches at run time.
 */
async function sdkCodemodeDefinition(): Promise<ToolDefinition> {
  let definition: ToolDefinition | undefined;
  const pi = {
    registerTool: (tool: ToolDefinition) => {
      definition = tool;
    },
    getSettings: () => ({}),
    getAllTools: () => [],
    appendEntry: () => {},
  } as unknown as ExtensionAPI;
  await createCodemodeExtension({ models: false })(pi);
  if (!definition) throw new Error("the codemode extension registered no tool");
  return definition;
}

function resultText(result: { content?: readonly { type: string; text?: string }[] }): string[] {
  return (result.content ?? []).flatMap((block) => (block.type === "text" && block.text !== undefined ? [block.text] : []));
}

/**
 * Run one script through the SDK's codemode tool, with the QuickJS sandbox in
 * its worker thread exactly as a session runs it. The worker and the wasm file
 * are resolved from the SDK's own files at run time, which a bundled or
 * relocated install can break; when that happens the tool would fail every
 * call, so pi-web does not offer it.
 */
export async function runCodemodeSelfTest(options: CodemodeSelfTestOptions = {}): Promise<BuiltinFeatureStatus> {
  const timeoutMs = options.timeoutMs ?? SELF_TEST_TIMEOUT_MS;
  const controller = new AbortController();
  let timer: NodeJS.Timeout | undefined;
  const timedOut = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error(`the sandbox did not answer within ${timeoutMs} ms`));
    }, timeoutMs);
    timer.unref?.();
  });
  try {
    const run = (async () => {
      const definition = await (options.createDefinition ?? sdkCodemodeDefinition)();
      // Without a session context the script reaches no tools, store, or models.
      return await definition.execute("pi-web-self-test", { code: SELF_TEST_SCRIPT }, controller.signal, undefined, undefined as never);
    })();
    // A run that settles after the timeout must not surface as an unhandled rejection.
    run.catch(() => {});
    const result = await Promise.race([run, timedOut]);
    const text = resultText(result);
    if ((result as { isError?: boolean }).isError) {
      return { available: false, reason: `the self-test script failed: ${text.join(" ").trim() || "no output"}` };
    }
    if (!text.some((line) => line.trim() === SELF_TEST_OUTPUT)) {
      return { available: false, reason: `the self-test script returned ${JSON.stringify(text.join(" ").trim())}` };
    }
    return { available: true };
  } catch (error) {
    return { available: false, reason: errorMessage(error) };
  } finally {
    clearTimeout(timer);
  }
}

// Hot reload re-evaluates this module; globalThis keeps one self-test per process.
const CODEMODE_SANDBOX_KEY: symbol = Symbol.for("pi-web.codemodeSandbox");

/** The sandbox self-test, run once per server process on the first normal session. */
export function checkCodemodeSandbox(): Promise<BuiltinFeatureStatus> {
  const store = globalThis as Record<symbol, Promise<BuiltinFeatureStatus> | undefined>;
  return store[CODEMODE_SANDBOX_KEY] ??= runCodemodeSelfTest().then((status) => {
    if (!status.available) console.warn(`[pi-web] Code mode is off: ${status.reason}`);
    return status;
  });
}

export type CodemodeSandboxPeek = { checked: false } | ({ checked: true } & BuiltinFeatureStatus);

const NOT_SETTLED: unique symbol = Symbol("not settled");

/**
 * The self-test's result once it has settled, without ever starting it: the
 * first normal session runs it, and Settings only reports what it found. A
 * test still running, or not started since the server did, is `checked:
 * false`. A promise that has already settled wins the race against one
 * resolved now, because their reactions run in the order they were attached.
 */
export async function peekCodemodeSandbox(): Promise<CodemodeSandboxPeek> {
  const store = globalThis as Record<symbol, Promise<BuiltinFeatureStatus> | undefined>;
  const pending = store[CODEMODE_SANDBOX_KEY];
  if (!pending) return { checked: false };
  const settled = await Promise.race([pending, Promise.resolve(NOT_SETTLED)]);
  return settled === NOT_SETTLED ? { checked: false } : { checked: true, ...settled };
}

// ---------------------------------------------------------------------------
// MCP
// ---------------------------------------------------------------------------

export type McpRuntimeResult =
  | { available: true; internals: PiSdkInternals }
  | { available: false; reason: string };

export function mcpRuntimeFromInternals(
  internals: PiSdkInternalsResult,
  environment: NodeJS.ProcessEnv = process.env,
): McpRuntimeResult {
  if (isMcpDisabledByOperator(environment)) {
    return { available: false, reason: `${MCP_DISABLE_VARIABLE} is set` };
  }
  if (!internals.ok) return { available: false, reason: internals.reason };
  return { available: true, internals };
}

const MCP_WARNED_KEY: symbol = Symbol.for("pi-web.mcpOffWarned");

async function loadMcpRuntime(): Promise<McpRuntimeResult> {
  const runtime = mcpRuntimeFromInternals(await loadPiSdkInternals());
  const store = globalThis as Record<symbol, string | undefined>;
  // The operator's switch is deliberate and needs no warning; a failed adapter does.
  if (!runtime.available && !isMcpDisabledByOperator() && store[MCP_WARNED_KEY] !== runtime.reason) {
    store[MCP_WARNED_KEY] = runtime.reason;
    console.warn(`[pi-web] MCP is off: ${runtime.reason}`);
  }
  return runtime;
}

/**
 * `loadConfig` for the SDK's MCP extension. Pi Web decides which servers a
 * session connects and registers them itself, so the extension connects none
 * on `session_start`, and its startup wait, which ignores Stop, never arms.
 * The file-level `autoEnableCodemode` still comes from `mcp.json`, as in the
 * CLI; reading it runs nothing. Whether the project file counts is read fresh,
 * with the MCP host's read (`mayReadProjectConfigNow()`), not from the
 * wrapper's `ctx.isProjectTrusted()`, which is fixed when the wrapper is built
 * and refreshed only on reload. The extension calls `loadConfig` only on
 * `session_start`, though — when the wrapper is built and on reload — so a
 * project's `autoEnableCodemode` keeps the value read then: a trust decision
 * made later reaches the project's servers on the next prompt, but this flag
 * only on the next reload.
 */
export function createMcpExtensionConfigLoader(
  internals: Pick<PiSdkInternals, "loadMcpConfig">,
  agentDir: string,
  mayReadProjectConfig: (cwd: string) => boolean = (cwd) => mayReadProjectConfigNow(cwd, agentDir),
): (ctx: ExtensionContext) => LoadedMcpConfig {
  return (ctx) => {
    let autoEnableCodemode: boolean | undefined;
    try {
      autoEnableCodemode = internals.loadMcpConfig({
        agentDir,
        cwd: ctx.cwd,
        projectTrusted: mayReadProjectConfig(ctx.cwd),
      }).autoEnableCodemode;
    } catch {
      // Unreadable files are reported where servers are managed, not on every session start.
    }
    return { servers: [], errors: [], ...(autoEnableCodemode === undefined ? {} : { autoEnableCodemode }) };
  };
}

// ---------------------------------------------------------------------------
// Whether the settings switch a built-in off
// ---------------------------------------------------------------------------

export const BUILTIN_EXTENSION_NAMES = ["codemode", "tool-search", "mcp"] as const;
export type BuiltinExtensionName = typeof BUILTIN_EXTENSION_NAMES[number];

export interface BuiltinExtensionSwitch {
  enabled: boolean;
  /** The settings file whose `extensions` entry turns it off. */
  settingsPath?: string;
  /**
   * What the global settings alone make of it. Present only when a trusted
   * project's `extensions` list was read; otherwise the switch itself is the
   * global answer. A global setting, such as Code mode's Always on, is weighed
   * against this, never against whichever project Settings was opened from.
   */
  global?: { enabled: boolean; settingsPath?: string };
}

/**
 * A settings file's `extensions` list, read as SettingsManager reads it: a
 * byte-order mark is allowed, and a file that does not parse counts as empty.
 * A FIFO or a device there throws instead of blocking the server on a read
 * nothing answers, as does a project file past `PROJECT_SETTINGS_MAX_BYTES`.
 */
function readSettingsExtensions(path: string, maxBytes?: number): string[] | undefined {
  const text = readRegularFileText(path, maxBytes);
  if (text === undefined) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
  } catch {
    return undefined;
  }
  const extensions = typeof parsed === "object" && parsed !== null ? (parsed as { extensions?: unknown }).extensions : undefined;
  return Array.isArray(extensions) ? extensions.filter((entry): entry is string => typeof entry === "string") : undefined;
}

type SettingsScope = "global" | "project";

async function resolveBuiltinSwitches(
  options: { agentDir: string; cwd: string; projectTrusted: boolean },
  lists: Partial<Record<SettingsScope, string[]>>,
  paths: Record<SettingsScope, string>,
): Promise<Record<BuiltinExtensionName, BuiltinExtensionSwitch>> {
  const { agentDir, cwd, projectTrusted } = options;
  const storage: Parameters<typeof SettingsManager.fromStorage>[0] = {
    withLock: (scope, fn) => {
      const extensions = lists[scope];
      fn(extensions ? JSON.stringify({ extensions }) : undefined);
    },
  };
  const packageManager = new DefaultPackageManager({
    cwd,
    agentDir,
    settingsManager: SettingsManager.fromStorage(storage, { projectTrusted }),
    builtinExtensions: [...BUILTIN_EXTENSION_NAMES],
  });
  // Nothing is missing without packages; skip rather than install if that ever changes.
  const resolved = await packageManager.resolve(async () => "skip");
  const switches = {} as Record<BuiltinExtensionName, BuiltinExtensionSwitch>;
  for (const name of BUILTIN_EXTENSION_NAMES) {
    const resource = resolved.extensions.find((extension) => extension.path === `builtin:${name}`);
    const enabled = resource?.enabled ?? true;
    switches[name] = enabled
      ? { enabled }
      : { enabled, settingsPath: resource?.metadata.scope === "project" ? paths.project : paths.global };
  }
  return switches;
}

/**
 * Whether the `extensions` settings leave each built-in on, read from the
 * files as the session's resource loader would: `-builtin:mcp` (or a `!`
 * pattern matching it) in the global settings turns it off, and a matching
 * `+`, `-` or `!` entry in a trusted project's settings overrides that. The
 * SDK's package manager decides, so its pattern rules apply exactly; it is
 * given only the two `extensions` lists, never `packages`, so it cannot
 * install or even look up a package. It still scans the extension, skill,
 * prompt and theme folders it auto-discovers, which only reads them. When a
 * trusted project has a list of its own, the global list is resolved a second
 * time on its own for each switch's `global` answer.
 */
export async function readBuiltinExtensionSwitches(options: {
  agentDir: string;
  /** Without one, only the global settings count. */
  cwd?: string;
  projectTrusted: boolean;
}): Promise<Record<BuiltinExtensionName, BuiltinExtensionSwitch>> {
  const { agentDir } = options;
  const projectTrusted = options.cwd !== undefined && options.projectTrusted;
  const cwd = options.cwd ?? agentDir;
  const paths = {
    global: join(agentDir, "settings.json"),
    project: join(cwd, CONFIG_DIR_NAME, "settings.json"),
  };
  const global = readSettingsExtensions(paths.global);
  // The project file is the repository's, read by a GET: capped, and never a FIFO.
  const project = projectTrusted ? readSettingsExtensions(paths.project, PROJECT_SETTINGS_MAX_BYTES) : undefined;
  const switches = await resolveBuiltinSwitches({ agentDir, cwd, projectTrusted }, { global, project }, paths);
  if (project === undefined) return switches;
  const globalSwitches = await resolveBuiltinSwitches({ agentDir, cwd, projectTrusted: false }, { global }, paths);
  for (const name of BUILTIN_EXTENSION_NAMES) switches[name].global = globalSwitches[name];
  return switches;
}

// ---------------------------------------------------------------------------
// The list
// ---------------------------------------------------------------------------

/**
 * Registers nothing. A built-in that cannot run keeps its `builtin:<name>`
 * entry, so a setting that names it neither errors nor changes meaning.
 */
const unavailableExtension: ExtensionFactory = () => {};

function builtin(name: string, factory: ExtensionFactory): InlineExtension {
  return { name, factory, replaceable: true, builtin: true };
}

export interface PiWebBuiltinCapability {
  codeMode: boolean;
  loadMcp: boolean;
  mcpServers: import("./subagents").SubagentMcpServerRef[];
  cwd: string;
  /** Read real scoped source settings, before restricted resource clearing. */
  builtinEnabled(name: BuiltinExtensionName): Promise<boolean>;
  /** Presentation/discovery only; execution still passes the separate tool_call guard. */
  allowedTools?(tools: ReturnType<ExtensionAPI["getAllTools"]>): Set<string>;
}

export async function scopedBuiltinExtensionSwitches(source: SettingsManager, cwd: string, agentDir: string) {
  return resolveBuiltinSwitches({ cwd, agentDir, projectTrusted: source.isProjectTrusted() }, {
    global: source.getGlobalSettings().extensions,
    project: source.getProjectSettings().extensions,
  }, { global: join(agentDir, "settings.json"), project: join(cwd, CONFIG_DIR_NAME, "settings.json") });
}

export interface PiWebBuiltinExtensionsOptions {
  agentDir: string;
  capability?: PiWebBuiltinCapability;
  /** Timing overrides for tests. */
  mcpHost?: Pick<McpHostOptions, "idleMs" | "promptWaitMs">;
}

export interface PiWebBuiltinExtensions {
  /** For the resource loader's `extensionFactories`, in the CLI's order, then the MCP host. */
  extensions: InlineExtension[];
  /** Decides which MCP servers the session connects; undefined while MCP is off. */
  mcpHost: McpHost | undefined;
}

/** The built-in extensions of a normal session and the host that feeds the MCP one. */
export async function createPiWebBuiltinExtensions(
  options: PiWebBuiltinExtensionsOptions,
): Promise<PiWebBuiltinExtensions> {
  const cap = options.capability ? { ...options.capability, mcpServers: structuredClone(options.capability.mcpServers) } : undefined;
  const codeEnabled = !cap || (cap.codeMode && await cap.builtinEnabled("codemode"));
  const mcpEnabled = !cap || cap.loadMcp;
  const [sandbox, mcp] = await Promise.all([
    codeEnabled ? checkCodemodeSandbox() : Promise.resolve<BuiltinFeatureStatus>({ available: false, reason: "Role Code mode is off" }),
    mcpEnabled ? loadMcpRuntime() : Promise.resolve<McpRuntimeResult>({ available: false, reason: "Role MCP is off" }),
  ]);
  let codemodeAvailable = sandbox.available;
  const mcpHost = mcp.available
    ? new McpHost({
        ...options.mcpHost,
        agentDir: options.agentDir,
        internals: mcp.internals,
        codemodeAvailable: () => codemodeAvailable,
        ...(cap ? { selection: { cwd: cap.cwd, servers: structuredClone(cap.mcpServers) } } : {}),
      })
    : undefined;
  const extensions = [
    builtin("codemode", sandbox.available ? createCodemodeExtension(cap ? { models: false } : undefined) : unavailableExtension),
    builtin("tool-search", createToolSearchExtension()),
    builtin(
      "mcp",
      mcp.available && mcpHost
        ? (pi) => {
          const createTransport = mcpHost.wrapTransportFactory(createPiWebMcpTransportFactory(mcp.internals), Boolean(cap));
          const observeRegistry = cap ? mcpHost.registrationObserverForLoad() : undefined;
          // SDK consumes this roster synchronously when rebuilding its server/resource
          // catalog, before awaiting close/connect. A preceding extension handler may
          // delay that read after the registry changes; aggregates stay blocked then.
          const api: ExtensionAPI = observeRegistry ? { ...pi, getMcpServers: () => {
            const servers = pi.getMcpServers(); observeRegistry(servers); return servers;
          } } : pi;
          return createMcpExtension({
            loadConfig: createMcpExtensionConfigLoader(mcp.internals, options.agentDir),
            createTransport,
            // The host already waited, and Stop ends its wait. The extension's own wait for
            // servers with `direct` tools, at a session's first prompt, ignores Stop.
            startupWaitMs: 0,
            // `/mcp login` already shows the address in the chat; a browser
            // opened on the server host is one a remote user never sees.
            openUrl: () => {},
          })(api);
        }
        : unavailableExtension,
    ),
  ];
  if (cap) {
    for (const extension of extensions) {
      if (typeof extension === "function") continue;
      const name = extension.name as BuiltinExtensionName;
      const factory = extension.factory;
      extension.factory = async (pi) => {
        if (!(name === "codemode" ? cap.codeMode : cap.loadMcp) || !await cap.builtinEnabled(name)) return;
        let selectedFactory = factory;
        if (name === "codemode") {
          const currentSandbox = await checkCodemodeSandbox();
          codemodeAvailable = currentSandbox.available;
          selectedFactory = currentSandbox.available ? createCodemodeExtension({ models: false }) : unavailableExtension;
        }
        const allowed = () => cap.allowedTools?.(pi.getAllTools());
        const api: ExtensionAPI = cap.allowedTools ? {
          ...pi,
          getAllTools: () => { const names = allowed(); return pi.getAllTools().filter((tool) => names?.has(tool.name)); },
          registerTool: (definition) => pi.registerTool({
            ...definition,
            ...(definition.prepareLoadout ? { prepareLoadout: (loadout) => {
              const names = allowed();
              return definition.prepareLoadout!({ ...loadout, declared: loadout.declared.filter((tool) => names?.has(tool.name)), callable: loadout.callable.filter((tool) => names?.has(tool.name)) });
            } } : {}),
            execute: (id, params, signal, update, ctx) => {
              const names = allowed();
              // ExtensionToolContext has prototype methods (executeTool) and getters.
              // Preserve them; only narrow the public discovery view for this builtin.
              const context = new Proxy({} as typeof ctx, { get(_target, property) {
                if (property === "tools") return ctx.tools.filter((tool) => names?.has(tool.name));
                const value = Reflect.get(ctx, property, ctx);
                return typeof value === "function" ? value.bind(ctx) : value;
              } });
              return definition.execute(id, params, signal, update, context);
            },
          }),
        } : pi;
        await selectedFactory(api);
        if (name === "codemode" && codemodeAvailable) pi.on("session_start", () => {
          const tool = pi.getAllTools().find((tool) => tool.name === "codemode");
          if (tool?.sourceInfo.path === CODEMODE_EXTENSION_PATH && tool.sourceInfo.source === "builtin") pi.setActiveTools([...new Set([...pi.getActiveTools(), "codemode"])]);
        });
      };
    }
  }
  if (mcpHost) extensions.push(mcpHost.extension());
  return { extensions, mcpHost };
}

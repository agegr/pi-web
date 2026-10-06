import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import {
  createAgentSessionFromServices,
  getAgentDir,
  initTheme,
  SessionManager,
  SettingsManager,
  type ModelRuntime,
} from "@earendil-works/pi-coding-agent";
import type { AgentSessionLike } from "./pi-types";
import {
  subagentNotificationText,
  subagentToolDetails,
  type ResumeSubagentRequest,
  type StartSubagentRequest,
  type SubagentExecution,
  type SubagentExtensionRuntime,
} from "./subagent-extension";
import {
  readSubagentRun,
  resolveSubagentProfile,
  SUBAGENT_META_TYPE,
  SUBAGENT_STATUS_TYPE,
  SUBAGENT_RESULT_TYPE,
  type SubagentMetadata,
  type SubagentResultMetadata,
  type SubagentRunInfo,
} from "./subagents";
import type { SessionEntry } from "./types";
import { buildSubagentPromptPlan } from "./subagent-prompt";
import { createExactSystemPromptExtension } from "./exact-system-prompt";
import { appendSubagentInputFiles, loadSubagentInputFiles } from "./subagent-input";
import { getProjectTrustStatus, projectTrustReloadOptions } from "./project-trust";
import { createSubagentSessionServices } from "./subagent-resources";
import { subagentToolExclusions, subagentToolPolicy } from "./subagent-tool-policy";
import { resolveShellTools } from "./powershell-settings";
import { isBuiltInSubagentsEnabled, readSubagentSettings } from "./subagent-settings";
import { SubagentQueue } from "./subagent-queue";
import { addWorktree, removeWorktree } from "./worktree";
import { randomUUID } from "node:crypto";

interface HostSession {
  readonly inner: AgentSessionLike;
  readonly sessionFile: string;
  readonly cwd: string;
  isAlive(): boolean;
  isRunning(): boolean;
  waitUntilReady(): Promise<void>;
  promptDelegated?(message: string, signal?: AbortSignal): Promise<void>;
  abortDelegated?(): Promise<void>;
}

export interface SubagentRuntimeDependencies {
  getSession(sessionId: string): HostSession | undefined;
  registerSession(
    inner: AgentSessionLike,
    options?: { exactSystemPrompt?: string; chatOnly?: boolean },
  ): void | Promise<void>;
  reopenSession(sessionId: string, sessionFile: string): Promise<HostSession>;
  resolveSessionPath(sessionId: string): Promise<string | null>;
  invalidateSessionList(): void;
  isBuiltInSubagentsEnabled?(): boolean;
}

export interface SubagentController {
  readonly extensionRuntime: SubagentExtensionRuntime;
  get(sessionId: string): Promise<SubagentRunInfo | null>;
  steer(sessionId: string, message: string): Promise<void>;
  abort(sessionId: string): Promise<void>;
}

type StoredSubagentExecution = {
  run: SubagentRunInfo;
  completion: Promise<SubagentRunInfo>;
  abortRequested: boolean;
  cancelQueued?: () => boolean;
  promptController?: AbortController;
};

async function promptDelegated(wrapper: HostSession | undefined, inner: AgentSessionLike, message: string, stored: StoredSubagentExecution): Promise<void> {
  throwIfSubagentCancelled(stored);
  if (wrapper?.promptDelegated) return wrapper.promptDelegated(message, (stored.promptController ??= new AbortController()).signal);
  await inner.prompt(message, { source: "rpc" });
}

function abortDelegated(wrapper: HostSession | undefined, inner: AgentSessionLike, stored?: StoredSubagentExecution): Promise<void> {
  stored?.promptController?.abort();
  return wrapper?.abortDelegated ? wrapper.abortDelegated() : inner.abort();
}

/** Check admission after every readiness await; aborting an idle SDK session alone cannot stop a later prompt. */
function throwIfSubagentCancelled(stored: StoredSubagentExecution, signal?: AbortSignal): void {
  if (signal?.aborted) stored.abortRequested = true;
  if (stored.abortRequested) throw new Error("Subagent cancelled before prompting");
}

declare global {
  var __piSubagentRuns: Map<string, StoredSubagentExecution> | undefined;
  var __piSubagentQueue: SubagentQueue<SubagentRunInfo> | undefined;
  var __piSubagentConsumedResults: Map<string, string> | undefined;
}
const SUBAGENT_CONTEXT_LIMIT = 50_000;
const PARENT_IDLE_POLL_MS = 200;
const THINKING_LEVELS = new Set<ThinkingLevel>(["off", "minimal", "low", "medium", "high", "xhigh", "max"]);

/** pi's agent loop records provider failures as an assistant message with `stopReason: "error"` and resolves `prompt()` normally; surface that as a failed run. */
function lastAssistantError(sessionManager: { getEntries?: () => unknown }): string | undefined {
  const entries = sessionManager.getEntries?.();
  if (!Array.isArray(entries)) return undefined;
  for (let i = entries.length - 1; i >= 0; i -= 1) {
    const entry = entries[i] as { type?: unknown; message?: { role?: unknown; stopReason?: unknown; errorMessage?: unknown } };
    if (entry?.type !== "message" || entry.message?.role !== "assistant") continue;
    if (entry.message.stopReason !== "error") return undefined;
    return typeof entry.message.errorMessage === "string" && entry.message.errorMessage ? entry.message.errorMessage : "Provider returned an error";
  }
  return undefined;
}

function getSubagentRuns(): Map<string, StoredSubagentExecution> {
  if (!globalThis.__piSubagentRuns) globalThis.__piSubagentRuns = new Map();
  return globalThis.__piSubagentRuns;
}

function getSubagentQueue(): SubagentQueue<SubagentRunInfo> {
  if (!globalThis.__piSubagentQueue) globalThis.__piSubagentQueue = new SubagentQueue();
  return globalThis.__piSubagentQueue;
}

type SubagentRunIdentity = Pick<SubagentRunInfo, "sessionId" | "completedAt">;

/**
 * Background runs whose terminal result the parent already collected with `get_subagent_result`,
 * keyed by subagent session ID and holding the collected run's `completedAt`. `resume` reruns
 * the same session ID, so the mark must name the run: a parent that polls *after* a run's
 * notification was delivered leaves a mark nothing consumes, and a bare session ID would let it
 * swallow the next run's notification (#987). `resume` deliberately does not clear the entry:
 * the parent can collect a run and resume it in the same turn while that run's notification is
 * still held, and the mark must keep suppressing it. Only background runs are recorded — a
 * foreground run never notifies — and each session holds at most one entry.
 */
function getConsumedSubagentResults(): Map<string, string> {
  // A hot reload can leave the pre-#987 Set on globalThis; replace it rather than call Map methods on it.
  if (!(globalThis.__piSubagentConsumedResults instanceof Map)) globalThis.__piSubagentConsumedResults = new Map();
  return globalThis.__piSubagentConsumedResults;
}

function markResultConsumed(run: SubagentRunIdentity): void {
  // A terminal run without `completedAt` (interrupted) never notifies, so there is nothing to drop.
  if (!run.completedAt) return;
  getConsumedSubagentResults().set(run.sessionId, run.completedAt);
}

/** Take the mark only when it names this very run; a mark left by an earlier run is ignored. */
function takeResultConsumed(run: SubagentRunIdentity): boolean {
  const consumed = getConsumedSubagentResults();
  if (!run.completedAt || consumed.get(run.sessionId) !== run.completedAt) return false;
  consumed.delete(run.sessionId);
  return true;
}

/**
 * A run lives in `getSubagentRuns()` from dispatch until its result entry is written, so a
 * persisted `running` / `queued` status reaching `get()` without that entry (and without a running
 * wrapper) was left by a process that stopped mid-run and will never be finished. Report it as
 * `interrupted` so `get_subagent_result({ wait: true })` returns instead of polling forever, and
 * `resume` can pick the session up again.
 */
function settleOrphanedRun(run: SubagentRunInfo): SubagentRunInfo {
  return run.status === "running" || run.status === "queued" ? { ...run, status: "interrupted" } : run;
}

function parseSubagentModel(runtime: ModelRuntime, value: string | undefined) {
  if (!value?.trim()) return undefined;
  const requested = value.trim();
  const slash = requested.indexOf("/");
  if (slash > 0) {
    const provider = requested.slice(0, slash);
    const modelId = requested.slice(slash + 1);
    const model = runtime.getModel(provider, modelId);
    if (!model) throw new Error(`Subagent model not found: ${requested}`);
    return model;
  }
  const matches = runtime.getModels().filter((model) => model.id === requested);
  if (matches.length === 1) return matches[0];
  if (matches.length === 0) throw new Error(`Subagent model not found: ${requested}`);
  throw new Error(`Subagent model is ambiguous; use provider/modelId: ${requested}`);
}

function parentContextText(parent: HostSession): string {
  const messages = parent.inner.sessionManager.buildSessionContext().messages;
  const serialized = JSON.stringify(messages);
  if (serialized.length <= SUBAGENT_CONTEXT_LIMIT) return serialized;
  return `${serialized.slice(0, SUBAGENT_CONTEXT_LIMIT)}\n[Parent context truncated]`;
}

async function cleanupWorktree(
  parentCwd: string,
  worktree: { path: string; branch: string } | undefined,
): Promise<string | undefined> {
  if (!worktree) return undefined;
  try {
    await removeWorktree(parentCwd, worktree.path);
    return undefined;
  } catch (error) {
    return `Worktree retained at ${worktree.path}: ${error instanceof Error ? error.message : String(error)}`;
  }
}

export function createSubagentController(
  dependencies: SubagentRuntimeDependencies,
): SubagentController {
  async function start(request: StartSubagentRequest): Promise<SubagentExecution> {
    const enabled = dependencies.isBuiltInSubagentsEnabled ?? isBuiltInSubagentsEnabled;
    if (!enabled()) throw new Error("Pi Web built-in sub-agents are disabled");
    const parentSessionId = request.parentContext.sessionManager.getSessionId();
    const parent = dependencies.getSession(parentSessionId);
    if (!parent?.isAlive()) throw new Error("Parent session is no longer available");
    if (!parent.sessionFile) throw new Error("Parent session must be persisted before starting a subagent");

    let isolatedWorktree: { path: string; branch: string } | undefined;
    try {
      const profile = resolveSubagentProfile(parent.cwd, request.profile);
      if (!profile) throw new Error(`Unknown or disabled subagent profile: ${request.profile}`);

      const runInBackground = request.runInBackground ?? profile.runInBackground;
      const isolation = profile.isolation === "off" ? undefined : request.isolation ?? profile.isolation;
      if (isolation === "worktree") {
        isolatedWorktree = await addWorktree(parent.cwd, `pi-web-agent-${randomUUID()}`);
      }
      const childCwd = isolatedWorktree?.path ?? parent.cwd;
      const inheritContext = request.inheritContext ?? profile.inheritContext;
      const maxTurns = request.maxTurns ?? profile.maxTurns;
      if (maxTurns !== undefined && (!Number.isFinite(maxTurns) || maxTurns < 0)) {
        throw new Error("max_turns must be a non-negative number");
      }
      const turnLimit = maxTurns && maxTurns > 0 ? Math.floor(maxTurns) : undefined;
      const thinking = request.thinking ?? profile.thinking ?? parent.inner.agent.state?.thinkingLevel;
      if (thinking && !THINKING_LEVELS.has(thinking as ThinkingLevel)) {
        throw new Error(`Invalid subagent thinking level: ${thinking}`);
      }

      const agentDir = getAgentDir();
      const parentModelRuntime = (parent.inner as unknown as { modelRuntime: ModelRuntime }).modelRuntime;
      const settingsManager = SettingsManager.create(childCwd, agentDir, { projectTrusted: getProjectTrustStatus(childCwd, agentDir).trusted });
      const inheritedParentContext = inheritContext
        ? `The following is the active conversation context from the parent session. Use it only as background for the delegated task:\n${parentContextText(parent)}`
        : undefined;
      const inputFiles = loadSubagentInputFiles(parent.cwd, request.inputFiles ?? []);
      const promptPlan = buildSubagentPromptPlan({
        profileSystemPrompt: profile.systemPrompt,
        tools: profile.tools,
        loadSkills: profile.loadSkills,
        loadExtensions: profile.loadExtensions,
        promptMode: profile.promptMode,
        task: appendSubagentInputFiles(request.task, inputFiles),
        inheritedParentContext,
      });
      const { chatOnly, appendSystemPrompt, delegatedTask } = promptPlan;
      if (!chatOnly) initTheme();
      const builtinTools = resolveShellTools(profile.tools, settingsManager.getDefaultTools());
      const toolPolicy = subagentToolPolicy(profile);
      const services = await createSubagentSessionServices({
        cwd: childCwd,
        agentDir,
        modelRuntime: parentModelRuntime,
        settingsManager,
        resourceLoaderOptions: {
          noExtensions: !profile.loadExtensions,
          noSkills: !profile.loadSkills,
          noPromptTemplates: true,
          noThemes: true,
          noContextFiles: true,
          ...(chatOnly || promptPlan.exactSystemPrompt !== undefined
            ? {
                systemPrompt: " ",
                systemPromptOverride: () => undefined,
              }
            : {}),
          appendSystemPrompt,
          // The exact prompt is sent through before_agent_start; see lib/exact-system-prompt.ts.
          ...(promptPlan.exactSystemPrompt !== undefined
            ? { extensionFactories: [createExactSystemPromptExtension(() => promptPlan.exactSystemPrompt)] }
            : {}),
        },
        ...((profile.loadExtensions || profile.loadSkills)
          ? { resourceLoaderReloadOptions: projectTrustReloadOptions(childCwd, agentDir) }
          : {}),
      }, { ...profile, builtinTools, toolPolicy });

      const sessionManager = isolatedWorktree
        ? SessionManager.create(childCwd, undefined, { parentSession: parent.sessionFile })
        : SessionManager.create(parent.cwd, undefined, { parentSession: parent.sessionFile });
      const createdAt = new Date().toISOString();
      const metadata: SubagentMetadata = {
        version: 1,
        parentSessionId,
        parentSessionPath: parent.sessionFile,
        parentToolCallId: request.parentToolCallId,
        profile: profile.name,
        description: request.description.trim() || profile.displayName,
        task: request.task,
        runInBackground,
        createdAt,
        resourceSnapshot: {
          version: 2,
          appendSystemPrompt: [...appendSystemPrompt],
          builtinTools: [...builtinTools],
          toolPolicy,
          loadSkills: profile.loadSkills,
          loadExtensions: profile.loadExtensions,
          skills: profile.skills ?? profile.loadSkills,
          extensions: profile.extensions ?? profile.loadExtensions,
          ...(promptPlan.exactSystemPrompt !== undefined ? { exactSystemPrompt: promptPlan.exactSystemPrompt } : {}),
        },
        ...(isolatedWorktree ? { worktreePath: isolatedWorktree.path, worktreeBranch: isolatedWorktree.branch } : {}),
      };
      sessionManager.appendCustomEntry(SUBAGENT_META_TYPE, metadata);
      sessionManager.appendSessionInfo(metadata.description);

      const requestedModel = parseSubagentModel(parentModelRuntime, request.model ?? profile.model);
      const parentModel = parent.inner.model as ReturnType<ModelRuntime["getModel"]>;
      const { session: inner } = await createAgentSessionFromServices({
        services,
        sessionManager,
        model: requestedModel ?? parentModel,
        ...(thinking ? { thinkingLevel: thinking as ThinkingLevel } : {}),
        noTools: "builtin",
        excludeTools: subagentToolExclusions(builtinTools),
      });
      // Public loadout API, not tools' immutable hard allowlist. Preserve extension
      // exposure/defaultActive; never force hidden/codemode/deferred tools active.
      inner.setActiveToolsByName([...new Set([...builtinTools, ...inner.getActiveToolNames()])]);
      // Handle rejection at registration, even if this run remains queued or is cancelled.
      // Keep the error as data until execution so a failed bind never admits a prompt.
      const ready = Promise.resolve(dependencies.registerSession(inner, {
        ...(promptPlan.exactSystemPrompt !== undefined
          ? { exactSystemPrompt: promptPlan.exactSystemPrompt }
          : {}),
        chatOnly,
      })).then(
        () => ({ ok: true as const }),
        (error: unknown) => ({ ok: false as const, error }),
      );

      const initialRun: SubagentRunInfo = {
        sessionId: inner.sessionId,
        sessionPath: inner.sessionFile ?? sessionManager.getSessionFile() ?? "",
        parentSessionId,
        parentToolCallId: request.parentToolCallId,
        profile: profile.name,
        description: metadata.description,
        task: request.task,
        runInBackground,
        status: "queued",
        createdAt,
        ...(isolatedWorktree ? { worktreePath: isolatedWorktree.path, worktreeBranch: isolatedWorktree.branch } : {}),
      };

      let turnCount = 0;
      let maxTurnsReached = false;
      let softLimitReached = false;
      const unsubscribeTurns = turnLimit
        ? inner.subscribe((event) => {
            if (event.type !== "turn_end") return;
            turnCount += 1;
            if (!softLimitReached && turnCount >= turnLimit) {
              softLimitReached = true;
              void inner.steer("You have reached your turn limit. Wrap up immediately and provide your final answer now.");
            } else if (softLimitReached && turnCount >= turnLimit + 1) {
              maxTurnsReached = true;
              void inner.abort();
            }
          })
        : () => {};
      let resolveCompletion!: (run: SubagentRunInfo) => void;
      const completion = new Promise<SubagentRunInfo>((resolve) => { resolveCompletion = resolve; });
      const stored: StoredSubagentExecution = {
        run: initialRun,
        completion,
        abortRequested: !runInBackground && request.signal?.aborted === true,
      };
      getSubagentRuns().set(initialRun.sessionId, stored);
      request.onUpdate?.(initialRun);
      dependencies.invalidateSessionList();

      const handleParentAbort = () => {
        stored.abortRequested = true;
        if (stored.run.status === "queued") stored.cancelQueued?.();
        else void abortDelegated(dependencies.getSession(inner.sessionId), inner, stored);
      };
      if (!runInBackground) request.signal?.addEventListener("abort", handleParentAbort, { once: true });

      const execute = async (): Promise<SubagentRunInfo> => {
        stored.run = { ...stored.run, status: "running" };
        sessionManager.appendCustomEntry(SUBAGENT_STATUS_TYPE, { version: 1, status: "running" });
        request.onUpdate?.(stored.run);
        dependencies.invalidateSessionList();
        let result: SubagentRunInfo;
        try {
          throwIfSubagentCancelled(stored, runInBackground ? undefined : request.signal);
          const registration = await ready;
          throwIfSubagentCancelled(stored, runInBackground ? undefined : request.signal);
          if (!registration.ok) throw registration.error;
          await dependencies.getSession(inner.sessionId)?.waitUntilReady?.();
          throwIfSubagentCancelled(stored, runInBackground ? undefined : request.signal);
          await promptDelegated(dependencies.getSession(inner.sessionId), inner, delegatedTask, stored);
          const text = inner.getLastAssistantText()?.trim();
          const aborted = stored.abortRequested && !maxTurnsReached;
          const providerError = aborted ? undefined : lastAssistantError(sessionManager);
          result = {
            ...initialRun,
            status: aborted ? "aborted" : providerError ? "failed" : "completed",
            completedAt: new Date().toISOString(),
            ...(text ? { result: text } : {}),
            ...(providerError ? { error: providerError } : {}),
          };
        } catch (error) {
          const text = inner.getLastAssistantText()?.trim();
          const aborted = stored.abortRequested || request.signal?.aborted;
          result = {
            ...initialRun,
            status: aborted ? "aborted" : maxTurnsReached ? "completed" : "failed",
            completedAt: new Date().toISOString(),
            ...(text ? { result: text } : {}),
            ...(!aborted && !maxTurnsReached
              ? { error: error instanceof Error ? error.message : String(error) }
              : {}),
          };
        } finally {
          unsubscribeTurns();
          request.signal?.removeEventListener("abort", handleParentAbort);
        }

        const cleanupError = await cleanupWorktree(parent.cwd, isolatedWorktree);
        if (cleanupError) result = { ...result, worktreeCleanupError: cleanupError };
        const persisted: SubagentResultMetadata = {
          version: 1,
          status: result.status as SubagentResultMetadata["status"],
          completedAt: result.completedAt!,
          ...(result.result ? { result: result.result } : {}),
          ...(result.error ? { error: result.error } : {}),
          ...(result.worktreeCleanupError ? { worktreeCleanupError: result.worktreeCleanupError } : {}),
        };
        sessionManager.appendCustomEntry(SUBAGENT_RESULT_TYPE, persisted);
        stored.run = result;
        request.onUpdate?.(result);
        getSubagentRuns().delete(initialRun.sessionId);
        dependencies.invalidateSessionList();
        return result;
      };

      const finishQueuedAbort = async () => {
        if (stored.run.status !== "queued") return;
        unsubscribeTurns();
        request.signal?.removeEventListener("abort", handleParentAbort);
        const result: SubagentRunInfo = { ...initialRun, status: "aborted", completedAt: new Date().toISOString() };
        const cleanupError = await cleanupWorktree(parent.cwd, isolatedWorktree);
        const finalResult = cleanupError ? { ...result, worktreeCleanupError: cleanupError } : result;
        sessionManager.appendCustomEntry(SUBAGENT_RESULT_TYPE, { version: 1, status: "aborted", completedAt: finalResult.completedAt, ...(cleanupError ? { worktreeCleanupError: cleanupError } : {}) });
        stored.run = finalResult;
        request.onUpdate?.(finalResult);
        getSubagentRuns().delete(initialRun.sessionId);
        dependencies.invalidateSessionList();
        resolveCompletion(finalResult);
      };
      const queued = getSubagentQueue().enqueue(
        parentSessionId,
        readSubagentSettings().maxConcurrent,
        execute,
        (state) => {
          if (state === "queued") {
            sessionManager.appendCustomEntry(SUBAGENT_STATUS_TYPE, { version: 1, status: "queued" });
          }
          request.onUpdate?.({ ...stored.run, status: state });
          stored.run = { ...stored.run, status: state };
          dependencies.invalidateSessionList();
        },
        finishQueuedAbort,
      );
      stored.cancelQueued = queued.cancel;
      // Synchronous update callbacks may abort before the listener/cancel hook exists.
      if (!runInBackground && request.signal?.aborted) stored.abortRequested = true;
      if (stored.abortRequested) stored.cancelQueued();
      void queued.promise.then(resolveCompletion, (error) => {
        resolveCompletion({ ...initialRun, status: "failed", completedAt: new Date().toISOString(), error: error instanceof Error ? error.message : String(error) });
      });

      return { run: stored.run, completion: stored.completion };
    } catch (error) {
      if (isolatedWorktree) {
        try { await removeWorktree(parent.cwd, isolatedWorktree.path); } catch { /* preserve setup failure and avoid force deletion */ }
      }
      throw error;
    }
  }

  async function resume(request: ResumeSubagentRequest): Promise<SubagentExecution> {
    const enabled = dependencies.isBuiltInSubagentsEnabled ?? isBuiltInSubagentsEnabled;
    if (!enabled()) throw new Error("Pi Web built-in sub-agents are disabled");
    const parentSessionId = request.parentContext.sessionManager.getSessionId();
    const existing = await get(request.sessionId);
    if (!existing) throw new Error(`Subagent not found: ${request.sessionId}`);
    if (existing.parentSessionId !== parentSessionId) throw new Error("Subagent does not belong to this parent session");
    if (existing.status === "running" || existing.status === "queued") throw new Error("Subagent is already running");
    const parent = dependencies.getSession(parentSessionId);
    if (!parent?.isAlive()) throw new Error("Parent session is no longer available");
    const sessionPath = existing.sessionPath || await dependencies.resolveSessionPath(request.sessionId);
    if (!sessionPath) throw new Error(`Subagent session file not found: ${request.sessionId}`);
    let wrapper = dependencies.getSession(request.sessionId);
    if (!wrapper?.isAlive()) wrapper = await dependencies.reopenSession(request.sessionId, sessionPath);
    if (!wrapper.isAlive()) throw new Error("Subagent session is no longer available");
    if (wrapper.isRunning()) throw new Error("Subagent is already running");

    const runInBackground = request.runInBackground ?? existing.runInBackground;
    const initialRun: SubagentRunInfo = {
      ...existing,
      parentToolCallId: request.parentToolCallId,
      task: request.task,
      description: request.description.trim() || existing.description,
      runInBackground,
      status: "queued",
      completedAt: undefined,
      result: undefined,
      error: undefined,
      resumed: true,
    };
    const manager = wrapper.inner.sessionManager;
    let resolveCompletion!: (run: SubagentRunInfo) => void;
    const completion = new Promise<SubagentRunInfo>((resolve) => { resolveCompletion = resolve; });
    const stored: StoredSubagentExecution = { run: initialRun, completion, abortRequested: !runInBackground && request.signal?.aborted === true };
    getSubagentRuns().set(request.sessionId, stored);
    request.onUpdate?.(initialRun);
    dependencies.invalidateSessionList();
    const handleParentAbort = () => {
      stored.abortRequested = true;
      if (stored.run.status === "queued") stored.cancelQueued?.();
      else void abortDelegated(wrapper, wrapper!.inner, stored);
    };
    if (!runInBackground) request.signal?.addEventListener("abort", handleParentAbort, { once: true });

    const execute = async (): Promise<SubagentRunInfo> => {
      stored.run = { ...stored.run, status: "running" };
      manager.appendCustomEntry(SUBAGENT_STATUS_TYPE, { version: 1, status: "running" });
      request.onUpdate?.(stored.run);
      let result: SubagentRunInfo;
      try {
        throwIfSubagentCancelled(stored, runInBackground ? undefined : request.signal);
        await wrapper!.waitUntilReady();
        throwIfSubagentCancelled(stored, runInBackground ? undefined : request.signal);
        await promptDelegated(wrapper, wrapper!.inner, request.task, stored);
        const text = wrapper!.inner.getLastAssistantText()?.trim();
        const providerError = stored.abortRequested ? undefined : lastAssistantError(manager);
        result = {
          ...initialRun,
          status: stored.abortRequested ? "aborted" : providerError ? "failed" : "completed",
          completedAt: new Date().toISOString(),
          ...(text ? { result: text } : {}),
          ...(providerError ? { error: providerError } : {}),
        };
      } catch (error) {
        result = {
          ...initialRun,
          status: stored.abortRequested || request.signal?.aborted ? "aborted" : "failed",
          completedAt: new Date().toISOString(),
          ...(!stored.abortRequested && !request.signal?.aborted ? { error: error instanceof Error ? error.message : String(error) } : {}),
        };
      } finally {
        request.signal?.removeEventListener("abort", handleParentAbort);
      }
      manager.appendCustomEntry(SUBAGENT_RESULT_TYPE, {
        version: 1,
        status: result.status as "completed" | "failed" | "aborted",
        completedAt: result.completedAt!,
        ...(result.result ? { result: result.result } : {}),
        ...(result.error ? { error: result.error } : {}),
      });
      stored.run = result;
      request.onUpdate?.(result);
      getSubagentRuns().delete(request.sessionId);
      dependencies.invalidateSessionList();
      return result;
    };
    const finishQueuedAbort = () => {
      if (stored.run.status !== "queued") return;
      request.signal?.removeEventListener("abort", handleParentAbort);
      const result: SubagentRunInfo = { ...initialRun, status: "aborted", completedAt: new Date().toISOString() };
      manager.appendCustomEntry(SUBAGENT_RESULT_TYPE, { version: 1, status: "aborted", completedAt: result.completedAt });
      stored.run = result;
      request.onUpdate?.(result);
      getSubagentRuns().delete(request.sessionId);
      dependencies.invalidateSessionList();
      resolveCompletion(result);
    };
    const queued = getSubagentQueue().enqueue(parentSessionId, readSubagentSettings().maxConcurrent, execute, (state) => {
      if (state === "queued") manager.appendCustomEntry(SUBAGENT_STATUS_TYPE, { version: 1, status: "queued" });
      stored.run = { ...stored.run, status: state };
      request.onUpdate?.(stored.run);
      dependencies.invalidateSessionList();
    }, finishQueuedAbort);
    stored.cancelQueued = queued.cancel;
    // Synchronous update callbacks may abort before the listener/cancel hook exists.
    if (!runInBackground && request.signal?.aborted) stored.abortRequested = true;
    if (stored.abortRequested) stored.cancelQueued();
    void queued.promise.then(resolveCompletion, (error) => resolveCompletion({ ...initialRun, status: "failed", completedAt: new Date().toISOString(), error: error instanceof Error ? error.message : String(error) }));
    return { run: stored.run, completion };
  }

  async function get(sessionId: string): Promise<SubagentRunInfo | null> {
    const stored = getSubagentRuns().get(sessionId);
    if (stored) return stored.run;
    const wrapper = dependencies.getSession(sessionId);
    if (wrapper?.isAlive()) {
      const run = readSubagentRun(
        wrapper.inner.sessionManager.getEntries() as unknown as SessionEntry[],
        sessionId,
        wrapper.sessionFile,
      );
      if (run && wrapper.isRunning()) return { ...run, status: "running" };
      if (run) return settleOrphanedRun(run);
    }
    const sessionPath = await dependencies.resolveSessionPath(sessionId);
    if (!sessionPath) return null;
    const manager = SessionManager.open(sessionPath);
    const run = readSubagentRun(manager.getEntries() as unknown as SessionEntry[], sessionId, sessionPath);
    return run && settleOrphanedRun(run);
  }

  async function steer(sessionId: string, message: string): Promise<void> {
    const wrapper = dependencies.getSession(sessionId);
    if (!wrapper?.isAlive() || !wrapper.isRunning()) throw new Error("Subagent is not running");
    if (!message.trim()) throw new Error("Steering message is required");
    await wrapper.inner.steer(message.trim());
  }

  async function notifyParent(run: SubagentRunInfo): Promise<void> {
    if (takeResultConsumed(run)) return;
    let parent = dependencies.getSession(run.parentSessionId);
    if (!parent?.isAlive()) {
      const sessionFile = await dependencies.resolveSessionPath(run.parentSessionId);
      if (!sessionFile) throw new Error(`Parent session not found: ${run.parentSessionId}`);
      parent = await dependencies.reopenSession(run.parentSessionId, sessionFile);
    }
    await parent.waitUntilReady();
    // The parent may still be inside the `get_subagent_result` call that collects this result,
    // and `deliverAs: "followUp"` would only queue the message until that turn ends anyway.
    // Hold the notification until the parent is idle and re-check the mark, so a result the
    // parent already consumed never triggers a duplicate turn.
    while (parent.isAlive() && parent.isRunning()) {
      if (takeResultConsumed(run)) return;
      await new Promise<void>((resolve) => { setTimeout(resolve, PARENT_IDLE_POLL_MS); });
    }
    if (takeResultConsumed(run)) return;
    if (!parent.isAlive()) throw new Error(`Parent session is no longer available: ${run.parentSessionId}`);
    await parent.inner.sendCustomMessage({
      customType: "pi-web:subagent-notification",
      content: subagentNotificationText(run),
      display: true,
      details: subagentToolDetails(run),
    }, { deliverAs: "followUp", triggerTurn: true });
  }

  async function abort(sessionId: string): Promise<void> {
    const wrapper = dependencies.getSession(sessionId);
    const stored = getSubagentRuns().get(sessionId);
    if (stored?.run.status === "queued") {
      stored.abortRequested = true;
      if (!stored.cancelQueued?.()) throw new Error("Subagent is no longer queued");
      return;
    }
    // The controller owns a running slot while binding, before the SDK is streaming.
    if (!wrapper?.isAlive() || (!wrapper.isRunning() && stored?.run.status !== "running")) throw new Error("Subagent is not running");
    if (stored) stored.abortRequested = true;
    await abortDelegated(wrapper, wrapper.inner, stored);
  }

  return {
    extensionRuntime: { start, resume, get, steer, notifyParent, markResultConsumed },
    get,
    steer,
    abort,
  };
}

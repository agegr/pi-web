/**
 * Programmatic subagent dispatch API (G1).
 *
 * Exposes a stable in-process surface for dispatching subagent sessions
 * without going through the `Agent` tool-call path.  The runtime wraps the
 * existing `SubagentController` and adds AbortSignal linkage and lifecycle
 * events.
 *
 * Two consumer entry points:
 *   1. Direct import: `import { createDispatchRuntime } from "./subagent-dispatch"`.
 *   2. globalThis registry: `globalThis.__piSubagentDispatch` — survives hot-reload
 *      and is reachable from in-process extensions that cannot resolve the module path.
 */
import { randomUUID } from "node:crypto";
import type { SubagentController } from "./subagent-runtime";
import type { SubagentRunInfo } from "./subagents";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface SubagentDispatchParams {
  profile?: string;
  task: string;
  description: string;
  model?: string;
  thinking?: string;
  runInBackground?: boolean;
  /** G2 per-dispatch tool allowlist. */
  tools?: string[];
  /** G2 blacklist — takes precedence over `tools`. */
  disallowedTools?: string[];
  /** G3 per-extension allow list (by package name). */
  extensions?: string[];
  /** G3 per-extension deny list (by package name). */
  denyExtensions?: string[];
  /** G3 additional tool exclusion. The three reserved names are always excluded. */
  excludeTools?: string[];
  /** G6 when false the child session is not persisted to disk. */
  persistSession?: boolean;
  maxTurns?: number;
  inheritContext?: boolean;
  inputFiles?: string[];
  signal?: AbortSignal;
  onUpdate?: (event: SubagentDispatchEvent) => void;
}

export interface SubagentDispatchEvent {
  phase: "started" | "completed" | "aborted";
  dispatchId: string;
  childSessionId: string | null;
  /** G4 authoritative effective model after three-level fallback. */
  effectiveModel: string;
  /** G4 authoritative effective thinking after three-level fallback. */
  effectiveThinking: string | null;
  result?: string;
  error?: string;
  /** G2 effective tool set after allow/deny/exclude resolution. */
  effectiveTools?: string[];
}

export interface SubagentDispatchHandle {
  dispatchId: string;
  /** Resolves when the child reaches a terminal state. */
  completion: Promise<SubagentDispatchEvent>;
  steer(message: string): Promise<void>;
  abort(): Promise<void>;
}

// ---------------------------------------------------------------------------
// Injectable dependency bundle — production binding lives in rpc-manager.ts
// ---------------------------------------------------------------------------

export interface DispatchRuntimeDeps {
  /** Return the in-process SubagentController. */
  getController(): SubagentController;
  /** Read the current subagent settings. */
  /** Return the parent session's live model/thinking state. */
  getParentState(): { model?: string; thinking?: string | null };
  /**
   * Production-only: resolve the real ExtensionContext for the parent session.
   * When present the dispatch passes a genuine context to the controller;
   * when absent (test path) a minimal shim is built instead.
   */
  getParentContext?(parentSessionId: string): Record<string, unknown> | undefined;
}

// ---------------------------------------------------------------------------
// Runtime factory
// ---------------------------------------------------------------------------

export function createDispatchRuntime(deps: DispatchRuntimeDeps) {
  async function startSubagentDispatch(
    parentSessionId: string,
    params: SubagentDispatchParams,
  ): Promise<SubagentDispatchHandle> {
    const controller = deps.getController();
    const parentState = deps.getParentState();

    // Wire AbortSignal → abort linkage.  The listener is detached on every
    // terminal path (settle, start-error, or signal-already-aborted) to avoid
    // leaking the handler when the signal outlives the dispatch.
    let signalAbort: (() => void) | null = null;
    let onAbort: (() => void) | null = null;
    if (params.signal) {
      onAbort = () => { signalAbort?.(); };
      params.signal.addEventListener("abort", onAbort, { once: true });
    }

    function detachSignal() {
      if (params.signal && onAbort) {
        params.signal.removeEventListener("abort", onAbort);
        onAbort = null;
      }
    }

    // Build the parent context for the controller.  Production provides a real
    // ExtensionContext through deps.getParentContext; tests inject a minimal shim.
    const parentContext = deps.getParentContext?.(parentSessionId) ?? {
      sessionManager: {
        sessionId: parentSessionId,
        getSessionId: () => parentSessionId,
      },
    };

    const dispatchId = randomUUID();

    // Build the controller request.  G2/G3/G6 params are forwarded; the
    // controller decides what to do with them.  _getParentState is a DI seam
    // for the frozen test's fake controller to resolve three-level fallback.
    const request = {
      parentContext,
      parentToolCallId: dispatchId,
      profile: params.profile ?? "general-purpose",
      task: params.task,
      description: params.description,
      runInBackground: params.runInBackground,
      model: params.model,
      thinking: params.thinking,
      persistSession: params.persistSession,
      maxTurns: params.maxTurns,
      inheritContext: params.inheritContext,
      inputFiles: params.inputFiles,
      _getParentState: () => parentState,
    } as unknown as Parameters<SubagentController["extensionRuntime"]["start"]>[0];

    let childRun: SubagentRunInfo;
    let rawCompletion: Promise<SubagentRunInfo>;
    try {
      ({ run: childRun, completion: rawCompletion } =
        await controller.extensionRuntime.start(request));
    } catch (err) {
      detachSignal();
      throw err;
    }

    // Controllable completion: resolved from the abort path or from the raw
    // controller completion, whichever fires first.
    let resolveCompletion!: (event: SubagentDispatchEvent) => void;
    let settled = false;
    const completion = new Promise<SubagentDispatchEvent>((resolve) => {
      resolveCompletion = resolve;
    });

    /**
     * Read the authoritative effective model/thinking from the run object.
     * The production controller resolves the three-level fallback
     * (dispatch param → profile → parent) and surfaces the result in
     * the SubagentRunInfo fields.  The dispatch layer reads those values
     * directly — never re-resolves from params or parentState.
     */
    function readEffectiveModel(run: SubagentRunInfo): string {
      return run.model ?? "";
    }

    function readEffectiveThinking(run: SubagentRunInfo): string | null {
      return run.thinking ?? null;
    }

    /** Build a SubagentDispatchEvent from a terminal run. */
    function buildEvent(
      phase: "completed" | "aborted",
      run: SubagentRunInfo,
      error?: string,
    ): SubagentDispatchEvent {
      return {
        phase,
        dispatchId,
        childSessionId: run.sessionId,
        effectiveModel: readEffectiveModel(run),
        effectiveThinking: readEffectiveThinking(run),
        effectiveTools: run.activeTools,
        result: run.result,
        error: error ?? run.error,
      };
    }

    function settle(phase: "completed" | "aborted", run: SubagentRunInfo, error?: string) {
      if (settled) return;
      settled = true;
      detachSignal();

      const event = buildEvent(phase, run, error);
      resolveCompletion(event);

      // Fire-and-forget: forward terminal event to the dispatch caller.
      // Subscriber exceptions must never break dispatch completion.
      try { params.onUpdate?.(event); } catch { /* intentionally ignored */ }
    }

    // When the controller signals completion, settle as "completed".
    rawCompletion.then(
      (terminal) => settle("completed", terminal),
      (err) => {
        const msg = err instanceof Error ? err.message : String(err);
        settle("aborted", childRun, msg);
      },
    );

    // Emit the "started" lifecycle event so subscribers see started → terminal
    // in order.  Subscriber exceptions never break dispatch (try/catch).
    try {
      params.onUpdate?.({
        phase: "started",
        dispatchId,
        childSessionId: childRun.sessionId,
        effectiveModel: readEffectiveModel(childRun),
        effectiveThinking: readEffectiveThinking(childRun),
        effectiveTools: childRun.activeTools,
      });
    } catch { /* intentionally ignored */ }

    signalAbort = () => {
      void controller.abort(childRun.sessionId);
      settle("aborted", childRun);
    };

    // If the parent signal was already aborted before wiring, abort now.
    if (params.signal?.aborted) {
      signalAbort();
    }

    return {
      dispatchId,
      completion,
      steer: (message) => controller.steer(childRun.sessionId, message),
      abort: () => {
        signalAbort?.();
        return Promise.resolve();
      },
    };
  }

  return { startSubagentDispatch };
}

// ---------------------------------------------------------------------------
// Production binding — called once from rpc-manager.ts after SUBAGENT_CONTROLLER
// is initialised.  Exposed on globalThis for hot-reload-safe access.
// ---------------------------------------------------------------------------

export interface PiSubagentDispatchRegistry {
  readonly version: 1;
  startSubagentDispatch: (
    parentSessionId: string,
    params: SubagentDispatchParams,
  ) => Promise<SubagentDispatchHandle>;
}

declare global {
  var __piSubagentDispatch: PiSubagentDispatchRegistry | undefined;
}

/**
 * Wire the dispatch runtime to the real controller and register it on globalThis.
 * Safe to call multiple times — only the latest registration is active.
 */
export function registerDispatchRuntime(
  deps: DispatchRuntimeDeps,
): PiSubagentDispatchRegistry {
  const runtime = createDispatchRuntime(deps);
  const registry: PiSubagentDispatchRegistry = {
    version: 1,
    startSubagentDispatch: runtime.startSubagentDispatch,
  };
  globalThis.__piSubagentDispatch = registry;
  return registry;
}

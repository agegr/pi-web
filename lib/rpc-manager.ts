import { createAgentSession, SessionManager } from "@earendil-works/pi-coding-agent";
import { cacheSessionPath } from "./session-reader";
import type { AgentSessionLike, ToolInfo } from "./pi-types";

// ============================================================================
// Loop Detection Constants
// ============================================================================

/** Thresholds for loop detection */
const LOOP_SOFT_WARNING_THRESHOLD = 3;   // First warning: inject hint for model to reflect
const LOOP_STRONG_WARNING_THRESHOLD = 5; // Second warning: stronger hint
const LOOP_HARD_STOP_THRESHOLD = 10;     // Hard stop: abort and notify user

/** Similarity threshold for thinking content (0-1) */
const THINKING_SIMILARITY_THRESHOLD = 0.85;

// ============================================================================
// Types
// ============================================================================

export interface AgentEvent {
  type: string;
  [key: string]: unknown;
}

type EventListener = (event: AgentEvent) => void;

// ============================================================================
// AgentSessionWrapper
// Wraps AgentSession with the same interface the rest of the app expects
// ============================================================================

export class AgentSessionWrapper {
  private listeners: EventListener[] = [];
  private unsubscribe: (() => void) | null = null;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private onDestroyCallback: (() => void) | null = null;
  private _alive = true;

  // Loop detection state
  private loopDetection = {
    recentThinkings: [] as string[],
    consecutiveSimilar: 0,
    lastWarningLevel: 0, // 0=none, 1=soft, 2=strong
    isDisabled: false,   // Temporarily disable after user intervention
  };

  constructor(public readonly inner: AgentSessionLike) {}

  get sessionId(): string {
    return this.inner.sessionId;
  }

  get sessionFile(): string {
    return this.inner.sessionFile ?? "";
  }

  isAlive(): boolean {
    return this._alive;
  }

  start(): void {
    this.unsubscribe = this.inner.subscribe((event: AgentEvent) => {
      this.resetIdleTimer();
      this.detectLoop(event);
      for (const l of this.listeners) l(event);
    });
    this.resetIdleTimer();
  }

  private resetIdleTimer(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => this.destroy(), 10 * 60 * 1000);
  }

  /**
   * Detect potential infinite loops by monitoring thinking content repetition.
   * Uses soft interrupts (hints) first, then hard stop if pattern continues.
   */
  private detectLoop(event: AgentEvent): void {
    // Only check assistant messages with thinking content
    if (event.type !== "message") return;
    const msg = event.message as Record<string, unknown> | undefined;
    if (!msg || msg.role !== "assistant") return;
    
    const content = msg.content as Array<Record<string, unknown>> | undefined;
    if (!Array.isArray(content)) return;
    
    // Extract thinking content
    const thinkingBlock = content.find((c) => c.type === "thinking");
    if (!thinkingBlock || typeof thinkingBlock.thinking !== "string") return;
    
    const currentThinking = thinkingBlock.thinking as string;
    
    // Skip if loop detection is temporarily disabled
    if (this.loopDetection.isDisabled) return;
    
    // Check similarity with recent thinkings
    const { recentThinkings } = this.loopDetection;
    let maxSimilarity = 0;
    
    for (const prev of recentThinkings) {
      const similarity = this.calculateSimilarity(currentThinking, prev);
      if (similarity > maxSimilarity) {
        maxSimilarity = similarity;
      }
    }
    
    // Update recent thinkings (keep last 5)
    recentThinkings.push(currentThinking);
    if (recentThinkings.length > 5) {
      recentThinkings.shift();
    }
    
    // Check if similar enough to count as repetition
    if (maxSimilarity >= THINKING_SIMILARITY_THRESHOLD) {
      this.loopDetection.consecutiveSimilar++;
    } else {
      // Reset counter if thinking is significantly different
      this.loopDetection.consecutiveSimilar = 0;
      this.loopDetection.lastWarningLevel = 0;
    }
    
    // Take action based on repetition count
    const count = this.loopDetection.consecutiveSimilar;
    
    if (count >= LOOP_HARD_STOP_THRESHOLD) {
      this.handleHardStop();
    } else if (count >= LOOP_STRONG_WARNING_THRESHOLD && this.loopDetection.lastWarningLevel < 2) {
      this.handleStrongWarning();
    } else if (count >= LOOP_SOFT_WARNING_THRESHOLD && this.loopDetection.lastWarningLevel < 1) {
      this.handleSoftWarning();
    }
  }

  /**
   * Calculate similarity between two strings using simple token overlap.
   * Returns a value between 0 (completely different) and 1 (identical).
   */
  private calculateSimilarity(a: string, b: string): number {
    if (a === b) return 1;
    if (a.length < 10 || b.length < 10) return 0; // Too short to compare meaningfully
    
    // Normalize and tokenize
    const tokenize = (s: string) => {
      return s.toLowerCase()
        .replace(/[\n\r]+/g, ' ')
        .split(/\s+/)
        .filter(t => t.length > 1);
    };
    
    const tokensA = tokenize(a);
    const tokensB = tokenize(b);
    
    if (tokensA.length === 0 || tokensB.length === 0) return 0;
    
    // Count overlapping tokens
    const setB = new Set(tokensB);
    let matches = 0;
    for (const t of tokensA) {
      if (setB.has(t)) matches++;
    }
    
    // Jaccard-like similarity
    const union = new Set([...tokensA, ...tokensB]).size;
    return union > 0 ? matches / union : 0;
  }

  /**
   * Soft warning: emit a hint event for the frontend to display.
   * The model may or may not respond to this.
   */
  private handleSoftWarning(): void {
    this.loopDetection.lastWarningLevel = 1;
    
    // Emit a warning event for the frontend
    const warningEvent: AgentEvent = {
      type: "loop_detection",
      level: "soft",
      message: "检测到可能的重复循环。如果任务已完成，请总结并停止；如果需要继续，请说明原因。",
      count: this.loopDetection.consecutiveSimilar,
    };
    
    for (const l of this.listeners) l(warningEvent);
  }

  /**
   * Strong warning: emit a more urgent warning.
   */
  private handleStrongWarning(): void {
    this.loopDetection.lastWarningLevel = 2;
    
    const warningEvent: AgentEvent = {
      type: "loop_detection",
      level: "strong",
      message: "⚠️ 检测到明显的重复循环模式！请立即停止当前操作，总结已完成的工作。",
      count: this.loopDetection.consecutiveSimilar,
    };
    
    for (const l of this.listeners) l(warningEvent);
  }

  /**
   * Hard stop: abort the current generation and notify user.
   */
  private handleHardStop(): void {
    // Emit hard stop event
    const stopEvent: AgentEvent = {
      type: "loop_detection",
      level: "hard",
      message: "🚫 检测到死循环，已自动中断。请检查任务状态后手动继续。",
      count: this.loopDetection.consecutiveSimilar,
    };
    
    for (const l of this.listeners) l(stopEvent);
    
    // Abort current generation
    this.inner.abort().catch(() => {});
    
    // Reset detection state
    this.loopDetection.consecutiveSimilar = 0;
    this.loopDetection.lastWarningLevel = 0;
    this.loopDetection.recentThinkings = [];
  }

  /**
   * Reset loop detection state (call when user sends a new message).
   */
  resetLoopDetection(): void {
    this.loopDetection.consecutiveSimilar = 0;
    this.loopDetection.lastWarningLevel = 0;
    this.loopDetection.recentThinkings = [];
    this.loopDetection.isDisabled = false;
  }

  /**
   * Temporarily disable loop detection (e.g., when user explicitly confirms continuation).
   */
  disableLoopDetection(): void {
    this.loopDetection.isDisabled = true;
  }

  /**
   * Re-enable loop detection.
   */
  enableLoopDetection(): void {
    this.loopDetection.isDisabled = false;
  }

  onEvent(listener: EventListener): () => void {
    this.listeners.push(listener);
    return () => {
      const i = this.listeners.indexOf(listener);
      if (i !== -1) this.listeners.splice(i, 1);
    };
  }

  onDestroy(cb: () => void): void {
    this.onDestroyCallback = cb;
  }

  async send(command: Record<string, unknown>): Promise<unknown> {
    this.resetIdleTimer();
    const type = command.type as string;

    switch (type) {
      case "prompt": {
        // Reset loop detection when user sends a new message
        this.resetLoopDetection();
        // Fire and forget — events come via subscribe
        const promptImages = command.images as Array<{ type: "image"; data: string; mimeType: string }> | undefined;
        this.inner.prompt(command.message as string, promptImages?.length ? { images: promptImages } : undefined).catch((err) => {
          // prompt() 在产生任何事件前失败时（如模型/网络错误），必须把错误暴露给前端，
          // 否则 SSE 流会静默空等到超时，表现为"聊天没反应"。
          console.error("[rpc-manager] prompt failed:", err);
          const errorEvent: AgentEvent = {
            type: "error",
            message: err instanceof Error ? err.message : String(err),
          };
          for (const l of this.listeners) l(errorEvent);
        });
        return null;
      }

      case "abort":
        await this.inner.abort();
        return null;

      case "get_state": {
        const model = this.inner.model;
        const contextUsage = this.inner.getContextUsage();
        return {
          sessionId: this.inner.sessionId,
          sessionFile: this.inner.sessionFile ?? "",
          isStreaming: this.inner.isStreaming,
          isCompacting: this.inner.isCompacting,
          autoCompactionEnabled: this.inner.autoCompactionEnabled,
          autoRetryEnabled: this.inner.autoRetryEnabled,
          model: model ? { id: model.id, provider: model.provider } : undefined,
          messageCount: 0,
          pendingMessageCount: 0,
          contextUsage: contextUsage
            ? { percent: contextUsage.percent, contextWindow: contextUsage.contextWindow, tokens: contextUsage.tokens }
            : null,
          systemPrompt: this.inner.agent.state?.systemPrompt ?? "",
          thinkingLevel: this.inner.agent.state?.thinkingLevel ?? "off",
        };
      }

      case "set_model": {
        const { provider, modelId } = command as { provider: string; modelId: string };
        const registry = this.inner.modelRegistry;
        let model = registry.find(provider, modelId);
        if (!model) {
          // Model not found in the cached registry. Refresh from models.json in case it was newly added!
          if (typeof registry.refresh === "function") {
            registry.refresh();
          }
          model = registry.find(provider, modelId);
        }
        if (!model) throw new Error(`Model not found: ${provider}/${modelId}`);
        await this.inner.setModel(model);
        return { id: model.id, provider: model.provider };
      }

      case "fork": {
        const entryId = command.entryId as string;
        const sessionManager = this.inner.sessionManager;
        const currentSessionFile = this.inner.sessionFile;

        if (!sessionManager.isPersisted()) return { cancelled: true };
        if (!currentSessionFile) throw new Error("Persisted session is missing a session file");

        const entry = sessionManager.getEntry(entryId);
        if (!entry) throw new Error("Invalid entry ID for forking");

        const sessionDir = sessionManager.getSessionDir();
        let newSessionFile: string;

        if (!entry.parentId) {
          // Fork before the first message: create an empty session linked to this one
          const newManager = SessionManager.create(sessionManager.getCwd(), sessionDir);
          newManager.newSession({ parentSession: currentSessionFile });
          newSessionFile = newManager.getSessionFile() as string;
        } else {
          // Fork after some history: copy path up to (but not including) the fork point
          const sourceManager = SessionManager.open(currentSessionFile, sessionDir);
          const forkedPath = sourceManager.createBranchedSession(entry.parentId);
          if (!forkedPath) throw new Error("Failed to create forked session");
          newSessionFile = forkedPath;
        }

        const newSessionId = SessionManager.open(newSessionFile, sessionDir).getSessionId();
        cacheSessionPath(newSessionId, newSessionFile);
        this.destroy();
        return { cancelled: false, newSessionId };
      }

      case "navigate_tree": {
        const result = await this.inner.navigateTree(command.targetId as string, {});
        return { cancelled: result.cancelled };
      }

      case "set_thinking_level": {
        const level = command.level as string;
        this.inner.setThinkingLevel(level);
        // setThinkingLevel clamps xhigh→high for models where supportsXhigh()===false.
        // If the model has DeepSeek thinking compat (reasoningEffortMap maps xhigh→max),
        // force the state back so the compat layer can use it correctly.
        if (level === "xhigh" && (this.inner.model as { compat?: { thinkingFormat?: string } } | null)?.compat?.thinkingFormat === "deepseek" && this.inner.agent?.state) {
          this.inner.agent.state.thinkingLevel = "xhigh";
        }
        return null;
      }

      case "compact": {
        // pi's compact() does not guard against empty messagesToSummarize — use findCutPoint
        // to pre-check and throw a clean error instead of generating a useless empty summary.
        const { findCutPoint, DEFAULT_COMPACTION_SETTINGS } = await import("@earendil-works/pi-coding-agent");
        const pathEntries = this.inner.sessionManager.getBranch() as Array<{ type: string }>;
        const settings = { ...DEFAULT_COMPACTION_SETTINGS, ...this.inner.settingsManager.getCompactionSettings() };
        let prevCompactionIndex = -1;
        for (let i = pathEntries.length - 1; i >= 0; i--) {
          if (pathEntries[i].type === "compaction") { prevCompactionIndex = i; break; }
        }
        const boundaryStart = prevCompactionIndex + 1;
        const cutPoint = findCutPoint(pathEntries as never, boundaryStart, pathEntries.length, settings.keepRecentTokens);
        const historyEnd = cutPoint.isSplitTurn ? cutPoint.turnStartIndex : cutPoint.firstKeptEntryIndex;
        if (historyEnd <= boundaryStart) {
          throw new Error("Conversation too short to compact");
        }
        const result = await this.inner.compact(command.customInstructions as string | undefined);
        return result;
      }

      case "set_auto_compaction": {
        this.inner.setAutoCompactionEnabled(command.enabled as boolean);
        return null;
      }

      case "steer": {
        const steerImages = command.images as Array<{ type: "image"; data: string; mimeType: string }> | undefined;
        await this.inner.steer(command.message as string, steerImages?.length ? steerImages : undefined);
        return null;
      }

      case "follow_up": {
        const followImages = command.images as Array<{ type: "image"; data: string; mimeType: string }> | undefined;
        await this.inner.followUp(command.message as string, followImages?.length ? followImages : undefined);
        return null;
      }

      case "get_tools": {
        const all: ToolInfo[] = this.inner.getAllTools();
        const active = new Set<string>(this.inner.getActiveToolNames());
        return all.map((t) => ({
          name: t.name,
          description: t.description,
          active: active.has(t.name),
        }));
      }

      case "set_tools": {
        this.inner.setActiveToolsByName(command.toolNames as string[]);
        return null;
      }

      case "abort_compaction": {
        this.inner.abortCompaction();
        return null;
      }

      case "set_auto_retry": {
        this.inner.setAutoRetryEnabled(command.enabled as boolean);
        return null;
      }

      default:
        throw new Error(`Unsupported command: ${type}`);
    }
  }

  destroy(): void {
    if (!this._alive) return;
    this._alive = false;
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.unsubscribe?.();
    this.onDestroyCallback?.();
  }
}

// ============================================================================
// Session registry
// ============================================================================

declare global {
  var __piSessions: Map<string, AgentSessionWrapper> | undefined;
  var __piStartLocks: Map<string, Promise<{ session: AgentSessionWrapper; realSessionId: string }>> | undefined;
}

function getRegistry(): Map<string, AgentSessionWrapper> {
  if (!globalThis.__piSessions) {
    globalThis.__piSessions = new Map();
    const cleanup = () => globalThis.__piSessions?.forEach((s) => s.destroy());
    process.once("exit", cleanup);
    process.once("SIGINT", cleanup);
    process.once("SIGTERM", cleanup);
  }
  return globalThis.__piSessions;
}

function getLocks(): Map<string, Promise<{ session: AgentSessionWrapper; realSessionId: string }>> {
  if (!globalThis.__piStartLocks) globalThis.__piStartLocks = new Map();
  return globalThis.__piStartLocks;
}

export function getRpcSession(sessionId: string): AgentSessionWrapper | undefined {
  return getRegistry().get(sessionId);
}

/**
 * Get or create an AgentSession for the given session.
 * For new sessions (sessionFile === ""), pi generates its own id.
 * Pass toolNames to pre-configure active tools (empty array = all tools disabled).
 */
export async function startRpcSession(
  sessionId: string,
  sessionFile: string,
  cwd: string,
  toolNames?: string[]
): Promise<{ session: AgentSessionWrapper; realSessionId: string }> {
  const registry = getRegistry();
  const locks = getLocks();

  const existing = registry.get(sessionId);
  if (existing?.isAlive()) return { session: existing, realSessionId: sessionId };

  const inflight = locks.get(sessionId);
  if (inflight) return inflight;

  const starting = (async () => {
    const { SessionManager, getAgentDir } = await import("@earendil-works/pi-coding-agent");
    const agentDir = getAgentDir();

    const sessionManager = sessionFile
      ? SessionManager.open(sessionFile, undefined)
      : SessionManager.create(cwd, undefined);

    // Determine which tools to pass based on requested toolNames.
    // Since v0.68.0, createAgentSession expects string[] tool names instead of Tool[] instances.
    // Pass all built-in coding tool names by default; for "all off", pass empty array.
    const allCodingToolNames = ["read", "bash", "edit", "write", "grep", "find", "ls"];
    let toolsOption: string[] | undefined;
    if (toolNames !== undefined) {
      toolsOption = toolNames.length === 0 ? [] : allCodingToolNames;
    }

    const { session: inner } = await createAgentSession({
      cwd,
      agentDir,
      sessionManager,
      ...(toolsOption !== undefined ? { tools: toolsOption } : {}),
    });

    // If specific tool names were requested (non-empty), narrow active tools now
    if (toolNames && toolNames.length > 0) {
      inner.setActiveToolsByName(toolNames);
    }

    // When all tools are disabled, clear the system prompt entirely.
    // pi's buildSystemPrompt always produces a non-empty prompt even with no tools;
    // the only way to truly clear it is to call agent.setSystemPrompt directly.
    if (toolNames?.length === 0) {
      inner.agent.state.systemPrompt = "";
    }

    const wrapper = new AgentSessionWrapper(inner);
    wrapper.start();

    const realSessionId = inner.sessionId as string;
    const realSessionFile = inner.sessionFile as string | undefined;
    if (realSessionFile) cacheSessionPath(realSessionId, realSessionFile);

    wrapper.onDestroy(() => registry.delete(realSessionId));
    registry.set(realSessionId, wrapper);

    return { session: wrapper, realSessionId };
  })().finally(() => locks.delete(sessionId));

  locks.set(sessionId, starting);
  return starting;
}

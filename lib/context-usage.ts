/**
 * Offline context-usage estimation for session files on disk.
 * Mirrors AgentSession.getContextUsage() (pi SDK) without starting a session:
 * same compaction gate, same last-valid-usage + trailing-estimate formula.
 *
 * Estimation runs over the SDK's own buildSessionContext output — raw
 * `name`/`arguments` toolCall fields that estimateTokens can read. The
 * UI-converted messages from session-reader rename those fields and crash it.
 */
import {
  buildSessionContext as piBuildSessionContext,
  calculateContextTokens,
  estimateTokens,
  getLatestCompactionEntry,
} from "@earendil-works/pi-coding-agent";
import type {
  SessionContext as PiSessionContext,
  SessionEntry as PiSessionEntry,
} from "@earendil-works/pi-coding-agent";
import type { SessionEntry } from "./types";

/** Structural subset of the SDK SessionManager this module needs. */
export interface ContextUsageSource {
  getEntries(): SessionEntry[];
  getBranch(fromId?: string): SessionEntry[];
}

export interface FileContextUsage {
  percent: number | null;
  contextWindow: number;
  tokens: number | null;
}

interface UsageLike {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  totalTokens?: number;
}

function validAssistantUsage(message: unknown): UsageLike | undefined {
  const msg = message as { role?: string; stopReason?: string; usage?: UsageLike };
  if (msg.role !== "assistant") return undefined;
  if (msg.stopReason === "aborted" || msg.stopReason === "error") return undefined;
  if (!msg.usage) return undefined;
  return calculateContextTokens(msg.usage as never) > 0 ? msg.usage : undefined;
}

/**
 * SDK-shaped context for the active branch: messages safe for estimateTokens,
 * plus the branch-scoped current model (model_change entries and assistant
 * messages along the branch only — not other branches).
 */
function buildBranchContext(sm: ContextUsageSource, leafId: string | undefined): PiSessionContext {
  const entries = sm.getEntries() as unknown as PiSessionEntry[];
  const byId = new Map<string, PiSessionEntry>();
  for (const e of entries) byId.set(e.id, e);
  return piBuildSessionContext(entries, leafId, byId);
}

function usageForBranch(
  sm: ContextUsageSource,
  leafId: string | undefined,
  contextWindow: number | undefined,
  branch: PiSessionContext,
): FileContextUsage | null {
  if (!contextWindow || contextWindow <= 0) return null;

  // Compaction gate: after compaction, pre-compaction usage is meaningless
  const branchEntries = sm.getBranch(leafId);
  const latestCompaction = getLatestCompactionEntry(branchEntries as never);
  if (latestCompaction) {
    const compactionIndex = branchEntries.lastIndexOf(latestCompaction as never);
    let hasPostCompactionUsage = false;
    for (let i = branchEntries.length - 1; i > compactionIndex; i--) {
      const entry = branchEntries[i];
      if (entry.type === "message" && validAssistantUsage(entry.message)) {
        hasPostCompactionUsage = true;
        break;
      }
    }
    if (!hasPostCompactionUsage) {
      return { tokens: null, contextWindow, percent: null };
    }
  }

  // Last valid assistant usage + estimated trailing messages (same as SDK)
  const { messages } = branch;
  let lastUsageIndex = -1;
  let usageTokens = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    const usage = validAssistantUsage(messages[i]);
    if (usage) {
      lastUsageIndex = i;
      usageTokens = calculateContextTokens(usage as never);
      break;
    }
  }
  let trailingTokens = 0;
  for (let i = lastUsageIndex + 1; i < messages.length; i++) {
    trailingTokens += estimateTokens(messages[i]);
  }
  const tokens = usageTokens + trailingTokens;
  return { tokens, contextWindow, percent: (tokens / contextWindow) * 100 };
}

export function computeFileContextUsage(
  sm: ContextUsageSource,
  leafId: string | undefined,
  contextWindow: number | undefined,
): FileContextUsage | null {
  return usageForBranch(sm, leafId, contextWindow, buildBranchContext(sm, leafId));
}

/** Resolve the branch's current model (else default) and compute usage. */
export function computeSessionContextUsage(
  sm: ContextUsageSource,
  leafId: string | undefined,
  modelsData: {
    modelList: { provider: string; id: string; contextWindow?: number }[];
    defaultModel: { provider: string; modelId: string } | null;
  },
): FileContextUsage | null {
  const branch = buildBranchContext(sm, leafId);
  const modelRef = branch.model ?? modelsData.defaultModel ?? undefined;
  const contextWindow = modelRef
    ? modelsData.modelList.find((m) => m.provider === modelRef.provider && m.id === modelRef.modelId)?.contextWindow
    : undefined;
  return usageForBranch(sm, leafId, contextWindow, branch);
}

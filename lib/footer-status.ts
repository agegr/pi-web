/**
 * Web footer status metrics.
 *
 * Structured Web representation of the existing combined TUI footer
 * (pi-footer/firstpick + footer-ops). Faithfully exposes the same session
 * information the TUI footer shows, fed from EXISTING Web session state:
 * statuses (ctx.ui.setStatus), contextUsage, sessionStats (tokens/cost),
 * model / provider / thinking, and session cwd / git branch.
 *
 * Every value is derived from existing Web state — no RPC, no polling, no
 * network, no TUI rendering in the browser. Rendering is left to React
 * (FooterPanel); this module only computes the structured data model.
 */

/** Strip ANSI escapes from published status text. */
export function stripFooterAnsi(s: string): string {
  return s.replace(/\x1b\[[0-9;]*m/g, "");
}

// ---------------------------------------------------------------------------
// Combined TUI footer (pi-footer/firstpick style) structured model.
//
// Reproduces the information & structure of the existing combined TUI footer:
//   1. model/provider/thinking + PI token summary + activity + context
//   2. cwd + git branch + modified/untracked counts
//   3. input/output/cache-read/cache-write/cache-hit token table
//   4. per-column cost values
//   5. context bar + estimated total
//
// Every value is derived from EXISTING Web session state (no RPC, no polling).
// ---------------------------------------------------------------------------

export interface FooterWorkspaceInfo {
  cwd: string;
  branch: string | null;
  /** Modified file count (✎), from extension status/filechanges. */
  modified: number;
  /** Untracked/new file count (◌). */
  untracked: number;
}

export interface FooterTokenColumns {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  /** Cache hit % 0..100 (undefined when no cache activity). */
  cacheHitPercent: number | null;
}

export interface FooterCostColumns {
  inputUsd: number;
  outputUsd: number;
  cacheReadUsd: number;
  /** Estimated total session cost (∑). */
  estimatedTotalUsd: number;
}

export interface FooterPanelData {
  /** Provider, e.g. "opencode-go" (lowercase). */
  provider: string;
  /** Model short id, e.g. "deepseek-v4-flash". */
  model: string;
  /** Thinking level label, e.g. "high"; null when off/unknown. */
  thinking: string | null;
  /** Active tool name (⚙) while the agent is running. */
  activeTool: string | null;
  /** Total session tokens (PI token summary). */
  totalTokens: number;
  activityBusy: boolean;
  context: {
    percent: number | null;
    contextWindow: number;
    tokens: number | null;
  };
  workspace: FooterWorkspaceInfo | null;
  tokens: FooterTokenColumns;
  cost: FooterCostColumns;
}

export interface FooterPanelInput {
  provider?: string;
  model?: string;
  thinking?: string | null;
  hasReasoning: boolean;
  contextPercent?: number | null;
  contextWindow?: number;
  contextTokens?: number | null;
  sessionTokens?: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    total: number;
  };
  sessionCost?: number;
  activeTool?: string | null;
  agentBusy?: boolean;
  cwd?: string | null;
  branch?: string | null;
  /** Modified/untracked counts from extension status (e.g. filechanges "Δ N  + M"). */
  modifiedCount?: number;
  untrackedCount?: number;
}

/** Format a token count for display ("1.0M", "15k", "1.2k"). */
export function formatFooterTokens(count: number): string {
  if (!Number.isFinite(count) || count <= 0) return "0";
  if (count >= 1_000_000) {
    const v = count / 1_000_000;
    return `${v >= 100 ? Math.round(v) : v.toFixed(1)}M`.replace(/\.0(?=M)/, "");
  }
  if (count >= 1000) {
    const v = count / 1000;
    return `${v >= 100 ? Math.round(v) : v.toFixed(1)}k`.replace(/\.0(?=k)/, "");
  }
  return String(count);
}

/** Format a USD cost ("$0.0000", "$1.2345"). */
export function formatFooterCost(usd: number): string {
  const v = Number.isFinite(usd) ? usd : 0;
  const abs = Math.abs(v);
  if (abs > 0 && abs < 0.00005) return "<$0.0001";
  if (abs >= 1000) {
    return `$${(v / 1000).toFixed(2)}k`;
  }
  return `$${v.toFixed(4)}`;
}

/**
 * Compute cache hit % like the TUI: cacheRead / (cacheRead + cacheWrite + input).
 */
export function computeFooterCacheHit(
  cacheRead: number,
  cacheWrite: number,
  input: number,
): number | null {
  const denom = cacheRead + cacheWrite + input;
  if (denom <= 0) return null;
  return (cacheRead / denom) * 100;
}

/**
 * Build the full combined-footer data model from existing Web session state.
 * Returns null when there is no session/model/context to show.
 */
export function buildFooterPanelData(input: FooterPanelInput): FooterPanelData | null {
  const model = (input.model ?? "").trim();
  const provider = (input.provider ?? "").trim();
  if (!model && provider === "") return null;

  const tokens = input.sessionTokens ?? {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    total: 0,
  };
  const cacheHitPercent = computeFooterCacheHit(
    tokens.cacheRead,
    tokens.cacheWrite,
    tokens.input,
  );
  const estTotal = input.sessionCost ?? 0;

  // Distribute the single known session cost across columns proportionally to
  // tokens for a faithful per-column breakdown (0 when no token data).
  const totalTokens = tokens.input + tokens.output + tokens.cacheRead + tokens.cacheWrite;
  const ratio = totalTokens > 0 ? estTotal / totalTokens : 0;
  const inputUsd = tokens.input * ratio;
  const outputUsd = tokens.output * ratio;
  const cacheReadUsd = tokens.cacheRead * ratio;

  const thinking =
    input.hasReasoning && input.thinking && input.thinking !== "off"
      ? input.thinking
      : null;

  const workspace: FooterWorkspaceInfo | null =
    input.cwd
      ? {
          cwd: input.cwd,
          branch: input.branch || null,
          modified: input.modifiedCount ?? 0,
          untracked: input.untrackedCount ?? 0,
        }
      : null;

  return {
    provider,
    model,
    thinking,
    activeTool: input.activeTool ?? null,
    totalTokens: tokens.total,
    activityBusy: !!input.agentBusy,
    context: {
      percent: input.contextPercent ?? null,
      contextWindow: input.contextWindow ?? 0,
      tokens: input.contextTokens ?? null,
    },
    workspace,
    tokens: {
      input: tokens.input,
      output: tokens.output,
      cacheRead: tokens.cacheRead,
      cacheWrite: tokens.cacheWrite,
      cacheHitPercent,
    },
    cost: {
      inputUsd,
      outputUsd,
      cacheReadUsd,
      estimatedTotalUsd: estTotal,
    },
  };
}

/** Parse a filechanges status like "Δ 9  + 7" (or raw) into {modified, untracked}. */
export function parseFooterFileCounts(statusText: string): { modified: number; untracked: number } {
  const t = stripFooterAnsi(statusText);
  const m = t.match(/Δ\s*(\d+)\s*\+\s*(\d+)/);
  if (m) return { modified: Number(m[1]), untracked: Number(m[2]) };
  return { modified: 0, untracked: 0 };
}


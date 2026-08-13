export type GoalPanelStatus = "active" | "paused" | "blocked" | "budget_limited" | "complete" | "unknown";
export type GoalEditMode = "edit" | "replace";

export interface GoalPanelModel {
  objective: string;
  status: GoalPanelStatus;
  statusLabel: string;
  timeLabel?: string;
  budgetLabel?: string;
  editMode: GoalEditMode;
}

export const GOAL_WIDGET_KEYS = new Set(["goal"]);
export const GOAL_STATUS_KEYS = new Set(["goal", "codex-goal"]);

const STATUS_LABELS: Record<GoalPanelStatus, string> = {
  active: "active",
  paused: "paused",
  blocked: "stalled",
  budget_limited: "limited by budget",
  complete: "complete",
  unknown: "goal",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isGoalWidgetKey(key: string): boolean {
  return GOAL_WIDGET_KEYS.has(key);
}

export function isGoalStatusKey(key: string): boolean {
  return GOAL_STATUS_KEYS.has(key);
}

export function filterGoalWidgets<T extends { key: string }>(widgets: T[]): T[] {
  return widgets.filter((widget) => !isGoalWidgetKey(widget.key));
}

export function filterGoalStatuses<T extends { key: string }>(statuses: T[]): T[] {
  return statuses.filter((item) => !isGoalStatusKey(item.key));
}

export function formatGoalDuration(seconds: number): string {
  const s = Math.max(0, Math.trunc(seconds));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  if (h >= 24) {
    const d = Math.floor(h / 24);
    return `${d}d ${h % 24}h ${rm}m`;
  }
  return rm === 0 ? `${h}h` : `${h}h ${rm}m`;
}

function normalizeStatus(value: unknown): GoalPanelStatus {
  if (value === "active" || value === "paused" || value === "blocked" || value === "complete") return value;
  if (value === "budgetLimited" || value === "budget_limited" || value === "usage_limited") return "budget_limited";
  return "unknown";
}

function model(partial: Omit<GoalPanelModel, "statusLabel"> & { statusLabel?: string }): GoalPanelModel {
  return {
    ...partial,
    statusLabel: partial.statusLabel || STATUS_LABELS[partial.status],
  };
}

export function parseGoalWidget(widget: { key: string; lines?: string[] } | undefined): GoalPanelModel | null {
  if (!widget || !isGoalWidgetKey(widget.key)) return null;
  const raw = widget.lines?.[0];
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (typeof parsed.objective !== "string" || typeof parsed.status !== "string") return null;
    return model({
      objective: parsed.objective,
      status: normalizeStatus(parsed.status),
      statusLabel: typeof parsed.statusLabel === "string" ? parsed.statusLabel : undefined,
      timeLabel: typeof parsed.timeLabel === "string" ? parsed.timeLabel : undefined,
      budgetLabel: typeof parsed.budgetLabel === "string" ? parsed.budgetLabel : undefined,
      editMode: "edit",
    });
  } catch {
    return null;
  }
}

function modelFromThreadGoal(goal: Record<string, unknown>): GoalPanelModel | null {
  if (typeof goal.objective !== "string") return null;
  const usage = isRecord(goal.usage) ? goal.usage : null;
  const tokensUsed = typeof usage?.tokensUsed === "number" ? usage.tokensUsed : typeof goal.tokensUsed === "number" ? goal.tokensUsed : undefined;
  const seconds = typeof usage?.activeSeconds === "number" ? usage.activeSeconds : typeof goal.timeUsedSeconds === "number" ? goal.timeUsedSeconds : undefined;
  const budget = goal.tokenBudget === null || typeof goal.tokenBudget === "number" ? goal.tokenBudget : undefined;
  let budgetLabel: string | undefined;
  if (typeof tokensUsed === "number" && budget != null) budgetLabel = `${formatCompact(tokensUsed)}/${formatCompact(budget)}`;
  else if (typeof tokensUsed === "number") budgetLabel = formatCompact(tokensUsed);
  return model({
    objective: goal.objective,
    status: normalizeStatus(goal.status),
    timeLabel: typeof seconds === "number" ? formatGoalDuration(seconds) : undefined,
    budgetLabel,
    editMode: "replace",
  });
}

function formatCompact(value: number): string {
  const n = Math.max(0, Math.trunc(value));
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`.replace(".0M", "M");
  if (n >= 1_000) return `${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1)}K`.replace(".0K", "K");
  return String(n);
}

export function extractGoalFromEntries(entries: Array<{ type?: string; customType?: string; data?: unknown }>): GoalPanelModel | null {
  let current: GoalPanelModel | null = null;
  for (const entry of entries) {
    if (entry.type !== "custom" || entry.customType !== "pi-codex-goal" || !isRecord(entry.data)) continue;
    const data = entry.data;
    if (data.kind === "clear") {
      current = null;
      continue;
    }
    if (data.kind === "set" && isRecord(data.goal)) {
      current = modelFromThreadGoal(data.goal);
      continue;
    }
    if (data.kind === "usage" && current && isRecord(data.usage)) {
      const seconds = typeof data.usage.activeSeconds === "number" ? data.usage.activeSeconds : undefined;
      const tokensUsed = typeof data.usage.tokensUsed === "number" ? data.usage.tokensUsed : undefined;
      current = {
        ...current,
        timeLabel: typeof seconds === "number" ? formatGoalDuration(seconds) : current.timeLabel,
        budgetLabel: typeof tokensUsed === "number" ? formatCompact(tokensUsed) : current.budgetLabel,
      };
    }
  }
  return current;
}

export function inferGoalFromStatus(text: string): GoalPanelModel | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  if (/^FAST\b/i.test(trimmed) && !/goal/i.test(trimmed)) return null;
  if (!/goal/i.test(trimmed)) return null;

  let status: GoalPanelStatus = "unknown";
  if (/paused/i.test(trimmed)) status = "paused";
  else if (/unmet|abandoned|budget/i.test(trimmed)) status = "budget_limited";
  else if (/achieved|complete/i.test(trimmed)) status = "complete";
  else if (/pursuing|active/i.test(trimmed)) status = "active";
  else return null;

  const budgetMatch = trimmed.match(/\(([^)]+)\)/);
  const inner = budgetMatch?.[1];
  const looksLikeTime = inner ? /^\d+[smhd](?:\s|$)/i.test(inner) : false;
  return model({
    objective: "",
    status,
    timeLabel: looksLikeTime ? inner : undefined,
    budgetLabel: inner && !looksLikeTime ? inner.replace(/\s*tokens$/i, "").trim() : undefined,
    editMode: "replace",
  });
}

export function resolveGoalPanelModel(input: {
  widgets?: Array<{ key: string; lines?: string[] }>;
  statuses?: Array<{ key: string; text: string }>;
  sessionGoal?: GoalPanelModel | null;
  live?: boolean;
}): GoalPanelModel | null {
  for (const widget of input.widgets ?? []) {
    const parsed = parseGoalWidget(widget);
    if (parsed) return parsed;
  }
  const liveHasGoal = (input.statuses ?? []).some((item) => isGoalStatusKey(item.key));
  if (input.live && !liveHasGoal) return null;
  if (input.sessionGoal) {
    const live = (input.statuses ?? [])
      .filter((item) => isGoalStatusKey(item.key))
      .map((item) => inferGoalFromStatus(item.text))
      .find(Boolean);
    if (!live) return input.sessionGoal;
    return {
      ...input.sessionGoal,
      status: live.status !== "unknown" ? live.status : input.sessionGoal.status,
      statusLabel: live.status !== "unknown" ? live.statusLabel : input.sessionGoal.statusLabel,
      timeLabel: live.timeLabel ?? input.sessionGoal.timeLabel,
      budgetLabel: live.budgetLabel ?? input.sessionGoal.budgetLabel,
    };
  }
  for (const item of input.statuses ?? []) {
    if (!isGoalStatusKey(item.key)) continue;
    const parsed = inferGoalFromStatus(item.text);
    if (parsed) return parsed;
  }
  return null;
}

/**
 * 标签页的运行指示。标题只有文字，颜色只体现在 favicon 上：运行中是盲文转圈，
 * 结束后是字形加彩色圆点。纯函数，`hooks/useTabRunIndicator.ts` 负责写入。
 */
export type TabRunPhase = "idle" | "running" | "done" | "failed";
export type TabRunStatus = "done" | "failed";

export const TAB_SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"] as const;
/** 一帧的时长：肉眼连续，又不至于每秒重写十几次标题。 */
export const TAB_SPINNER_INTERVAL_MS = 120;
export const TAB_RUN_GLYPHS: Record<TabRunStatus, string> = { done: "●", failed: "✕" };
/** 与侧栏的状态点一致：已完成为绿，失败为红。 */
export const TAB_RUN_COLORS: Record<TabRunStatus, string> = { done: "#16a34a", failed: "#dc2626" };

export function tabRunStatus(phase: TabRunPhase): TabRunStatus | null {
  return phase === "done" || phase === "failed" ? phase : null;
}

export function tabRunPrefix(phase: TabRunPhase, frame = 0): string {
  if (phase === "running") {
    const index = ((Math.trunc(frame) % TAB_SPINNER_FRAMES.length) + TAB_SPINNER_FRAMES.length) % TAB_SPINNER_FRAMES.length;
    return TAB_SPINNER_FRAMES[index];
  }
  const status = tabRunStatus(phase);
  return status ? TAB_RUN_GLYPHS[status] : "";
}

export function formatTabTitle(baseTitle: string, phase: TabRunPhase, frame = 0): string {
  const base = baseTitle.trim() === "" ? "Pi Web" : baseTitle;
  const prefix = tabRunPrefix(phase, frame);
  return prefix ? `${prefix} ${base}` : base;
}

export interface TabRunEnd {
  aborted?: boolean;
  subagentsActive?: boolean;
  failed?: boolean;
}

/**
 * 一次运行结束后的阶段：中止不算结果；子代理还在工作说明任务没结束，继续转圈。
 */
export function tabRunPhaseAfterEnd(end: TabRunEnd): TabRunPhase {
  if (end.aborted) return "idle";
  if (end.subagentsActive) return "running";
  return end.failed ? "failed" : "done";
}

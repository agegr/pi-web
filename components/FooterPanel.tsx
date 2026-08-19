"use client";

import type { CSSProperties } from "react";
import {
  formatFooterCost,
  formatFooterTokens,
  type FooterPanelData,
} from "@/lib/footer-status";

/**
 * Structured Web render of the combined TUI footer (pi-footer/firstpick style).
 * Consumes the same underlying session state the TUI footer uses and renders
 * it as styled React/HTML/CSS — no ANSI, no terminal emulation.
 *
 * Structure (mirrors the TUI footer):
 *   row 1: provider/model • thinking │ PI tokens │ activity │ context %
 *   row 2: cwd │ branch │ modified/untracked counts
 *   row 3: Input ┊ Output ┊ Cache read ┊ Cache write ┊ Cache hit
 *   row 4: $Input ┊ $Output ┊ $Cache read (cost columns)
 *   row 5: context bar + estimated total
 */

const LABEL_STYLE: CSSProperties = {
  color: "var(--text-dim)",
  textTransform: "uppercase",
  fontSize: 10,
  letterSpacing: "0.04em",
};

const VALUE_STYLE: CSSProperties = { color: "var(--text)" };
const MUTED_STYLE: CSSProperties = { color: "var(--text-muted)" };

function Cell({ label, value, dim }: { label: string; value: string; dim?: boolean }) {
  return (
    <span className="footer-cell">
      <span style={LABEL_STYLE}>{label}</span>
      <span style={dim ? MUTED_STYLE : VALUE_STYLE}>{value}</span>
    </span>
  );
}

function GitCount({ icon, count, color }: { icon: string; count: number; color: string }) {
  return (
    <span className="footer-git-count" style={{ color }}>
      {icon}
      {count}
    </span>
  );
}

function CellRow({ data }: { data: FooterPanelData }) {
  const t = data.tokens;
  return (
    <div className="footer-cells">
      <Cell label="Input" value={formatFooterTokens(t.input)} dim={t.input === 0} />
      <span className="footer-cell-sep" aria-hidden="true">┊</span>
      <Cell label="Output" value={formatFooterTokens(t.output)} dim={t.output === 0} />
      <span className="footer-cell-sep" aria-hidden="true">┊</span>
      <Cell label="Cache read" value={formatFooterTokens(t.cacheRead)} dim={t.cacheRead === 0} />
      <span className="footer-cell-sep" aria-hidden="true">┊</span>
      <Cell
        label="Cache write"
        value={t.cacheWrite === 0 ? "n/a" : formatFooterTokens(t.cacheWrite)}
        dim={t.cacheWrite === 0}
      />
      <span className="footer-cell-sep" aria-hidden="true">┊</span>
      <Cell
        label="Cache hit"
        value={t.cacheHitPercent === null ? "0.0%" : `${t.cacheHitPercent.toFixed(1)}%`}
        dim={t.cacheHitPercent === null}
      />
    </div>
  );
}

function CostRow({ data }: { data: FooterPanelData }) {
  const c = data.cost;
  return (
    <div className="footer-cost-row">
      <span style={MUTED_STYLE}>{formatFooterCost(c.inputUsd)}</span>
      <span className="footer-cell-sep" aria-hidden="true">┊</span>
      <span style={MUTED_STYLE}>{formatFooterCost(c.outputUsd)}</span>
      <span className="footer-cell-sep" aria-hidden="true">┊</span>
      <span style={MUTED_STYLE}>{formatFooterCost(c.cacheReadUsd)}</span>
      <span className="footer-cell-sep" aria-hidden="true">┊</span>
      <span style={MUTED_STYLE}>n/a</span>
      <span className="footer-cell-sep" aria-hidden="true">┊</span>
      <span style={{ color: "var(--footer-success, #22c55e)" }}>
        ├{String.fromCharCode(0x2500).repeat(Math.max(1, Math.min(10, Math.round((data.tokens.cacheHitPercent ?? 0) / 10))))}┤
      </span>
      <span className="footer-spacer" />
      <span className="footer-est-total" style={{ color: "var(--text)" }}>
        ∑ Est. total <span style={{ color: "var(--accent)" }}>{formatFooterCost(c.estimatedTotalUsd)}</span>
      </span>
    </div>
  );
}

function ContextRow({ data }: { data: FooterPanelData }) {
  const ctx = data.context;
  const percent = ctx.percent ?? 0;
  const filled = Math.max(0, Math.min(18, Math.round((percent / 100) * 18)));
  const bar = `${String.fromCharCode(0x2500).repeat(filled)}${String.fromCharCode(0x2500).repeat(18 - filled)}`;
  return (
    <div className="footer-context-row">
      <span style={MUTED_STYLE}>
        Context {ctx.tokens === null ? 0 : formatFooterTokens(ctx.tokens)}/{formatFooterTokens(ctx.contextWindow)} tok
      </span>
      <span className="footer-spacer" />
      <span className="footer-context-bar" style={{ color: "var(--accent)" }}>{bar}</span>
      <span style={MUTED_STYLE}> {percent}%</span>
    </div>
  );
}

export function FooterPanel({ data }: { data: FooterPanelData | null }) {
  if (!data) {
    return (
      <div className="extension-widget-panel footer-panel">
        <div className="footer-panel-empty" style={MUTED_STYLE}>No session data</div>
      </div>
    );
  }

  const modelLine = `${data.provider ? `(${data.provider}) ` : ""}${data.model}${data.thinking ? ` • ${data.thinking}` : ""}`;
  const pct = data.context.percent === null ? "0.0%" : `${data.context.percent}%`;

  return (
    <div className="extension-widget-panel footer-panel">
      {/* Row 1: model/provider/thinking + PI summary + activity + context */}
      <div className="footer-row footer-row-main">
        <span className="footer-model" style={{ color: "var(--text)" }}>{modelLine}</span>
        <span className="footer-spacer" />
        <span className="footer-metric" style={MUTED_STYLE}>
          PI: {formatFooterTokens(data.totalTokens)} tok
        </span>
        {data.activeTool ? (
          <span className="footer-metric" style={{ color: "var(--accent)" }}>⚙ {data.activeTool}</span>
        ) : (
          <span className="footer-metric" style={MUTED_STYLE}>⚡ 0 tok @ — tok/s</span>
        )}
        <span className="footer-metric" style={MUTED_STYLE}>🧠 {pct}/{formatFooterTokens(data.context.contextWindow)}</span>
      </div>

      {/* Row 2: cwd / branch / file counts */}
      {data.workspace && (
        <div className="footer-row footer-row-workspace">
          <span className="footer-cwd" style={{ color: "var(--text-muted)" }}>{data.workspace.cwd}</span>
          {data.workspace.branch && (
            <>
              <span className="footer-cell-sep" aria-hidden="true">│</span>
              <span className="footer-branch" style={{ color: "var(--text-muted)" }}>
                 · {data.workspace.branch}
              </span>
            </>
          )}
          <span className="footer-spacer" />
          <GitCount icon="✎" count={data.workspace.modified} color="var(--text-muted)" />
          <span className="footer-cell-sep" aria-hidden="true">·</span>
          <GitCount icon="◌" count={data.workspace.untracked} color="var(--text-muted)" />
        </div>
      )}

      {/* Row 3: token columns */}
      <CellRow data={data} />
      {/* Row 4: cost columns */}
      <CostRow data={data} />
      {/* Row 5: context bar + estimated total */}
      <ContextRow data={data} />
    </div>
  );
}
"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { ModalButton } from "@/components/ui/ConfigModal";
import { MiniToggle } from "@/components/ui/MiniToggle";

// 跟随上游重写（2026-08-02）：上游已移除 csrf header 机制（见 components/AgentsConfig），
// 这里用原生 fetch 替代已删的 csrfFetchJson，保持 { ok, data } 调用契约。
async function apiFetchJson<T = unknown>(
  url: string,
  init?: Record<string, unknown>,
): Promise<{ ok: boolean; data: T; status?: number }> {
  try {
    const body =
      init?.body != null && typeof init.body === "object" && !(init.body instanceof FormData)
        ? JSON.stringify(init.body)
        : (init?.body as BodyInit | undefined);
    const res = await fetch(url, {
      ...init,
      body,
      headers: {
        "Content-Type": "application/json",
        ...((init?.headers as Record<string, string>) ?? {}),
      },
    } as RequestInit);
    const data = (await res.json().catch(() => ({}))) as T;
    return { ok: res.ok, data, status: res.status };
  } catch {
    return { ok: false, data: {} as T };
  }
}

// ── Types (mirror app/api/prompts/* responses) ───────────────────────────────

interface ModuleRow {
  id: string;
  source: string;
  category: string;
  tags: string[];
  heading?: string;
  alwaysOn: boolean;
  enabled: boolean;
  text: string;
  compressedText?: string;
  estimatedTokens: number;
}

interface Summary {
  count: number;
  totalTokens: number;
  enabledTokens: number;
  savedTokens: number;
}

interface ModulesResponse {
  modules: ModuleRow[];
  summary: Summary;
  agentsMdModular: boolean;
}

interface PreviewResponse {
  selected: Array<{ id: string; source: string; category: string }>;
  skipped: Array<{ id: string; source: string; category: string }>;
  tokensBefore: number;
  tokensAfter: number;
  tokensSaved: number;
  usedLlm: boolean;
}

const SOURCE_ORDER = ["app", "agents-md", "orchestrator", "engine"] as const;

// Category → dot color（类别语义色板，固定 hex 合理，非主题色）。
const CATEGORY_COLOR: Record<string, string> = {
  identity: "#6366F1",
  constraints: "#EF4444",
  tone: "#0EA5E9",
  "output-format": "#3B82F6",
  grounding: "#22C55E",
  examples: "#F59E0B",
  localization: "#14B8A6",
  safety: "#EF4444",
  other: "#94A3B8",
};

interface Props {
  cwd?: string | null;
  onClose: () => void;
}

/**
 * 提示词栏 —— 模块化系统提示词管理（单栏主从切换）。
 *
 * 嵌入 WorkspacePanelsHost 右侧栏（340px），不再用 ConfigModal 双栏（原 880px 双栏在
 * 窄栏严重挤爆）。主视图=模块列表（开关/分组），从视图=模块详情（压缩/对比）。
 *
 * 接通：rpc-manager 经 lib/prompt-loader-options 的 agentsFilesOverride 把 AGENTS.md 按
 * 开关裁剪后注入上游 systemPrompt（见 docs/PROMPTS-PANEL-PLAN.md 三、源头注入）。
 */
export function PromptsConfig({ cwd, onClose: _onClose }: Props) {
  const { t } = useI18n();
  const [modules, setModules] = useState<ModuleRow[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [agentsMdModular, setAgentsMdModular] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  // Preview state
  const [previewInput, setPreviewInput] = useState("");
  const [previewUseLlm, setPreviewUseLlm] = useState(false);
  const [previewRunning, setPreviewRunning] = useState(false);
  const [preview, setPreview] = useState<PreviewResponse | null>(null);

  const load = useCallback(
    async (silent = true) => {
      if (!silent) setLoading(true);
      setLoadError(null);
      const modulesUrl = `/api/prompts/modules${cwd ? `?cwd=${encodeURIComponent(cwd)}` : ""}`;
      const { ok, data } = await apiFetchJson<ModulesResponse>(modulesUrl, {
        method: "GET",
      });
      if (!ok || !Array.isArray(data.modules)) {
        setLoadError(t("promptOpt.loadFailed"));
        setLoading(false);
        return;
      }
      setModules(data.modules);
      setSummary(data.summary);
      setAgentsMdModular(Boolean(data.agentsMdModular));
      setLoading(false);
    },
    [t, cwd],
  );

  useEffect(() => {
    void load(false);
  }, [load]);

  const selected = useMemo(
    () => modules.find((m) => m.id === selectedId) ?? null,
    [modules, selectedId],
  );

  const grouped = useMemo(() => {
    const map = new Map<string, ModuleRow[]>();
    for (const m of modules) {
      const arr = map.get(m.source) ?? [];
      arr.push(m);
      map.set(m.source, arr);
    }
    return SOURCE_ORDER.filter((s) => map.has(s)).map((s) => ({
      source: s,
      items: map.get(s)!,
    }));
  }, [modules]);

  const sourceLabel = useCallback(
    (s: string) => {
      switch (s) {
        case "app":
          return t("promptOpt.sourceApp");
        case "agents-md":
          return t("promptOpt.sourceAgentsMd");
        case "orchestrator":
          return t("promptOpt.sourceOrchestrator");
        case "engine":
          return t("promptOpt.sourceEngine");
        default:
          return s;
      }
    },
    [t],
  );

  const toggleModule = useCallback(
    async (m: ModuleRow) => {
      if (m.alwaysOn) return;
      const next = !m.enabled;
      setModules((prev) => prev.map((x) => (x.id === m.id ? { ...x, enabled: next } : x)));
      const { ok } = await apiFetchJson("/api/prompts/modules", {
        method: "PUT",
        body: { id: m.id, enabled: next, cwd: cwd ?? undefined },
      });
      if (!ok) {
        setModules((prev) => prev.map((x) => (x.id === m.id ? { ...x, enabled: !next } : x)));
        return;
      }
      void load();
    },
    [cwd, load],
  );

  const toggleAgentsMdModular = useCallback(async () => {
    const next = !agentsMdModular;
    setAgentsMdModular(next);
    const { ok } = await apiFetchJson("/api/prompts/modules", {
      method: "PUT",
      body: { agentsMdModular: next },
    });
    if (!ok) setAgentsMdModular(!next);
  }, [agentsMdModular]);

  const compress = useCallback(
    async (m: ModuleRow, useLlm: boolean) => {
      setBusyId(m.id);
      const { ok, data } = await apiFetchJson<{ text: string }>("/api/prompts/compress", {
        method: "POST",
        body: { id: m.id, useLlm, cwd: cwd ?? undefined },
      });
      setBusyId(null);
      if (ok && data.text) {
        setModules((prev) =>
          prev.map((x) => (x.id === m.id ? { ...x, compressedText: data.text } : x)),
        );
      }
      void load();
    },
    [cwd, load],
  );

  const resetCompression = useCallback(
    async (m: ModuleRow) => {
      setBusyId(m.id);
      const { ok } = await apiFetchJson("/api/prompts/modules", {
        method: "PUT",
        body: { id: m.id, compressedOverride: null, cwd: cwd ?? undefined },
      });
      setBusyId(null);
      if (ok) {
        setModules((prev) =>
          prev.map((x) => (x.id === m.id ? { ...x, compressedText: undefined } : x)),
        );
      }
      void load();
    },
    [cwd, load],
  );

  const runPreview = useCallback(async () => {
    if (!previewInput.trim()) return;
    setPreviewRunning(true);
    const { ok, data } = await apiFetchJson<PreviewResponse>("/api/prompts/preview-select", {
      method: "POST",
      body: { userInput: previewInput, useLlmSelect: previewUseLlm, cwd: cwd ?? undefined },
    });
    setPreviewRunning(false);
    if (ok) setPreview(data);
  }, [previewInput, previewUseLlm, cwd]);

  const previewSelectedIds = new Set(preview?.selected.map((s) => s.id) ?? []);

  // ── 主视图：模块列表 ──────────────────────────────────────────────────────
  const renderList = () => {
    if (loading) return <div style={hintStyle}>…</div>;
    if (loadError)
      return <div style={{ ...hintStyle, color: "var(--color-error-soft)" }}>{loadError}</div>;
    if (modules.length === 0) return <div style={hintStyle}>{t("promptOpt.empty")}</div>;
    return grouped.map((g) => (
      <div key={g.source} style={{ marginBottom: 10 }}>
        <div style={groupHeaderStyle}>{sourceLabel(g.source)}</div>
        {g.items.map((m) => (
          <div
            key={m.id}
            onClick={() => setSelectedId(m.id)}
            style={rowStyle}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = "var(--bg-hover)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "transparent";
            }}
          >
            <span
              style={{
                width: 7,
                height: 7,
                borderRadius: "50%",
                flexShrink: 0,
                background: CATEGORY_COLOR[m.category] ?? "#94A3B8",
                opacity: m.enabled || m.alwaysOn ? 1 : 0.35,
              }}
            />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={rowTitleStyle}>{m.heading ?? m.id}</div>
              <div style={rowMetaStyle}>
                {m.estimatedTokens} {t("promptOpt.tokens")}
                {m.compressedText ? ` · ${t("promptOpt.compressed")}` : ""}
              </div>
            </div>
            <MiniToggle
              enabled={m.enabled || m.alwaysOn}
              disabled={m.alwaysOn}
              onToggle={(e) => {
                e.stopPropagation();
                void toggleModule(m);
              }}
            />
          </div>
        ))}
      </div>
    ));
  };

  // ── 从视图：模块详情 ──────────────────────────────────────────────────────
  const renderDetail = () => {
    if (!selected) return null;
    const m = selected;
    const original = m.text;
    const compressed = m.compressedText;
    const ratio =
      compressed && original.length > 0
        ? Math.round((1 - compressed.length / original.length) * 100)
        : null;
    const busy = busyId === m.id;
    return (
      <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
        {/* 返回 + 标题 */}
        <div
          style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0, marginBottom: 8 }}
        >
          <button onClick={() => setSelectedId(null)} style={backBtnStyle} title={t("common.back")}>
            ‹
          </button>
          <span
            style={{
              width: 9,
              height: 9,
              borderRadius: "50%",
              flexShrink: 0,
              background: CATEGORY_COLOR[m.category] ?? "#94A3B8",
            }}
          />
          <span
            style={{
              fontSize: 14,
              fontWeight: 600,
              color: "var(--text)",
              minWidth: 0,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {m.heading ?? m.id}
          </span>
          {m.alwaysOn && <span style={badgeStyle}>{t("promptOpt.alwaysOn")}</span>}
        </div>

        {/* 可滚动区 */}
        <div style={{ flex: 1, overflowY: "auto", minHeight: 0, paddingRight: 2 }}>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
            <span style={tagStyle}>{t(`promptOpt.category.${m.category}` as never)}</span>
            {m.tags.map((tag) => (
              <span key={tag} style={tagStyle}>
                #{tag}
              </span>
            ))}
            <span style={tagStyle}>
              {m.estimatedTokens} {t("promptOpt.tokens")}
            </span>
            {ratio !== null && (
              <span
                style={{
                  ...tagStyle,
                  color: "var(--git-added)",
                  borderColor: "color-mix(in srgb, var(--git-added) 40%, transparent)",
                }}
              >
                {t("promptOpt.ratioLabel")} -{ratio}%
              </span>
            )}
          </div>

          {/* 操作 */}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
            <ModalButton variant="primary" disabled={busy} onClick={() => void compress(m, false)}>
              {busy ? t("promptOpt.compressing") : t("promptOpt.compress")}
            </ModalButton>
            <ModalButton variant="secondary" disabled={busy} onClick={() => void compress(m, true)}>
              {t("promptOpt.llmRefine")}
            </ModalButton>
            {compressed && (
              <ModalButton
                variant="danger"
                disabled={busy}
                onClick={() => void resetCompression(m)}
              >
                {t("promptOpt.reset")}
              </ModalButton>
            )}
          </div>

          {/* 原文 / 压缩 对比 */}
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div>
              <div style={diffLabelStyle}>{t("promptOpt.original")}</div>
              <pre style={{ ...codeBlockStyle, color: "var(--text-muted)" }}>{original}</pre>
            </div>
            {compressed && (
              <div>
                <div style={{ ...diffLabelStyle, color: "var(--git-added)" }}>
                  {t("promptOpt.compressed")}
                </div>
                <pre style={{ ...codeBlockStyle, color: "var(--text)" }}>{compressed}</pre>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div style={{ height: "100%", minHeight: 0, display: "flex", flexDirection: "column" }}>
      {/* 概览统计 + AGENTS.md 模块化总闸（仅列表态显示） */}
      {!selected && (
        <div style={summaryBarStyle}>
          {summary && (
            <div style={{ display: "flex", gap: 14 }}>
              <SummaryStat label={t("promptOpt.summaryModules")} value={String(summary.count)} />
              <SummaryStat
                label={t("promptOpt.summaryTokens")}
                value={String(summary.enabledTokens)}
              />
              <SummaryStat
                label={t("promptOpt.summarySaved")}
                value={String(summary.savedTokens)}
                accent="var(--git-added)"
              />
            </div>
          )}
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 12, fontWeight: 500, color: "var(--text)" }}>
              {t("promptOpt.agentsMdModular")}
            </span>
            <MiniToggle enabled={agentsMdModular} onToggle={() => void toggleAgentsMdModular()} />
          </div>
        </div>
      )}

      {/* 主从切换 */}
      <div style={{ flex: 1, overflowY: "auto", minHeight: 0, paddingRight: 2 }}>
        {selected ? renderDetail() : renderList()}
      </div>

      {/* 动态预览（仅列表态） */}
      {!selected && (
        <div style={previewBoxStyle}>
          <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text)", marginBottom: 6 }}>
            {t("promptOpt.previewTitle")}
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "stretch" }}>
            <input
              value={previewInput}
              onChange={(e) => setPreviewInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void runPreview();
              }}
              placeholder={t("promptOpt.previewPlaceholder")}
              style={previewInputStyle}
            />
            <ModalButton
              variant="primary"
              disabled={previewRunning || !previewInput.trim()}
              onClick={() => void runPreview()}
            >
              {previewRunning ? t("promptOpt.previewRunning") : t("promptOpt.previewRun")}
            </ModalButton>
          </div>
          <label style={llmCheckStyle}>
            <input
              type="checkbox"
              checked={previewUseLlm}
              onChange={(e) => setPreviewUseLlm(e.target.checked)}
            />
            {t("promptOpt.useLlm")}
          </label>
          {preview && (
            <div style={{ marginTop: 8 }}>
              <div
                style={{
                  fontSize: 12,
                  color: "var(--git-added)",
                  fontWeight: 600,
                  marginBottom: 6,
                }}
              >
                {t("promptOpt.previewResult", {
                  selected: String(preview.selected.length),
                  saved: String(preview.tokensSaved),
                })}
              </div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {modules
                  .filter((m) => m.enabled || m.alwaysOn)
                  .map((m) => (
                    <span
                      key={m.id}
                      style={{
                        ...tagStyle,
                        opacity: previewSelectedIds.has(m.id) ? 1 : 0.35,
                        borderColor: previewSelectedIds.has(m.id)
                          ? "color-mix(in srgb, var(--git-added) 50%, transparent)"
                          : "var(--border)",
                        color: previewSelectedIds.has(m.id)
                          ? "var(--git-added)"
                          : "var(--text-dim)",
                      }}
                    >
                      {m.heading ?? m.id}
                    </span>
                  ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Small sub-components ──────────────────────────────────────────────────────

function SummaryStat({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      <span style={{ fontSize: 15, fontWeight: 700, color: accent ?? "var(--text)" }}>{value}</span>
      <span style={{ fontSize: 10, color: "var(--text-dim)" }}>{label}</span>
    </div>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const hintStyle: React.CSSProperties = {
  fontSize: 12,
  color: "var(--text-dim)",
  padding: "16px 6px",
  textAlign: "center",
};

const groupHeaderStyle: React.CSSProperties = {
  fontSize: 10,
  fontWeight: 700,
  color: "var(--text-dim)",
  textTransform: "uppercase",
  letterSpacing: 0.5,
  padding: "4px 8px",
};

const rowStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  padding: "6px 8px",
  borderRadius: 6,
  cursor: "pointer",
  transition: "background 0.1s",
};

const rowTitleStyle: React.CSSProperties = {
  fontSize: 12.5,
  color: "var(--text)",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

const rowMetaStyle: React.CSSProperties = {
  fontSize: 10,
  color: "var(--text-dim)",
  fontFamily: "var(--font-mono)",
};

const summaryBarStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 8,
  flexWrap: "wrap",
  paddingBottom: 10,
  marginBottom: 10,
  borderBottom: "1px solid var(--border)",
  flexShrink: 0,
};

const badgeStyle: React.CSSProperties = {
  fontSize: 10,
  fontWeight: 600,
  padding: "1px 6px",
  borderRadius: 4,
  background: "color-mix(in srgb, var(--accent) 15%, transparent)",
  color: "var(--accent)",
  flexShrink: 0,
};

const tagStyle: React.CSSProperties = {
  fontSize: 10,
  padding: "2px 7px",
  borderRadius: 4,
  border: "1px solid var(--border)",
  color: "var(--text-muted)",
  fontFamily: "var(--font-mono)",
};

const diffLabelStyle: React.CSSProperties = {
  fontSize: 10,
  fontWeight: 700,
  color: "var(--text-dim)",
  textTransform: "uppercase",
  letterSpacing: 0.5,
  marginBottom: 4,
};

const codeBlockStyle: React.CSSProperties = {
  fontSize: 11.5,
  lineHeight: 1.55,
  fontFamily: "var(--font-mono)",
  background: "var(--bg-panel)",
  border: "1px solid var(--border)",
  borderRadius: 6,
  padding: "8px 10px",
  margin: 0,
  whiteSpace: "pre-wrap",
  wordBreak: "break-word",
  maxHeight: 220,
  overflowY: "auto",
};

const previewBoxStyle: React.CSSProperties = {
  flexShrink: 0,
  marginTop: 10,
  paddingTop: 10,
  borderTop: "1px solid var(--border)",
};

const previewInputStyle: React.CSSProperties = {
  flex: 1,
  fontSize: 12,
  padding: "6px 10px",
  borderRadius: 6,
  background: "var(--bg-panel)",
  border: "1px solid var(--border)",
  color: "var(--text)",
  outline: "none",
};

const llmCheckStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 6,
  fontSize: 11,
  color: "var(--text-muted)",
  marginTop: 6,
  cursor: "pointer",
};

const backBtnStyle: React.CSSProperties = {
  flexShrink: 0,
  width: 24,
  height: 24,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  borderRadius: 6,
  border: "1px solid var(--border)",
  background: "var(--bg-panel)",
  color: "var(--text-muted)",
  cursor: "pointer",
  fontSize: 16,
  lineHeight: 1,
};

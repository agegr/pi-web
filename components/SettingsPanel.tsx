"use client";

import { useState, useEffect, useCallback } from "react";
import { useTheme } from "@/hooks/useTheme";
import { useI18n } from "@/hooks/useI18n";
import { useAudio } from "@/hooks/useAudio";

interface PiSettings {
  defaultProvider: string | null;
  defaultModel: string | null;
  defaultThinkingLevel: string;
  compactionEnabled: boolean;
  compactionReserveTokens: number | null;
  compactionKeepRecentTokens: number | null;
  retryEnabled: boolean;
  retryMaxRetries: number | null;
  retryBaseDelayMs: number | null;
  branchSummaryReserveTokens: number | null;
  branchSummarySkipPrompt: boolean;
  thinkingBudgetsMinimal: number | null;
  thinkingBudgetsLow: number | null;
  thinkingBudgetsMedium: number | null;
  thinkingBudgetsHigh: number | null;
  steeringMode: string;
  followUpMode: string;
  transport: string;
  httpProxy: string;
  httpIdleTimeoutMs: number;
  websocketConnectTimeoutMs: number;
  shellPath: string;
  shellCommandPrefix: string;
  npmCommand: string[] | null;
  defaultProjectTrust: string;
  sessionDir: string;
  externalEditor: string;
  hideThinkingBlock: boolean;
  quietStartup: boolean;
  collapseChangelog: boolean;
  showImages: boolean;
  imageWidthCells: number;
  clearOnShrink: boolean;
  showTerminalProgress: boolean;
  imageAutoResize: boolean;
  blockImages: boolean;
  editorPaddingX: number;
  outputPad: number;
  autocompleteMaxVisible: number;
  showHardwareCursor: boolean;
  codeBlockIndent: string;
  doubleEscapeAction: string;
  treeFilterMode: string;
  enableSkillCommands: boolean;
  enableInstallTelemetry: boolean;
  enableAnalytics: boolean;
  warningsAnthropicExtraUsage: boolean;
}

interface ModelOption {
  provider: string;
  modelId: string;
  name: string;
}

interface Props {
  onClose: () => void;
  onOpenModels: () => void;
  onOpenSkills: () => void;
  onOpenPlugins: () => void;
  onOpenExtensions: () => void;
  onOpenAgents: () => void;
}

/** Unified settings modal — pi agent config + UI preferences + management shortcuts. */
export function SettingsPanel({
  onClose,
  onOpenModels,
  onOpenSkills,
  onOpenPlugins,
  onOpenExtensions,
  onOpenAgents,
}: Props) {
  const { isDark, toggleTheme } = useTheme();
  const { locale, setLocale, t } = useI18n();
  const { soundEnabled, onSoundToggle } = useAudio();

  const [piSettings, setPiSettings] = useState<PiSettings | null>(null);
  const [models, setModels] = useState<ModelOption[]>([]);
  const [saving, setSaving] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);

  // Load pi settings + model list on mount.
  useEffect(() => {
    fetch("/api/settings")
      .then((r) => {
        if (!r.ok) throw new Error(`Settings load failed: ${r.status}`);
        return r.json();
      })
      .then(setPiSettings)
      .catch((err) => console.error("Failed to load settings:", err));
    fetch("/api/models")
      .then((r) => {
        if (!r.ok) throw new Error(`Models load failed: ${r.status}`);
        return r.json();
      })
      .then((d) => {
        const list: ModelOption[] = [];
        for (const [provider, ids] of Object.entries<unknown>(d.models ?? {})) {
          if (Array.isArray(ids)) {
            for (const id of ids) list.push({ provider, modelId: id, name: id });
          }
        }
        setModels(list);
      })
      .catch((err) => console.error("Failed to load models:", err));
  }, []);

  const saveField = useCallback(async (field: string, value: unknown) => {
    setSaving(true);
    try {
      await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [field]: value }),
      });
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 1500);
    } catch {
      /* ignore */
    }
    setSaving(false);
  }, []);

  const updatePi = (field: keyof PiSettings, value: unknown) => {
    setPiSettings((prev) => (prev ? { ...prev, [field]: value } : prev));
    void saveField(field, value);
  };

  const selectedModelKey =
    piSettings?.defaultProvider && piSettings?.defaultModel
      ? `${piSettings.defaultProvider}/${piSettings.defaultModel}`
      : "";

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1000,
        background: "rgba(0,0,0,0.35)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        style={{
          width: "min(520px, calc(100vw - 32px))",
          maxHeight: "calc(100dvh - 32px)",
          background: "var(--bg)",
          border: "1px solid var(--border)",
          borderRadius: 10,
          display: "flex",
          flexDirection: "column",
          boxShadow: "0 8px 32px rgba(0,0,0,0.18)",
          overflow: "hidden",
        }}
      >
        {/* Header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "12px 18px",
            borderBottom: "1px solid var(--border)",
            flexShrink: 0,
          }}
        >
          <span style={{ fontSize: 15, fontWeight: 700, color: "var(--text)" }}>
            {t("settings.title")}
          </span>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {saving && (
              <span style={{ fontSize: 11, color: "var(--text-dim)" }}>{t("settings.saving")}</span>
            )}
            {savedFlash && (
              <span style={{ fontSize: 11, color: "var(--accent)" }}>✓ {t("settings.saved")}</span>
            )}
            <button
              onClick={onClose}
              style={{
                background: "none",
                border: "none",
                color: "var(--text-muted)",
                cursor: "pointer",
                fontSize: 20,
                lineHeight: 1,
                padding: "2px 6px",
              }}
            >
              ×
            </button>
          </div>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: "auto", padding: "0" }}>
          {/* ===== Section: Agent Configuration ===== */}
          <SectionHeader label={t("settings.agent")} />

          {/* Default model */}
          {piSettings && (
            <Row label={t("settings.defaultModel")} hint={t("settings.defaultModelHint")}>
              <select
                value={selectedModelKey}
                onChange={(e) => {
                  const [provider, modelId] = e.target.value.split("/");
                  updatePi("defaultProvider", provider || null);
                  updatePi("defaultModel", modelId || null);
                  // Save both together
                  void saveField("__batch", {
                    defaultProvider: provider || null,
                    defaultModel: modelId || null,
                  });
                }}
                style={selectStyle}
              >
                <option value="">—</option>
                {models.map((m) => (
                  <option key={`${m.provider}/${m.modelId}`} value={`${m.provider}/${m.modelId}`}>
                    {m.provider}/{m.modelId}
                  </option>
                ))}
              </select>
            </Row>
          )}

          {/* Default thinking level */}
          {piSettings && (
            <Row label={t("settings.defaultThinking")}>
              <select
                value={piSettings.defaultThinkingLevel}
                onChange={(e) => updatePi("defaultThinkingLevel", e.target.value)}
                style={selectStyle}
              >
                {["auto", "off", "minimal", "low", "medium", "high", "xhigh"].map((l) => (
                  <option key={l} value={l}>
                    {l}
                  </option>
                ))}
              </select>
            </Row>
          )}

          {/* Compaction toggle */}
          {piSettings && (
            <ToggleRow
              label={t("settings.compaction")}
              hint={t("settings.compactionHint")}
              checked={piSettings.compactionEnabled}
              onChange={(v) => updatePi("compactionEnabled", v)}
            />
          )}

          {/* Retry toggle */}
          {piSettings && (
            <ToggleRow
              label={t("settings.retry")}
              hint={t("settings.retryHint")}
              checked={piSettings.retryEnabled}
              onChange={(v) => updatePi("retryEnabled", v)}
            />
          )}

          {/* Steering / Follow-up mode */}
          {piSettings && (
            <Row label={t("settings.steering")}>
              <select
                value={piSettings.steeringMode}
                onChange={(e) => updatePi("steeringMode", e.target.value)}
                style={selectStyle}
              >
                <option value="all">all</option>
                <option value="one-at-a-time">one-at-a-time</option>
              </select>
            </Row>
          )}
          {piSettings && (
            <Row label={t("settings.followUp")}>
              <select
                value={piSettings.followUpMode}
                onChange={(e) => updatePi("followUpMode", e.target.value)}
                style={selectStyle}
              >
                <option value="all">all</option>
                <option value="one-at-a-time">one-at-a-time</option>
              </select>
            </Row>
          )}

          {/* Transport */}
          {piSettings && (
            <Row label={t("settings.transport")}>
              <select
                value={piSettings.transport}
                onChange={(e) => updatePi("transport", e.target.value)}
                style={selectStyle}
              >
                <option value="auto">auto</option>
                <option value="sse">sse</option>
                <option value="websocket">websocket</option>
                <option value="websocket-cached">websocket-cached</option>
              </select>
            </Row>
          )}

          {/* HTTP timeout */}
          {piSettings && (
            <Row label={t("settings.httpTimeout")}>
              <input
                type="number"
                value={piSettings.httpIdleTimeoutMs}
                onChange={(e) => updatePi("httpIdleTimeoutMs", parseInt(e.target.value) || 0)}
                style={inputStyle}
              />
            </Row>
          )}

          {/* Shell */}
          {piSettings && (
            <Row label={t("settings.shellPath")}>
              <input
                type="text"
                value={piSettings.shellPath}
                onChange={(e) => updatePi("shellPath", e.target.value)}
                style={inputStyle}
                placeholder="/bin/bash"
              />
            </Row>
          )}
          {piSettings && (
            <Row label={t("settings.shellPrefix")}>
              <input
                type="text"
                value={piSettings.shellCommandPrefix}
                onChange={(e) => updatePi("shellCommandPrefix", e.target.value)}
                style={inputStyle}
              />
            </Row>
          )}
          {piSettings && (
            <Row label={t("settings.npmCommand")}>
              <input
                type="text"
                value={(piSettings.npmCommand ?? []).join(" ")}
                onChange={(e) => updatePi("npmCommand", e.target.value.split(" ").filter(Boolean))}
                style={inputStyle}
                placeholder="npm"
              />
            </Row>
          )}

          {/* Project trust */}
          {piSettings && (
            <Row label={t("settings.trust")}>
              <select
                value={piSettings.defaultProjectTrust}
                onChange={(e) => updatePi("defaultProjectTrust", e.target.value)}
                style={selectStyle}
              >
                <option value="ask">ask</option>
                <option value="always">always</option>
                <option value="never">never</option>
              </select>
            </Row>
          )}

          {/* Hide thinking / Quiet startup */}
          {piSettings && (
            <ToggleRow
              label={t("settings.hideThinking")}
              checked={piSettings.hideThinkingBlock}
              onChange={(v) => updatePi("hideThinkingBlock", v)}
            />
          )}
          {piSettings && (
            <ToggleRow
              label={t("settings.quietStartup")}
              checked={piSettings.quietStartup}
              onChange={(v) => updatePi("quietStartup", v)}
            />
          )}

          {/* Compaction details (read-only sub-fields) */}
          {piSettings &&
            (piSettings.compactionReserveTokens !== null ||
              piSettings.compactionKeepRecentTokens !== null) && (
              <Row
                label={t("settings.compactionReserve")}
                hint={t("settings.compactionKeepRecent")}
              >
                <span
                  style={{ fontSize: 11, color: "var(--text-dim)", fontFamily: "var(--font-mono)" }}
                >
                  {piSettings.compactionReserveTokens ?? "—"} /{" "}
                  {piSettings.compactionKeepRecentTokens ?? "—"}
                </span>
              </Row>
            )}

          {/* Retry details */}
          {piSettings &&
            (piSettings.retryMaxRetries !== null || piSettings.retryBaseDelayMs !== null) && (
              <Row label={t("settings.retryDetails")}>
                <span
                  style={{ fontSize: 11, color: "var(--text-dim)", fontFamily: "var(--font-mono)" }}
                >
                  {piSettings.retryMaxRetries ?? "—"} × / {piSettings.retryBaseDelayMs ?? "—"}ms
                </span>
              </Row>
            )}

          {/* Thinking budgets */}
          {piSettings && piSettings.thinkingBudgetsMedium !== null && (
            <Row label={t("settings.thinkingBudgets")} hint="minimal / low / medium / high">
              <span
                style={{ fontSize: 11, color: "var(--text-dim)", fontFamily: "var(--font-mono)" }}
              >
                {piSettings.thinkingBudgetsMinimal ?? "—"} / {piSettings.thinkingBudgetsLow ?? "—"}{" "}
                / {piSettings.thinkingBudgetsMedium ?? "—"} /{" "}
                {piSettings.thinkingBudgetsHigh ?? "—"}
              </span>
            </Row>
          )}

          {/* Network proxy / WS timeout (read-only) */}
          {piSettings && piSettings.httpProxy && (
            <Row label="HTTP Proxy">
              <span
                style={{ fontSize: 11, color: "var(--text-dim)", fontFamily: "var(--font-mono)" }}
              >
                {piSettings.httpProxy}
              </span>
            </Row>
          )}
          {piSettings && (
            <Row label="WebSocket timeout (ms)">
              <span
                style={{ fontSize: 11, color: "var(--text-dim)", fontFamily: "var(--font-mono)" }}
              >
                {piSettings.websocketConnectTimeoutMs}
              </span>
            </Row>
          )}

          {/* Session dir / External editor (read-only) */}
          {piSettings && piSettings.sessionDir && (
            <Row label="Session dir">
              <span
                style={{ fontSize: 11, color: "var(--text-dim)", fontFamily: "var(--font-mono)" }}
              >
                {piSettings.sessionDir}
              </span>
            </Row>
          )}
          {piSettings && piSettings.externalEditor && (
            <Row label="External editor">
              <span
                style={{ fontSize: 11, color: "var(--text-dim)", fontFamily: "var(--font-mono)" }}
              >
                {piSettings.externalEditor}
              </span>
            </Row>
          )}

          {/* Display — advanced */}
          {piSettings && (
            <ToggleRow
              label={t("settings.collapseChangelog")}
              checked={piSettings.collapseChangelog}
              onChange={(v) => updatePi("collapseChangelog", v)}
            />
          )}
          {piSettings && (
            <ToggleRow
              label={t("settings.showImages")}
              checked={piSettings.showImages}
              onChange={(v) => updatePi("showImages", v)}
            />
          )}
          {piSettings && (
            <ToggleRow
              label={t("settings.imageAutoResize")}
              checked={piSettings.imageAutoResize}
              onChange={(v) => updatePi("imageAutoResize", v)}
            />
          )}
          {piSettings && (
            <ToggleRow
              label={t("settings.blockImages")}
              checked={piSettings.blockImages}
              onChange={(v) => updatePi("blockImages", v)}
            />
          )}
          {piSettings && (
            <ToggleRow
              label={t("settings.showTerminalProgress")}
              checked={piSettings.showTerminalProgress}
              onChange={(v) => updatePi("showTerminalProgress", v)}
            />
          )}
          {piSettings && (
            <ToggleRow
              label={t("settings.clearOnShrink")}
              checked={piSettings.clearOnShrink}
              onChange={(v) => updatePi("clearOnShrink", v)}
            />
          )}
          {piSettings && (
            <ToggleRow
              label={t("settings.enableSkillCommands")}
              checked={piSettings.enableSkillCommands}
              onChange={(v) => updatePi("enableSkillCommands", v)}
            />
          )}
          {piSettings && (
            <Row label={t("settings.imageWidth")}>
              <input
                type="number"
                value={piSettings.imageWidthCells}
                onChange={(e) => updatePi("imageWidthCells", parseInt(e.target.value) || 0)}
                style={inputStyle}
              />
            </Row>
          )}
          {piSettings && (
            <Row label={t("settings.editorPadding")}>
              <input
                type="number"
                value={piSettings.editorPaddingX}
                onChange={(e) => updatePi("editorPaddingX", parseInt(e.target.value) || 0)}
                style={inputStyle}
              />
            </Row>
          )}
          {piSettings && (
            <Row label={t("settings.autocompleteMax")}>
              <input
                type="number"
                value={piSettings.autocompleteMaxVisible}
                onChange={(e) => updatePi("autocompleteMaxVisible", parseInt(e.target.value) || 0)}
                style={inputStyle}
              />
            </Row>
          )}
          {piSettings && (
            <Row label={t("settings.doubleEscape")}>
              <select
                value={piSettings.doubleEscapeAction}
                onChange={(e) => updatePi("doubleEscapeAction", e.target.value)}
                style={selectStyle}
              >
                <option value="fork">fork</option>
                <option value="tree">tree</option>
                <option value="none">none</option>
              </select>
            </Row>
          )}
          {piSettings && (
            <Row label={t("settings.treeFilter")}>
              <select
                value={piSettings.treeFilterMode}
                onChange={(e) => updatePi("treeFilterMode", e.target.value)}
                style={selectStyle}
              >
                <option value="default">default</option>
                <option value="no-tools">no-tools</option>
                <option value="user-only">user-only</option>
                <option value="labeled-only">labeled-only</option>
                <option value="all">all</option>
              </select>
            </Row>
          )}

          {/* Telemetry */}
          {piSettings && (
            <ToggleRow
              label={t("settings.installTelemetry")}
              checked={piSettings.enableInstallTelemetry}
              onChange={(v) => updatePi("enableInstallTelemetry", v)}
            />
          )}
          {piSettings && (
            <ToggleRow
              label={t("settings.analytics")}
              checked={piSettings.enableAnalytics}
              onChange={(v) => updatePi("enableAnalytics", v)}
            />
          )}
          {piSettings && (
            <ToggleRow
              label={t("settings.warnExtraUsage")}
              hint="Anthropic"
              checked={piSettings.warningsAnthropicExtraUsage}
              onChange={(v) => updatePi("warningsAnthropicExtraUsage", v)}
            />
          )}

          {/* ===== Section: Management ===== */}
          <SectionHeader label={t("settings.management")} />
          <ManagementButton
            label={t("settings.openModels") + " (models.json)"}
            onClick={() => {
              onClose();
              onOpenModels();
            }}
          />
          <ManagementButton
            label={t("settings.openSkills")}
            onClick={() => {
              onClose();
              onOpenSkills();
            }}
          />
          <ManagementButton
            label={t("settings.openPlugins")}
            onClick={() => {
              onClose();
              onOpenPlugins();
            }}
          />
          <ManagementButton
            label={t("settings.openExtensions")}
            onClick={() => {
              onClose();
              onOpenExtensions();
            }}
          />
          <ManagementButton
            label={t("settings.openPrompts")}
            onClick={() => {
              onClose();
              onOpenAgents();
            }}
          />

          {/* ===== Section: Preferences ===== */}
          <SectionHeader label={t("settings.preferences")} />

          {/* Theme */}
          <Row label={t("settings.theme")}>
            <div
              style={{
                display: "flex",
                gap: 0,
                borderRadius: 7,
                border: "1px solid var(--border)",
                overflow: "hidden",
              }}
            >
              <button
                onClick={() => {
                  if (isDark) toggleTheme();
                }}
                style={{
                  ...segBtnStyle,
                  background: !isDark ? "var(--bg-selected)" : "none",
                  color: !isDark ? "var(--text)" : "var(--text-muted)",
                  borderRight: "1px solid var(--border)",
                }}
              >
                {t("settings.themeLight")}
              </button>
              <button
                onClick={() => {
                  if (!isDark) toggleTheme();
                }}
                style={{
                  ...segBtnStyle,
                  background: isDark ? "var(--bg-selected)" : "none",
                  color: isDark ? "var(--text)" : "var(--text-muted)",
                }}
              >
                {t("settings.themeDark")}
              </button>
            </div>
          </Row>

          {/* Language */}
          <Row label={t("settings.language")}>
            <div
              style={{
                display: "flex",
                gap: 0,
                borderRadius: 7,
                border: "1px solid var(--border)",
                overflow: "hidden",
              }}
            >
              <button
                onClick={() => setLocale("en")}
                style={{
                  ...segBtnStyle,
                  background: locale === "en" ? "var(--bg-selected)" : "none",
                  color: locale === "en" ? "var(--text)" : "var(--text-muted)",
                  borderRight: "1px solid var(--border)",
                }}
              >
                {t("settings.languageEn")}
              </button>
              <button
                onClick={() => setLocale("zh-CN")}
                style={{
                  ...segBtnStyle,
                  background: locale === "zh-CN" ? "var(--bg-selected)" : "none",
                  color: locale === "zh-CN" ? "var(--text)" : "var(--text-muted)",
                }}
              >
                {t("settings.languageZh")}
              </button>
            </div>
          </Row>

          {/* Sound */}
          <ToggleRow
            label={t("settings.sound")}
            hint={t("settings.soundHint")}
            checked={soundEnabled}
            onChange={onSoundToggle}
          />
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Sub-components
// ============================================================================

const selectStyle: React.CSSProperties = {
  padding: "3px 8px",
  fontSize: 12,
  borderRadius: 5,
  background: "var(--bg)",
  border: "1px solid var(--border)",
  color: "var(--text)",
  outline: "none",
  fontFamily: "var(--font-mono)",
  minWidth: 120,
};

const inputStyle: React.CSSProperties = {
  ...selectStyle,
  width: 160,
};

const segBtnStyle: React.CSSProperties = {
  padding: "4px 12px",
  fontSize: 12,
  fontWeight: 500,
  cursor: "pointer",
  border: "none",
};

function SectionHeader({ label }: { label: string }) {
  return (
    <div
      style={{
        padding: "14px 18px 4px",
        fontSize: 11,
        fontWeight: 700,
        color: "var(--text-dim)",
        textTransform: "uppercase",
        letterSpacing: 0.5,
        borderTop: "1px solid var(--border)",
      }}
    >
      {label}
    </div>
  );
}

function Row({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "8px 18px",
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        <span style={{ fontSize: 13, fontWeight: 500, color: "var(--text)" }}>{label}</span>
        {hint && <span style={{ fontSize: 11, color: "var(--text-dim)" }}>{hint}</span>}
      </div>
      {children}
    </div>
  );
}

function ToggleRow({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "8px 18px",
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        <span style={{ fontSize: 13, fontWeight: 500, color: "var(--text)" }}>{label}</span>
        {hint && <span style={{ fontSize: 11, color: "var(--text-dim)" }}>{hint}</span>}
      </div>
      <button
        onClick={() => onChange(!checked)}
        style={{
          width: 36,
          height: 20,
          borderRadius: 10,
          cursor: "pointer",
          padding: 0,
          border: "none",
          position: "relative",
          background: checked ? "var(--accent)" : "var(--bg-hover)",
          transition: "background 0.15s",
        }}
      >
        <span
          style={{
            position: "absolute",
            top: 2,
            left: checked ? 18 : 2,
            width: 16,
            height: 16,
            borderRadius: "50%",
            background: "#fff",
            transition: "left 0.15s",
          }}
        />
      </button>
    </div>
  );
}

function ManagementButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <div style={{ padding: "4px 18px" }}>
      <button
        onClick={onClick}
        style={{
          width: "100%",
          padding: "8px 12px",
          fontSize: 13,
          fontWeight: 500,
          cursor: "pointer",
          borderRadius: 7,
          background: "var(--bg-hover)",
          border: "1px solid var(--border)",
          color: "var(--text)",
          textAlign: "left",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        {label}
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{ opacity: 0.5 }}
        >
          <polyline points="9 18 15 12 9 6" />
        </svg>
      </button>
    </div>
  );
}

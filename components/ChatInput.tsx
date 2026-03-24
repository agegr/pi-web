"use client";

import React, { useRef, useState, useCallback, useEffect, KeyboardEvent } from "react";

interface ModelOption {
  provider: string;
  modelId: string;
  name: string;
}

interface Props {
  onSend: (message: string) => void;
  onAbort: () => void;
  onSteer?: (message: string) => void;
  onFollowUp?: (message: string) => void;
  isStreaming: boolean;
  model?: { provider: string; modelId: string } | null;
  modelNames?: Record<string, string>;
  modelList?: { id: string; name: string; provider: string }[];
  onModelChange?: (provider: string, modelId: string) => void;
  onCompact?: () => void;
  onAbortCompaction?: () => void;
  isCompacting?: boolean;
  compactError?: string | null;
  toolPreset?: "none" | "default" | "full";
  onToolPresetChange?: (preset: "none" | "default" | "full") => void;
  sessionStats?: { tokens: { input: number; output: number; cacheRead: number; cacheWrite: number } } | null;
  retryInfo?: { attempt: number; maxAttempts: number } | null;
  contextUsage?: { percent: number | null; contextWindow: number; tokens: number | null } | null;
}

function fmtTokens(n: number): string {
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(0)}k`;
  return String(n);
}

const TOOL_PRESETS = ["off", "default", "full"] as const;
const TOOL_PRESET_MAP: Record<"off" | "default" | "full", "none" | "default" | "full"> = { off: "none", default: "default", full: "full" };

export function ChatInput({
  onSend, onAbort, onSteer, onFollowUp, isStreaming, model, modelNames, modelList, onModelChange,
  onCompact, onAbortCompaction, isCompacting, compactError, toolPreset, onToolPresetChange, sessionStats, retryInfo, contextUsage,
}: Props) {
  const [value, setValue] = useState("");
  const [queueMode, setQueueMode] = useState<"steer" | "followup">("steer");
  const [modelDropdownOpen, setModelDropdownOpen] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const handleSend = useCallback(() => {
    const msg = value.trim();
    if (!msg || isStreaming) return;
    onSend(msg);
    setValue("");
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
  }, [value, isStreaming, onSend]);

  const handleQueueSend = useCallback(() => {
    const msg = value.trim();
    if (!msg) return;
    if (queueMode === "steer" && onSteer) {
      onSteer(msg);
    } else if (queueMode === "followup" && onFollowUp) {
      onFollowUp(msg);
    }
    setValue("");
    if (textareaRef.current) textareaRef.current.style.height = "auto";
  }, [value, queueMode, onSteer, onFollowUp]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        if (isStreaming && (onSteer || onFollowUp)) {
          handleQueueSend();
        } else {
          handleSend();
        }
      }
    },
    [isStreaming, onSteer, onFollowUp, handleQueueSend, handleSend]
  );

  const handleInput = useCallback(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = `${Math.min(ta.scrollHeight, 200)}px`;
  }, []);

  // Build model options: prefer modelList (has provider info), fallback to modelNames
  // If multiple providers share the same model id, append provider name to disambiguate
  const modelOptions: ModelOption[] = (() => {
    if (modelList && modelList.length > 0) {
      return modelList.map((m) => ({
        provider: m.provider,
        modelId: m.id,
        name: `${m.name} (${m.provider})`,
      }));
    }
    return Object.entries(modelNames ?? {}).map(([modelId, name]) => ({
      provider: model?.provider ?? "unknown",
      modelId,
      name,
    }));
  })();

  const currentName = model
    ? (modelOptions.find((o) => o.modelId === model.modelId && o.provider === model.provider)?.name ?? model.modelId)
    : modelOptions.length > 0 ? modelOptions[0].name : null;

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setModelDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);



  return (
    <div
      style={{
        flexShrink: 0,
        borderTop: "1px solid var(--border)",
        background: "var(--bg-panel)",
        padding: "10px 16px 12px",
        paddingRight: 52, // 16px base + 36px for ChatMinimap alignment
      }}
    >
      <div style={{ maxWidth: 960, margin: "0 auto" }}>
        {/* Retry banner */}
        {retryInfo && (
          <div style={{
            marginBottom: 8, padding: "5px 10px",
            background: "rgba(234,179,8,0.08)", border: "1px solid rgba(234,179,8,0.25)",
            borderRadius: 6, fontSize: 12, color: "rgba(180,130,0,0.9)",
            display: "flex", alignItems: "center", gap: 6,
          }}>
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
              <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
              <path d="M3 3v5h5" />
            </svg>
            Retrying ({retryInfo.attempt}/{retryInfo.maxAttempts})…
          </div>
        )}
        {/* Main input */}
        <div
          style={{
            display: "flex",
            gap: 8,
            alignItems: "center",
            background: "var(--bg)",
            border: `1px solid ${isStreaming && (onSteer || onFollowUp)
              ? (queueMode === "steer" ? "rgba(234,179,8,0.4)" : "rgba(99,102,241,0.4)")
              : "var(--border)"}`,
            borderRadius: 8,
            padding: "8px 8px 8px 12px",
            transition: "border-color 0.15s",
          }}
        >
          <textarea
            ref={textareaRef}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={handleKeyDown}
            onInput={handleInput}
            placeholder={
              isStreaming && (onSteer || onFollowUp)
                ? (queueMode === "steer" ? "Inject guidance mid-run…" : "Queue a message for after agent finishes…")
                : isStreaming ? "Agent is running…"
                : "Message…"
            }
            rows={1}
            style={{
              flex: 1,
              background: "none",
              border: "none",
              outline: "none",
              resize: "none",
              color: "var(--text)",
              fontSize: 14,
              lineHeight: 1.6,
              fontFamily: "inherit",
              minHeight: 24,
              maxHeight: 200,
              overflow: "auto",
            }}
          />

          {isStreaming ? (
            <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
              {(onSteer || onFollowUp) && (
                <button
                  onClick={handleQueueSend}
                  disabled={!value.trim()}
                  style={{
                    display: "flex", alignItems: "center", gap: 5,
                    padding: "7px 14px",
                    background: value.trim()
                      ? (queueMode === "steer" ? "rgba(234,179,8,0.12)" : "rgba(129,140,248,0.12)")
                      : "none",
                    border: `1px solid ${queueMode === "steer" ? "rgba(234,179,8,0.35)" : "rgba(129,140,248,0.35)"}`,
                    borderRadius: 8,
                    color: value.trim()
                      ? (queueMode === "steer" ? "rgba(180,130,0,1)" : "rgba(99,102,241,1)")
                      : "var(--text-dim)",
                    cursor: value.trim() ? "pointer" : "not-allowed",
                    fontSize: 13, fontWeight: 600, letterSpacing: "-0.01em",
                    transition: "background 0.12s",
                  }}
                >
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="2" y1="7" x2="11" y2="7" /><polyline points="7.5 3 12 7 7.5 11" />
                  </svg>
                  Send
                </button>
              )}
              <button
                onClick={onAbort}
                style={{
                  flexShrink: 0,
                  display: "flex", alignItems: "center", gap: 6,
                  padding: "7px 14px",
                  background: "rgba(239,68,68,0.08)",
                  border: "1px solid rgba(239,68,68,0.3)",
                  borderRadius: 8,
                  color: "#ef4444",
                  cursor: "pointer",
                  fontSize: 13, fontWeight: 600,
                  whiteSpace: "nowrap", letterSpacing: "-0.01em",
                }}
              >
                <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                  <rect x="1.5" y="1.5" width="7" height="7" rx="1.5" fill="currentColor" />
                </svg>
                Stop
              </button>
            </div>
          ) : (
            <button
              onClick={handleSend}
              disabled={!value.trim()}
              style={{
                flexShrink: 0,
                display: "flex", alignItems: "center", gap: 6,
                padding: "7px 14px",
                background: value.trim() ? "var(--accent)" : "var(--bg-panel)",
                border: "none",
                borderRadius: 8,
                color: value.trim() ? "#fff" : "var(--text-dim)",
                cursor: value.trim() ? "pointer" : "not-allowed",
                fontSize: 13,
                fontWeight: 600,
                letterSpacing: "-0.01em",
                boxShadow: value.trim() ? "0 1px 3px rgba(37,99,235,0.25)" : "none",
                transition: "background 0.15s, box-shadow 0.15s",
              }}
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="2" y1="7" x2="11" y2="7" />
                <polyline points="7.5 3 12 7 7.5 11" />
              </svg>
              Send
            </button>
          )}
        </div>

        {/* Bottom bar: left | center (stats) | right */}
        <div style={{ marginTop: 6, display: "flex", alignItems: "center", gap: 8 }}>

          {/* LEFT: model selector (idle) or steer/followup toggle (streaming) */}
          <div style={{ flex: "0 0 auto", display: "flex", alignItems: "center", gap: 6 }}>
            {isStreaming && (onSteer || onFollowUp) ? (
              /* Steer / Follow-up pill toggle */
              <div style={{ display: "flex", border: "1px solid var(--border)", borderRadius: 6, overflow: "hidden" }}>
                {(["steer", "followup"] as const).map((mode, i) => {
                  const active = queueMode === mode;
                  const accent = mode === "steer" ? "rgba(234,179,8,1)" : "rgba(129,140,248,1)";
                  const accentBg = mode === "steer" ? "rgba(234,179,8,0.1)" : "rgba(129,140,248,0.1)";
                  return (
                    <button
                      key={mode}
                      onClick={() => setQueueMode(mode)}
                      title={mode === "steer" ? "Interrupt agent mid-run" : "Queue after agent finishes"}
                      style={{
                        display: "flex", alignItems: "center", gap: 5,
                        padding: "4px 10px",
                        background: active ? accentBg : "none",
                        border: "none",
                        borderLeft: i > 0 ? `1px solid ${active ? "transparent" : "var(--border)"}` : "none",
                        color: active ? accent : "var(--text-dim)",
                        cursor: "pointer",
                        fontSize: 12,
                        fontWeight: active ? 600 : 400,
                        whiteSpace: "nowrap",
                        transition: "background 0.12s, color 0.12s",
                      }}
                    >
                      {mode === "steer" ? (
                        <>
                          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M5 1 L9 5 L5 9" /><line x1="1" y1="5" x2="9" y2="5" />
                          </svg>
                          Steer
                        </>
                      ) : (
                        <>
                          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                            <line x1="5" y1="1" x2="5" y2="6" /><polyline points="2.5 3.5 5 1 7.5 3.5" />
                            <line x1="2" y1="9" x2="8" y2="9" />
                          </svg>
                          Follow-up
                        </>
                      )}
                    </button>
                  );
                })}
              </div>
            ) : (
              /* Model selector */
              modelOptions.length > 0 && currentName && onModelChange && (
                <div ref={dropdownRef} style={{ position: "relative" }}>
                  <button
                    onClick={() => setModelDropdownOpen((v) => !v)}
                    disabled={isStreaming}
                    style={{
                      display: "flex", alignItems: "center", gap: 5,
                      padding: "4px 10px",
                      background: "none",
                      border: "1px solid var(--border)",
                      borderRadius: 5,
                      color: "var(--text-muted)",
                      cursor: isStreaming ? "not-allowed" : "pointer",
                      fontSize: 12,
                      opacity: isStreaming ? 0.5 : 1,
                      transition: "border-color 0.12s, color 0.12s",
                    }}
                    onMouseEnter={(e) => {
                      if (isStreaming) return;
                      e.currentTarget.style.borderColor = "rgba(37,99,235,0.4)";
                      e.currentTarget.style.color = "var(--accent)";
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.borderColor = "var(--border)";
                      e.currentTarget.style.color = "var(--text-muted)";
                    }}
                  >
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="4" y="4" width="16" height="16" rx="2" />
                      <rect x="9" y="9" width="6" height="6" />
                      <line x1="9" y1="1" x2="9" y2="4" /><line x1="15" y1="1" x2="15" y2="4" />
                      <line x1="9" y1="20" x2="9" y2="23" /><line x1="15" y1="20" x2="15" y2="23" />
                      <line x1="20" y1="9" x2="23" y2="9" /><line x1="20" y1="14" x2="23" y2="14" />
                      <line x1="1" y1="9" x2="4" y2="9" /><line x1="1" y1="14" x2="4" y2="14" />
                    </svg>
                    {currentName}
                    <svg width="9" height="9" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{ transform: modelDropdownOpen ? "rotate(180deg)" : "none", transition: "transform 0.15s" }}>
                      <polyline points="2 3.5 5 6.5 8 3.5" />
                    </svg>
                  </button>
                  {modelDropdownOpen && (
                    <div style={{
                      position: "absolute", bottom: "calc(100% + 6px)", left: 0,
                      zIndex: 100, background: "var(--bg)", border: "1px solid var(--border)",
                      borderRadius: 8, boxShadow: "0 -4px 16px rgba(0,0,0,0.10)",
                      overflow: "hidden", minWidth: 160,
                    }}>
                      {modelOptions.map((opt) => {
                        const isActive = opt.modelId === model?.modelId && opt.provider === model?.provider;
                        return (
                          <button
                            key={`${opt.provider}:${opt.modelId}`}
                            onClick={() => { setModelDropdownOpen(false); if (!isActive) onModelChange(opt.provider, opt.modelId); }}
                            style={{
                              display: "flex", alignItems: "center", gap: 8,
                              width: "100%", padding: "8px 12px",
                              background: isActive ? "var(--bg-selected)" : "none",
                              border: "none", borderBottom: "1px solid var(--border)",
                              color: isActive ? "var(--text)" : "var(--text-muted)",
                              cursor: "pointer", fontSize: 12, textAlign: "left",
                              fontWeight: isActive ? 600 : 400,
                            }}
                            onMouseEnter={(e) => { if (!isActive) e.currentTarget.style.background = "var(--bg-hover)"; }}
                            onMouseLeave={(e) => { if (!isActive) e.currentTarget.style.background = "none"; }}
                          >
                            {isActive
                              ? <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="1.5 5 4 7.5 8.5 2.5" /></svg>
                              : <span style={{ width: 10, flexShrink: 0 }} />}
                            {opt.name}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              )
            )}
          </div>

          {/* CENTER: token + context stats */}
          <div style={{ flex: 1, display: "flex", justifyContent: "center" }}>
            {(sessionStats || contextUsage) && (() => {
              const items: React.ReactNode[] = [];
              const tooltipParts: string[] = [];
              if (sessionStats) {
                const t = sessionStats.tokens;
                const total = (t.input || 0) + (t.output || 0) + (t.cacheRead || 0) + (t.cacheWrite || 0);
                if (total) {
                  if (t.input) items.push(
                    <span key="in" style={{ display: "flex", alignItems: "center", gap: 3 }}>
                      <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
                        <line x1="5" y1="8.5" x2="5" y2="1.5" /><polyline points="2 4 5 1.5 8 4" />
                      </svg>
                      {fmtTokens(t.input)}
                    </span>
                  );
                  if (t.output) items.push(
                    <span key="out" style={{ display: "flex", alignItems: "center", gap: 3 }}>
                      <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
                        <line x1="5" y1="1.5" x2="5" y2="8.5" /><polyline points="2 6 5 8.5 8 6" />
                      </svg>
                      {fmtTokens(t.output)}
                    </span>
                  );
                  if (t.cacheRead) items.push(
                    <span key="cache" style={{ display: "flex", alignItems: "center", gap: 3 }}>
                      <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M8.5 5a3.5 3.5 0 1 1-1-2.45" /><polyline points="6.5 1.5 8.5 2.5 7.5 4.5" />
                      </svg>
                      {fmtTokens(t.cacheRead)}
                    </span>
                  );
                  tooltipParts.push(`in: ${t.input?.toLocaleString() ?? 0}  out: ${t.output?.toLocaleString() ?? 0}  cache read: ${t.cacheRead?.toLocaleString() ?? 0}  cache write: ${t.cacheWrite?.toLocaleString() ?? 0}`);
                }
              }
              let ctxColor = "var(--text-dim)";
              if (contextUsage?.contextWindow) {
                const pct = contextUsage.percent;
                if (pct !== null && pct > 90) ctxColor = "#ef4444";
                else if (pct !== null && pct > 70) ctxColor = "rgba(234,179,8,0.9)";
                const ctxStr = pct !== null ? `${pct.toFixed(0)}% / ${fmtTokens(contextUsage.contextWindow)}` : `? / ${fmtTokens(contextUsage.contextWindow)}`;
                items.push(
                  <span key="ctx" style={{ display: "flex", alignItems: "center", gap: 3, color: ctxColor }}>
                    <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M1 9 L1 5 Q1 1 5 1 Q9 1 9 5 L9 9" /><line x1="1" y1="9" x2="9" y2="9" />
                    </svg>
                    {ctxStr}
                  </span>
                );
                tooltipParts.push(`context: ${pct !== null ? pct.toFixed(1) + "%" : "unknown"} of ${contextUsage.contextWindow.toLocaleString()} tokens`);
              }
              if (!items.length) return null;
              return (
                <div title={tooltipParts.join("  |  ")} style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 11, color: "var(--text-dim)", whiteSpace: "nowrap", cursor: "default" }}>
                  {items}
                </div>
              );
            })()}
          </div>

          {/* RIGHT: tools preset + compact */}
          <div style={{ flex: "0 0 auto", display: "flex", alignItems: "center", gap: 6 }}>
            {onToolPresetChange && (
              <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                <span style={{ fontSize: 12, color: "var(--text-dim)" }}>tools</span>
                <div style={{ display: "flex", alignItems: "center", border: "1px solid var(--border)", borderRadius: 5, overflow: "hidden" }}>
                  {TOOL_PRESETS.map((lvl, i) => {
                    const preset = TOOL_PRESET_MAP[lvl];
                    const isActive = (toolPreset ?? "default") === preset;
                    const prevPreset = i > 0 ? TOOL_PRESET_MAP[TOOL_PRESETS[i - 1]] : null;
                    const prevActive = prevPreset !== null && (toolPreset ?? "default") === prevPreset;
                    return (
                      <button key={lvl} onClick={() => !isStreaming && onToolPresetChange(preset)} disabled={isStreaming} title={`Tools: ${lvl}`}
                        style={{
                          padding: "4px 10px", background: isActive ? "var(--bg-selected)" : "none",
                          border: "none", borderLeft: i > 0 ? `1px solid ${isActive || prevActive ? "transparent" : "var(--border)"}` : "none",
                          color: isActive ? "var(--accent)" : "var(--text-dim)",
                          cursor: isStreaming ? "not-allowed" : "pointer",
                          fontSize: 12, fontWeight: isActive ? 600 : 400, opacity: isStreaming ? 0.5 : 1,
                        }}>
                        {lvl}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {onCompact && (
              <div style={{ position: "relative" }}>
                {compactError && (
                  <div style={{
                    position: "absolute", bottom: "calc(100% + 6px)", right: 0,
                    background: "#1f2937", color: "#f87171",
                    fontSize: 11, padding: "4px 8px", borderRadius: 5,
                    whiteSpace: "nowrap", pointerEvents: "none",
                    boxShadow: "0 2px 8px rgba(0,0,0,0.2)", zIndex: 50,
                  }}>
                    {compactError}
                  </div>
                )}
                <button
                  onClick={isCompacting ? onAbortCompaction : onCompact}
                  disabled={isStreaming && !isCompacting}
                  style={{
                    display: "flex", alignItems: "center", gap: 4, padding: "4px 10px",
                    background: "none",
                    border: `1px solid ${isCompacting ? "rgba(239,68,68,0.4)" : "var(--border)"}`,
                    borderRadius: 5,
                    color: isCompacting ? "#ef4444" : "var(--text-muted)",
                    cursor: (isStreaming && !isCompacting) ? "not-allowed" : "pointer",
                    fontSize: 12, opacity: (isStreaming && !isCompacting) ? 0.5 : 1,
                    transition: "border-color 0.12s, color 0.12s",
                  }}
                  onMouseEnter={(e) => {
                    if (isStreaming && !isCompacting) return;
                    e.currentTarget.style.borderColor = isCompacting ? "rgba(239,68,68,0.7)" : "rgba(37,99,235,0.4)";
                    e.currentTarget.style.color = isCompacting ? "#ef4444" : "var(--accent)";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.borderColor = isCompacting ? "rgba(239,68,68,0.4)" : "var(--border)";
                    e.currentTarget.style.color = isCompacting ? "#ef4444" : "var(--text-muted)";
                  }}
                  title={isCompacting ? "Abort compaction" : "Compact context"}
                >
                  {isCompacting ? (
                    <><svg width="10" height="10" viewBox="0 0 10 10" fill="none"><rect x="2" y="2" width="6" height="6" rx="1" fill="currentColor" /></svg>Compacting…</>
                  ) : (
                    <><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="4 14 10 14 10 20" /><polyline points="20 10 14 10 14 4" />
                      <line x1="10" y1="14" x2="3" y2="21" /><line x1="21" y1="3" x2="14" y2="10" />
                    </svg>Compact</>
                  )}
                </button>
              </div>
            )}
          </div>

        </div>
      </div>
    </div>
  );
}

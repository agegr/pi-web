"use client";

import { useRef, useState, useCallback, useEffect, KeyboardEvent } from "react";

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
  thinkingLevel?: string;
  onThinkingLevelChange?: (level: string) => void;
  onCompact?: () => void;
  onAbortCompaction?: () => void;
  isCompacting?: boolean;
  compactError?: string | null;
  onToolsClick?: () => void;
}

const THINKING_LEVELS = ["off", "low", "high"] as const;

export function ChatInput({
  onSend, onAbort, onSteer, onFollowUp, isStreaming, model, modelNames, modelList, onModelChange,
  thinkingLevel, onThinkingLevelChange,
  onCompact, onAbortCompaction, isCompacting, compactError, onToolsClick,
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
  const modelOptions: ModelOption[] = modelList && modelList.length > 0
    ? modelList.map((m) => ({ provider: m.provider, modelId: m.id, name: m.name }))
    : Object.entries(modelNames ?? {}).map(([modelId, name]) => ({
        provider: model?.provider ?? "unknown",
        modelId,
        name,
      }));

  const currentName = model
    ? (modelNames?.[model.modelId] ?? model.modelId)
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
      }}
    >
      <div style={{ maxWidth: 820, margin: "0 auto" }}>
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
              {/* Steer / Follow-up mode toggle + send, only when callbacks available */}
              {(onSteer || onFollowUp) && (
                <>
                  <div style={{ display: "flex", border: "1px solid var(--border)", borderRadius: 5, overflow: "hidden" }}>
                    {(["steer", "followup"] as const).map((mode) => {
                      const active = queueMode === mode;
                      const color = mode === "steer" ? "rgba(234,179,8,0.9)" : "rgba(99,102,241,0.9)";
                      return (
                        <button
                          key={mode}
                          onClick={() => setQueueMode(mode)}
                          title={mode === "steer" ? "Interrupt: inject guidance mid-run" : "Follow-up: queue message for after agent finishes"}
                          style={{
                            padding: "3px 8px",
                            background: active ? (mode === "steer" ? "rgba(234,179,8,0.12)" : "rgba(99,102,241,0.12)") : "none",
                            border: "none",
                            borderRight: mode === "steer" ? "1px solid var(--border)" : "none",
                            color: active ? color : "var(--text-dim)",
                            cursor: "pointer",
                            fontSize: 11,
                            fontWeight: active ? 700 : 400,
                          }}
                        >
                          {mode === "steer" ? "Steer" : "Follow-up"}
                        </button>
                      );
                    })}
                  </div>
                  <button
                    onClick={handleQueueSend}
                    disabled={!value.trim()}
                    style={{
                      display: "flex", alignItems: "center", gap: 5,
                      padding: "5px 12px",
                      background: value.trim()
                        ? (queueMode === "steer" ? "rgba(234,179,8,0.15)" : "rgba(99,102,241,0.12)")
                        : "var(--bg-panel)",
                      border: `1px solid ${queueMode === "steer" ? "rgba(234,179,8,0.35)" : "rgba(99,102,241,0.35)"}`,
                      borderRadius: 7,
                      color: value.trim()
                        ? (queueMode === "steer" ? "rgba(234,179,8,0.9)" : "rgba(99,102,241,0.9)")
                        : "var(--text-dim)",
                      cursor: value.trim() ? "pointer" : "not-allowed",
                      fontSize: 12,
                      fontWeight: 600,
                    }}
                  >
                    Send
                  </button>
                </>
              )}
              {/* Stop button */}
              <button
                onClick={onAbort}
                style={{
                  display: "flex", alignItems: "center", gap: 6,
                  padding: "7px 14px",
                  background: "rgba(239,68,68,0.08)",
                  border: "1px solid rgba(239,68,68,0.35)",
                  borderRadius: 8,
                  color: "#ef4444",
                  cursor: "pointer",
                  fontSize: 13,
                  fontWeight: 600,
                  whiteSpace: "nowrap",
                  letterSpacing: "-0.01em",
                }}
              >
                <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
                  <rect x="2" y="2" width="9" height="9" rx="2" fill="currentColor" />
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

        {/* Bottom bar */}
        <div style={{ marginTop: 6, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            {/* Model selector */}
            {modelOptions.length > 0 && currentName && onModelChange && (
              <div ref={dropdownRef} style={{ position: "relative" }}>
                <button
                  onClick={() => setModelDropdownOpen((v) => !v)}
                  disabled={isStreaming}
                  style={{
                    display: "flex", alignItems: "center", gap: 5,
                    padding: "3px 8px",
                    background: "none",
                    border: "1px solid var(--border)",
                    borderRadius: 5,
                    color: "var(--text-muted)",
                    cursor: isStreaming ? "not-allowed" : "pointer",
                    fontSize: 11,
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
                    position: "absolute",
                    bottom: "calc(100% + 6px)",
                    left: 0,
                    zIndex: 100,
                    background: "var(--bg)",
                    border: "1px solid var(--border)",
                    borderRadius: 8,
                    boxShadow: "0 -4px 16px rgba(0,0,0,0.10)",
                    overflow: "hidden",
                    minWidth: 160,
                  }}>
                    {modelOptions.map((opt) => {
                      const isActive = opt.modelId === model?.modelId;
                      return (
                        <button
                          key={opt.modelId}
                          onClick={() => {
                            setModelDropdownOpen(false);
                            if (!isActive) onModelChange(opt.provider, opt.modelId);
                          }}
                          style={{
                            display: "flex", alignItems: "center", gap: 8,
                            width: "100%",
                            padding: "8px 12px",
                            background: isActive ? "var(--bg-selected)" : "none",
                            border: "none",
                            borderBottom: "1px solid var(--border)",
                            color: isActive ? "var(--text)" : "var(--text-muted)",
                            cursor: "pointer",
                            fontSize: 12,
                            textAlign: "left",
                            fontWeight: isActive ? 600 : 400,
                          }}
                          onMouseEnter={(e) => { if (!isActive) e.currentTarget.style.background = "var(--bg-hover)"; }}
                          onMouseLeave={(e) => { if (!isActive) e.currentTarget.style.background = "none"; }}
                        >
                          {isActive ? (
                            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <polyline points="1.5 5 4 7.5 8.5 2.5" />
                            </svg>
                          ) : <span style={{ width: 10, flexShrink: 0 }} />}
                          {opt.name}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* Thinking level selector */}
            {onThinkingLevelChange && (
              <div style={{ display: "flex", alignItems: "center", gap: 2, border: "1px solid var(--border)", borderRadius: 5, overflow: "hidden" }}>
                {THINKING_LEVELS.map((lvl) => (
                  <button
                    key={lvl}
                    onClick={() => !isStreaming && onThinkingLevelChange(lvl)}
                    disabled={isStreaming}
                    style={{
                      padding: "3px 7px",
                      background: thinkingLevel === lvl ? "var(--bg-selected)" : "none",
                      border: "none",
                      borderRight: lvl !== "high" ? "1px solid var(--border)" : "none",
                      color: thinkingLevel === lvl ? "var(--accent)" : "var(--text-dim)",
                      cursor: isStreaming ? "not-allowed" : "pointer",
                      fontSize: 11,
                      fontWeight: thinkingLevel === lvl ? 600 : 400,
                      opacity: isStreaming ? 0.5 : 1,
                    }}
                    title={`Thinking: ${lvl}`}
                  >
                    {lvl}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            {/* Tools button */}
            {onToolsClick && (
              <button
                onClick={onToolsClick}
                disabled={isStreaming}
                title="Configure active tools"
                style={{
                  display: "flex", alignItems: "center", gap: 4,
                  padding: "3px 8px",
                  background: "none",
                  border: "1px solid var(--border)",
                  borderRadius: 5,
                  color: "var(--text-muted)",
                  cursor: isStreaming ? "not-allowed" : "pointer",
                  fontSize: 11,
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
                  <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>
                </svg>
                Tools
              </button>
            )}

            {/* Compact / Abort compaction button */}
            {onCompact && (
              <div style={{ position: "relative" }}>
                {compactError && (
                  <div style={{
                    position: "absolute", bottom: "calc(100% + 6px)", right: 0,
                    background: "#1f2937", color: "#f87171",
                    fontSize: 11, padding: "4px 8px", borderRadius: 5,
                    whiteSpace: "nowrap", pointerEvents: "none",
                    boxShadow: "0 2px 8px rgba(0,0,0,0.2)",
                    zIndex: 50,
                  }}>
                    {compactError}
                  </div>
                )}
              <button
                onClick={isCompacting ? onAbortCompaction : onCompact}
                disabled={isStreaming && !isCompacting}
                style={{
                  display: "flex", alignItems: "center", gap: 4,
                  padding: "3px 8px",
                  background: "none",
                  border: `1px solid ${isCompacting ? "rgba(239,68,68,0.4)" : "var(--border)"}`,
                  borderRadius: 5,
                  color: isCompacting ? "#ef4444" : "var(--text-muted)",
                  cursor: (isStreaming && !isCompacting) ? "not-allowed" : "pointer",
                  fontSize: 11,
                  opacity: (isStreaming && !isCompacting) ? 0.5 : 1,
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
                  <>
                    <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                      <rect x="2" y="2" width="6" height="6" rx="1" fill="currentColor" />
                    </svg>
                    Compacting…
                  </>
                ) : (
                  <>
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="4 14 10 14 10 20" />
                      <polyline points="20 10 14 10 14 4" />
                      <line x1="10" y1="14" x2="3" y2="21" />
                      <line x1="21" y1="3" x2="14" y2="10" />
                    </svg>
                    Compact
                  </>
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

"use client";

import { useCallback, useEffect, useState } from "react";
import { useIsMobile } from "@/hooks/useIsMobile";

type PublicConfig = {
  enabled: boolean;
  allowedChatIds: string[];
  cwd: string;
  tokenConfigured: boolean;
  tokenHint: string | null;
};

type BridgeStatus = {
  running: boolean;
  botUsername: string | null;
  lastConnectedAt: string | null;
  lastMessageAt: string | null;
  lastError: string | null;
};

type TelegramResponse = {
  config: PublicConfig;
  status: BridgeStatus;
  error?: string;
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  border: "1px solid var(--border)",
  borderRadius: 6,
  background: "var(--bg-panel)",
  color: "var(--text)",
  fontFamily: "var(--font-mono)",
  fontSize: 12,
  padding: "9px 10px",
  outline: "none",
};

function buttonStyle(disabled = false, primary = false): React.CSSProperties {
  return {
    border: primary ? "1px solid var(--accent)" : "1px solid var(--border)",
    borderRadius: 6,
    background: primary ? "var(--accent)" : "var(--bg-panel)",
    color: primary ? "white" : "var(--text)",
    padding: "8px 13px",
    fontSize: 12,
    fontWeight: primary ? 600 : 400,
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.5 : 1,
  };
}
function formatTime(value: string | null): string {
  if (!value) return "Never";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

export function TelegramConfig({ defaultCwd, onClose }: { defaultCwd: string | null; onClose: () => void }) {
  const isMobile = useIsMobile();
  const [config, setConfig] = useState<PublicConfig | null>(null);
  const [status, setStatus] = useState<BridgeStatus | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [token, setToken] = useState("");
  const [chatIds, setChatIds] = useState("");
  const [cwd, setCwd] = useState(defaultCwd ?? "");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const applyResponse = useCallback((data: TelegramResponse) => {
    setConfig(data.config);
    setStatus(data.status);
    setEnabled(data.config.enabled);
    setChatIds(data.config.allowedChatIds.join("\n"));
    setCwd(data.config.cwd || defaultCwd || "");
  }, [defaultCwd]);

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/telegram")
      .then(async (res) => {
        const data = await res.json() as TelegramResponse;
        if (!res.ok || data.error) throw new Error(data.error ?? `HTTP ${res.status}`);
        if (!cancelled) applyResponse(data);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [applyResponse]);

  const testConnection = useCallback(async () => {
    setTesting(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch("/api/telegram", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "test", token: token.trim() || undefined }),
      });
      const data = await res.json() as { bot?: { username: string; name: string }; error?: string };
      if (!res.ok || data.error) throw new Error(data.error ?? `HTTP ${res.status}`);
      setMessage(`Connected to ${data.bot?.name}${data.bot?.username ? ` (@${data.bot.username})` : ""}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setTesting(false);
    }
  }, [token]);

  const save = useCallback(async () => {
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch("/api/telegram", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          enabled,
          token: token.trim() || undefined,
          allowedChatIds: chatIds,
          cwd,
        }),
      });
      const data = await res.json() as TelegramResponse;
      if (!res.ok || data.error) throw new Error(data.error ?? `HTTP ${res.status}`);
      applyResponse(data);
      setToken("");
      setMessage(enabled ? "Telegram bridge saved and started." : "Telegram bridge settings saved.");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }, [applyResponse, chatIds, cwd, enabled, token]);

  const busy = loading || saving || testing;
  const statusColor = status?.running ? "#16a34a" : status?.lastError ? "#ef4444" : "var(--text-dim)";

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
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        style={{
          width: isMobile ? "calc(100vw - 16px)" : 720,
          maxWidth: "calc(100vw - 16px)",
          maxHeight: isMobile ? "calc(100dvh - 16px)" : "82vh",
          background: "var(--bg)",
          border: "1px solid var(--border)",
          borderRadius: 8,
          display: "flex",
          flexDirection: "column",
          boxShadow: "0 8px 32px rgba(0,0,0,0.18)",
          overflow: "hidden",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "13px 18px", borderBottom: "1px solid var(--border)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ width: 28, height: 28, borderRadius: 8, display: "grid", placeItems: "center", background: "rgba(34,158,217,0.14)", color: "#229ED9" }}>
              <svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M21.8 3.6 18.5 20c-.2 1.2-.9 1.5-1.9.9l-5-3.7-2.4 2.3c-.3.3-.5.5-1 .5l.4-5.1 9.2-8.3c.4-.4-.1-.6-.6-.2L5.8 13.5.9 12c-1.1-.3-1.1-1.1.2-1.6L20.3 3c.9-.3 1.7.2 1.5.6Z" />
              </svg>
            </span>
            <div>
              <div style={{ fontSize: 15, fontWeight: 700, color: "var(--text)" }}>Telegram Bridge</div>
              <div style={{ marginTop: 2, fontSize: 11, color: "var(--text-dim)" }}>Talk to Pi from an allow-listed Telegram chat</div>
            </div>
          </div>
          <button onClick={onClose} aria-label="Close" style={{ border: 0, background: "none", color: "var(--text-muted)", cursor: "pointer", fontSize: 20, padding: "2px 6px" }}>×</button>
        </div>

        <div style={{ overflowY: "auto", padding: isMobile ? 15 : 20 }}>
          {loading ? (
            <div style={{ padding: 24, textAlign: "center", color: "var(--text-muted)", fontSize: 12 }}>Loading Telegram settings...</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 16,
                  padding: "12px 14px",
                  border: "1px solid var(--border)",
                  borderRadius: 7,
                  background: "var(--bg-panel)",
                }}
              >
                <div>
                  <div style={{ color: "var(--text)", fontSize: 13, fontWeight: 600 }}>Enable Telegram bridge</div>
                  <div style={{ color: "var(--text-dim)", fontSize: 11, marginTop: 3 }}>Starts secure long polling when Pi Web is running.</div>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={enabled}
                  onClick={() => setEnabled((value) => !value)}
                  style={{
                    width: 40,
                    height: 22,
                    padding: 2,
                    border: 0,
                    borderRadius: 12,
                    cursor: "pointer",
                    background: enabled ? "#229ED9" : "var(--border)",
                    transition: "background 0.15s",
                  }}
                >
                  <span style={{ display: "block", width: 18, height: 18, borderRadius: "50%", background: "white", transform: `translateX(${enabled ? 18 : 0}px)`, transition: "transform 0.15s", boxShadow: "0 1px 3px rgba(0,0,0,.25)" }} />
                </button>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "minmax(0, 1.25fr) minmax(210px, .75fr)", gap: 16 }}>
                <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                  <label>
                    <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text)", marginBottom: 6 }}>Bot token</div>
                    <input
                      type="password"
                      autoComplete="off"
                      value={token}
                      onChange={(event) => setToken(event.target.value)}
                      placeholder={config?.tokenConfigured ? `Saved ${config.tokenHint ?? ""} — leave blank to keep` : "123456789:AA..."}
                      style={inputStyle}
                    />
                    <div style={{ fontSize: 10.5, lineHeight: 1.45, color: "var(--text-dim)", marginTop: 5 }}>
                      Create a bot with @BotFather. The token stays on this machine and is never returned to the browser.
                    </div>
                  </label>

                  <label>
                    <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text)", marginBottom: 6 }}>Allowed chat IDs</div>
                    <textarea
                      value={chatIds}
                      onChange={(event) => setChatIds(event.target.value)}
                      placeholder={"123456789\n-1001234567890"}
                      rows={3}
                      style={{ ...inputStyle, resize: "vertical", minHeight: 72 }}
                    />
                    <div style={{ fontSize: 10.5, lineHeight: 1.45, color: "var(--text-dim)", marginTop: 5 }}>
                      One numeric user or group chat ID per line. Messages from every other chat are ignored.
                    </div>
                  </label>

                  <label>
                    <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text)", marginBottom: 6 }}>Working directory</div>
                    <input value={cwd} onChange={(event) => setCwd(event.target.value)} placeholder="C:\path\to\project" style={inputStyle} />
                    <div style={{ fontSize: 10.5, lineHeight: 1.45, color: "var(--text-dim)", marginTop: 5 }}>
                      Telegram conversations run Pi with this directory. Each allowed chat keeps its own Pi session; send /new to reset it.
                    </div>
                  </label>
                </div>

                <div style={{ border: "1px solid var(--border)", borderRadius: 7, padding: 14, background: "var(--bg-panel)", alignSelf: "start" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 13 }}>
                    <span style={{ width: 8, height: 8, borderRadius: "50%", background: statusColor, boxShadow: status?.running ? `0 0 0 3px color-mix(in srgb, ${statusColor} 18%, transparent)` : "none" }} />
                    <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text)" }}>
                      {status?.running ? "Bridge running" : status?.lastError ? "Bridge error" : "Bridge stopped"}
                    </span>
                  </div>
                  {[
                    ["Bot", status?.botUsername ? `@${status.botUsername}` : "Not connected"],
                    ["Last poll", formatTime(status?.lastConnectedAt ?? null)],
                    ["Last message", formatTime(status?.lastMessageAt ?? null)],
                  ].map(([label, value]) => (
                    <div key={label} style={{ marginBottom: 10 }}>
                      <div style={{ color: "var(--text-dim)", fontSize: 10, textTransform: "uppercase", letterSpacing: ".04em" }}>{label}</div>
                      <div style={{ color: "var(--text-muted)", fontSize: 11, marginTop: 2, overflowWrap: "anywhere" }}>{value}</div>
                    </div>
                  ))}
                  {status?.lastError && (
                    <div style={{ marginTop: 8, padding: 9, borderRadius: 5, background: "rgba(239,68,68,.08)", color: "#ef4444", fontSize: 10.5, lineHeight: 1.45, overflowWrap: "anywhere" }}>
                      {status.lastError}
                    </div>
                  )}
                </div>
              </div>

              {(error || message) && (
                <div style={{ padding: "9px 11px", borderRadius: 6, background: error ? "rgba(239,68,68,.08)" : "rgba(22,163,74,.08)", color: error ? "#ef4444" : "#16a34a", fontSize: 11.5 }}>
                  {error ?? message}
                </div>
              )}
            </div>
          )}
        </div>

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "11px 18px", borderTop: "1px solid var(--border)", background: "var(--bg)" }}>
          <button onClick={() => void testConnection()} disabled={busy || (!token.trim() && !config?.tokenConfigured)} style={buttonStyle(busy || (!token.trim() && !config?.tokenConfigured))}>
            {testing ? "Testing..." : "Test connection"}
          </button>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={onClose} disabled={saving} style={buttonStyle(saving)}>Cancel</button>
            <button onClick={() => void save()} disabled={busy} style={buttonStyle(busy, true)}>
              {saving ? "Saving..." : "Save settings"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

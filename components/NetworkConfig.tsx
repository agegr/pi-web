"use client";

import { useEffect, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { useIsMobile } from "@/hooks/useIsMobile";

interface NetworkStatus {
  effective: {
    source: "environment" | "saved" | "windows-system" | "direct";
    enabled: boolean;
    httpProxy: { value?: string; hasCredentials: boolean };
    httpsProxy: { value?: string; hasCredentials: boolean };
    noProxy: string;
    environmentLocked: boolean;
  };
  saved: { version: 1; enabled: boolean; httpProxy?: string; httpsProxy?: string; noProxy: string } | null;
  windows: {
    available: boolean;
    proxyEnabled: boolean;
    httpProxy?: string;
    httpsProxy?: string;
    noProxy?: string;
    autoConfigUrl?: string;
    autoDetect: boolean;
    error?: string;
  };
}

type TestState =
  | { phase: "idle" }
  | { phase: "testing" }
  | { phase: "success"; status: number; latencyMs: number }
  | { phase: "error"; message: string };

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "7px 9px",
  background: "var(--bg-panel)",
  border: "1px solid var(--border)",
  borderRadius: 5,
  color: "var(--text)",
  fontSize: 12,
  fontFamily: "var(--font-mono)",
  outline: "none",
};

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 11, color: "var(--text-muted)" }}>{label}{children}</label>;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ display: "flex", flexDirection: "column", gap: 10, padding: 14, border: "1px solid var(--border)", borderRadius: 8 }}>
      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase", color: "var(--text-muted)" }}>{title}</div>
      {children}
    </section>
  );
}

function Value({ children }: { children?: React.ReactNode }) {
  return <div style={{ padding: "6px 8px", background: "var(--bg)", borderRadius: 5, color: "var(--text)", fontSize: 12, overflowWrap: "anywhere" }}>{children || "—"}</div>;
}

export function NetworkConfig({ onClose }: { onClose: () => void }) {
  const isMobile = useIsMobile();
  const { t } = useI18n();
  const [status, setStatus] = useState<NetworkStatus | null>(null);
  const [enabled, setEnabled] = useState(true);
  const [httpProxy, setHttpProxy] = useState("");
  const [httpsProxy, setHttpsProxy] = useState("");
  const [noProxy, setNoProxy] = useState("localhost,127.0.0.1,::1");
  const [target, setTarget] = useState("anthropic");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [testState, setTestState] = useState<TestState>({ phase: "idle" });

  const load = async () => {
    setLoading(true);
    setMessage(null);
    try {
      const response = await fetch("/api/network-config");
      const data = await response.json() as NetworkStatus & { error?: string };
      if (!response.ok || data.error) throw new Error(data.error ?? `HTTP ${response.status}`);
      setStatus(data);
      const editable = data.saved ?? (data.effective.source === "windows-system" ? {
        enabled: data.effective.enabled,
        httpProxy: data.effective.httpProxy.value,
        httpsProxy: data.effective.httpsProxy.value,
        noProxy: data.effective.noProxy,
      } : {
        enabled: true,
        httpProxy: "",
        httpsProxy: "",
        noProxy: data.effective.noProxy,
      });
      setEnabled(editable.enabled);
      setHttpProxy(editable.httpProxy ?? "");
      setHttpsProxy(editable.httpsProxy ?? "");
      setNoProxy(editable.noProxy);
    } catch (error) {
      setMessage(String(error));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const requestBody = () => ({ enabled, httpProxy, httpsProxy, noProxy });

  const save = async () => {
    setSaving(true);
    setMessage(null);
    try {
      const response = await fetch("/api/network-config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody()),
      });
      const data = await response.json() as NetworkStatus & { error?: string };
      if (!response.ok || data.error) throw new Error(data.error ?? `HTTP ${response.status}`);
      setStatus(data);
      setMessage(t("network.saved"));
    } catch (error) {
      setMessage(String(error));
    } finally {
      setSaving(false);
    }
  };

  const clear = async () => {
    setSaving(true);
    setMessage(null);
    try {
      const response = await fetch("/api/network-config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "clear" }),
      });
      const data = await response.json() as NetworkStatus & { error?: string };
      if (!response.ok || data.error) throw new Error(data.error ?? `HTTP ${response.status}`);
      setStatus(data);
      setEnabled(data.effective.enabled);
      setHttpProxy(data.effective.httpProxy.value ?? "");
      setHttpsProxy(data.effective.httpsProxy.value ?? "");
      setNoProxy(data.effective.noProxy);
      setMessage(t("network.cleared"));
    } catch (error) {
      setMessage(String(error));
    } finally {
      setSaving(false);
    }
  };

  const test = async () => {
    setTestState({ phase: "testing" });
    try {
      const response = await fetch("/api/network-config/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...requestBody(), target }),
      });
      const data = await response.json() as { ok?: boolean; error?: string; status?: number; latencyMs?: number };
      if (!response.ok || !data.ok || data.status === undefined || data.latencyMs === undefined) {
        throw new Error(data.error ?? `HTTP ${response.status}`);
      }
      setTestState({ phase: "success", status: data.status, latencyMs: data.latencyMs });
    } catch (error) {
      setTestState({ phase: "error", message: String(error) });
    }
  };

  const sourceLabel = status ? t(`network.source.${status.effective.source}`) : "";
  const pacOnly = Boolean(status?.windows.available && !status.windows.proxyEnabled && (status.windows.autoConfigUrl || status.windows.autoDetect));
  const locked = Boolean(status?.effective.environmentLocked);

  return (
    <div role="dialog" aria-modal="true" aria-label={t("network.title")} onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }} style={{ position: "fixed", inset: 0, zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: isMobile ? 8 : 24, background: "rgba(0,0,0,.55)" }}>
      <div style={{ width: "min(760px, 100%)", maxHeight: "min(860px, 94vh)", display: "flex", flexDirection: "column", background: "var(--bg-panel)", border: "1px solid var(--border)", borderRadius: 12, boxShadow: "0 22px 70px rgba(0,0,0,.35)" }}>
        <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 16px", borderBottom: "1px solid var(--border)" }}>
          <div><div style={{ fontSize: 15, fontWeight: 700 }}>{t("network.title")}</div><div style={{ marginTop: 3, fontSize: 11, color: "var(--text-muted)" }}>{t("network.subtitle")}</div></div>
          <button onClick={onClose} aria-label={t("network.close")} style={{ border: 0, background: "none", color: "var(--text-muted)", cursor: "pointer", fontSize: 22 }}>×</button>
        </header>

        <div style={{ overflow: "auto", padding: 16, display: "flex", flexDirection: "column", gap: 14 }}>
          {loading ? <div style={{ color: "var(--text-muted)" }}>{t("network.loading")}</div> : status && <>
            <Section title={t("network.effective")}>
              <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "140px 1fr", gap: 8, alignItems: "center" }}>
                <span style={{ color: "var(--text-muted)", fontSize: 11 }}>{t("network.source")}</span><Value>{sourceLabel}</Value>
                <span style={{ color: "var(--text-muted)", fontSize: 11 }}>HTTP</span><Value>{status.effective.httpProxy.value}</Value>
                <span style={{ color: "var(--text-muted)", fontSize: 11 }}>HTTPS</span><Value>{status.effective.httpsProxy.value}</Value>
                <span style={{ color: "var(--text-muted)", fontSize: 11 }}>NO_PROXY</span><Value>{status.effective.noProxy}</Value>
              </div>
              {locked && <div style={{ color: "#d97706", fontSize: 12 }}>{t("network.environmentLocked")}</div>}
            </Section>

            <Section title={t("network.windowsDetection")}>
              <div style={{ fontSize: 12, color: "var(--text-muted)" }}>{status.windows.available ? t("network.windowsAvailable") : status.windows.error ?? t("network.windowsUnavailable")}</div>
              <Value>{status.windows.httpProxy ?? status.windows.httpsProxy}</Value>
              {status.windows.autoConfigUrl && <><div style={{ fontSize: 11, color: "var(--text-muted)" }}>PAC</div><Value>{status.windows.autoConfigUrl}</Value></>}
              {status.windows.autoDetect && <div style={{ fontSize: 12, color: "var(--text-muted)" }}>{t("network.wpadDetected")}</div>}
              {pacOnly && <div style={{ padding: 9, borderRadius: 6, background: "rgba(217,119,6,.12)", color: "#d97706", fontSize: 12 }}>{t("network.pacWarning")}</div>}
            </Section>

            <Section title={t("network.override")}>
              <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12 }}><input type="checkbox" checked={enabled} disabled={locked} onChange={(e) => setEnabled(e.target.checked)} />{t("network.enableOverride")}</label>
              <Field label={t("network.httpProxy")}><input style={inputStyle} value={httpProxy} disabled={locked || !enabled} placeholder="http://proxy.company:8080" onChange={(e) => setHttpProxy(e.target.value)} /></Field>
              <Field label={t("network.httpsProxy")}><input style={inputStyle} value={httpsProxy} disabled={locked || !enabled} placeholder="http://proxy.company:8080" onChange={(e) => setHttpsProxy(e.target.value)} /></Field>
              <Field label="NO_PROXY"><input style={inputStyle} value={noProxy} disabled={locked} onChange={(e) => setNoProxy(e.target.value)} /></Field>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
                <select value={target} onChange={(e) => setTarget(e.target.value)} style={{ ...inputStyle, width: "auto", minWidth: 130 }}><option value="anthropic">Anthropic</option><option value="openai">OpenAI</option><option value="google">Google</option></select>
                <button onClick={() => void test()} disabled={testState.phase === "testing"} style={{ padding: "7px 12px", border: "1px solid var(--border)", borderRadius: 6, background: "var(--bg)", color: "var(--text)", cursor: "pointer" }}>{testState.phase === "testing" ? t("network.testing") : t("network.test")}</button>
                {testState.phase === "success" && <span style={{ color: "#16a34a", fontSize: 12 }}>{t("network.testSuccess")} · HTTP {testState.status} · {testState.latencyMs}ms</span>}
                {testState.phase === "error" && <span style={{ color: "#ef4444", fontSize: 12 }}>{testState.message}</span>}
              </div>
            </Section>
          </>}
          {message && <div style={{ color: message === t("network.saved") || message === t("network.cleared") ? "#16a34a" : "#ef4444", fontSize: 12 }}>{message}</div>}
        </div>

        <footer style={{ padding: "12px 16px", borderTop: "1px solid var(--border)", display: "flex", justifyContent: "flex-end", flexWrap: "wrap", gap: 8 }}>
          <button onClick={() => void clear()} disabled={saving || locked} style={{ padding: "7px 11px", border: "1px solid rgba(239,68,68,.3)", borderRadius: 6, background: "none", color: "#ef4444", cursor: "pointer" }}>{t("network.clear")}</button>
          <button onClick={onClose} style={{ padding: "7px 11px", border: "1px solid var(--border)", borderRadius: 6, background: "none", color: "var(--text)", cursor: "pointer" }}>{t("network.cancel")}</button>
          <button onClick={() => void save()} disabled={saving || locked} style={{ padding: "7px 12px", border: 0, borderRadius: 6, background: "var(--accent)", color: "white", cursor: "pointer", opacity: saving || locked ? .5 : 1 }}>{saving ? t("network.saving") : t("network.save")}</button>
        </footer>
      </div>
    </div>
  );
}

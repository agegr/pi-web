"use client";

import { useEffect, useRef, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { getWebUrlLabel, normalizeWebUrl } from "@/lib/web-url";

interface Props {
  url: string;
  onNavigate: (url: string, label: string) => void;
}

export function WebViewer({ url, onNavigate }: Props) {
  const { t } = useI18n();
  const [input, setInput] = useState(url);
  const [error, setError] = useState<string | null>(null);
  const [frameKey, setFrameKey] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setInput(url);
    setError(null);
    if (!url) requestAnimationFrame(() => inputRef.current?.focus());
  }, [url]);

  const navigate = () => {
    const nextUrl = normalizeWebUrl(input);
    if (!nextUrl) {
      setError(t("web.invalidUrl"));
      return;
    }
    setInput(nextUrl);
    setError(null);
    onNavigate(nextUrl, getWebUrlLabel(nextUrl));
  };

  const openExternal = () => {
    if (!url) return;
    window.open(url, "_blank", "noopener,noreferrer");
  };

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", minWidth: 0 }}>
      <form
        onSubmit={(event) => { event.preventDefault(); navigate(); }}
        style={{
          display: "flex", alignItems: "center", gap: 6, minHeight: 40, padding: "5px 8px",
          borderBottom: "1px solid var(--border)", background: "var(--bg-panel)",
        }}
      >
        <input
          ref={inputRef}
          type="text"
          inputMode="url"
          value={input}
          onChange={(event) => { setInput(event.target.value); setError(null); }}
          placeholder={t("web.addressPlaceholder")}
          aria-label={t("web.address")}
          spellCheck={false}
          style={{
            flex: 1, minWidth: 0, height: 28, padding: "0 8px", border: "1px solid var(--border)",
            borderRadius: 4, outline: "none", background: "var(--bg)", color: "var(--text)",
            fontFamily: "var(--font-mono)", fontSize: 12,
          }}
        />
        <button
          type="submit"
          title={t("web.go")}
          aria-label={t("web.go")}
          style={buttonStyle}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="m9 18 6-6-6-6" /><path d="M3 12h12" />
          </svg>
        </button>
        <button
          type="button"
          onClick={() => setFrameKey((key) => key + 1)}
          disabled={!url}
          title={t("web.reload")}
          aria-label={t("web.reload")}
          style={{ ...buttonStyle, opacity: url ? 1 : 0.45, cursor: url ? "pointer" : "default" }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M20 11a8.1 8.1 0 0 0-15.5-2M4 5v4h4" /><path d="M4 13a8.1 8.1 0 0 0 15.5 2M20 19v-4h-4" />
          </svg>
        </button>
        <button
          type="button"
          onClick={openExternal}
          disabled={!url}
          title={t("web.openExternal")}
          aria-label={t("web.openExternal")}
          style={{ ...buttonStyle, opacity: url ? 1 : 0.45, cursor: url ? "pointer" : "default" }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M14 3h7v7" /><path d="m21 3-9 9" /><path d="M19 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h6" />
          </svg>
        </button>
      </form>
      {error && <div role="alert" style={{ padding: "6px 10px", color: "#dc2626", fontSize: 12, borderBottom: "1px solid var(--border)" }}>{error}</div>}
      {url ? (
        <iframe
          key={`${url}:${frameKey}`}
          src={url}
          title={getWebUrlLabel(url)}
          sandbox="allow-downloads allow-forms allow-popups allow-same-origin allow-scripts"
          style={{ flex: 1, minHeight: 0, width: "100%", border: "none", background: "white" }}
        />
      ) : (
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: 24, color: "var(--text-muted)", fontSize: 12, textAlign: "center" }}>
          {t("web.enterAddress")}
        </div>
      )}
      {url && (
        <div style={{ padding: "5px 10px", borderTop: "1px solid var(--border)", color: "var(--text-dim)", fontSize: 11 }}>
          {t("web.embedNotice")}
        </div>
      )}
    </div>
  );
}

const buttonStyle = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  width: 28,
  height: 28,
  padding: 0,
  border: "1px solid var(--border)",
  borderRadius: 4,
  background: "var(--bg)",
  color: "var(--text-muted)",
  cursor: "pointer",
  flexShrink: 0,
} as const;

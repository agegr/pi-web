"use client";

import { createElement, useEffect, useRef, useState } from "react";
import { isDesktopApp } from "@/lib/desktop";
import { useI18n } from "@/hooks/useI18n";
import { getWebUrlLabel, normalizeWebUrl } from "@/lib/web-url";

interface Props {
  url: string;
  onNavigate: (url: string, label: string) => void;
}

interface NativeWebViewElement extends HTMLElement {
  getURL(): string;
  reload(): void;
  src: string;
}

interface NativeWebPanelProps extends Props {
  webviewRef: React.RefObject<NativeWebViewElement | null>;
}

/**
 * An Electron webview is a separate top-level browsing context, rather than an
 * iframe. That permits sites such as GitHub that send X-Frame-Options: DENY
 * and lets their first-party Electron cookie partition retain login state.
 */
function NativeWebPanel({ url, onNavigate, webviewRef }: NativeWebPanelProps) {
  // `src` must not be controlled directly by React. A guest navigation updates
  // the tab URL through onNavigate; reflecting that update straight back to a
  // <webview src=…> issues a second load and interrupts multi-step SSO redirects.
  const initialUrlRef = useRef(url);
  const expectedUrlRef = useRef(url);

  useEffect(() => {
    const webview = webviewRef.current;
    if (!webview || url === expectedUrlRef.current) return;

    expectedUrlRef.current = url;
    const currentUrl = normalizeWebUrl(webview.getURL());
    if (currentUrl !== url) webview.src = url;
  }, [url, webviewRef]);

  useEffect(() => {
    const webview = webviewRef.current;
    if (!webview) return;

    const syncLocation = () => {
      const currentUrl = normalizeWebUrl(webview.getURL());
      if (!currentUrl) return;
      expectedUrlRef.current = currentUrl;
      onNavigate(currentUrl, getWebUrlLabel(currentUrl));
    };
    webview.addEventListener("did-navigate", syncLocation);
    webview.addEventListener("did-navigate-in-page", syncLocation);
    return () => {
      webview.removeEventListener("did-navigate", syncLocation);
      webview.removeEventListener("did-navigate-in-page", syncLocation);
    };
  }, [onNavigate, webviewRef]);

  // React's DOM types intentionally do not include Electron's <webview> tag.
  // createElement keeps the custom element contained to this desktop-only path.
  return createElement("webview", {
    ref: webviewRef,
    src: initialUrlRef.current,
    partition: "persist:pi-web-web",
    allowpopups: "true",
    "aria-label": getWebUrlLabel(url),
    style: { flex: 1, minHeight: 0, width: "100%", border: "none", background: "white" },
  });
}

export function WebViewer({ url, onNavigate }: Props) {
  const { t } = useI18n();
  const [input, setInput] = useState(url);
  const [error, setError] = useState<string | null>(null);
  const [frameKey, setFrameKey] = useState(0);
  // Start false for server/client hydration parity. The Electron preload makes
  // this true immediately after mount, replacing only the framed page.
  const [desktop, setDesktop] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const webviewRef = useRef<NativeWebViewElement>(null);

  useEffect(() => {
    setDesktop(isDesktopApp());
  }, []);

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

  const reload = () => {
    if (desktop && webviewRef.current) {
      webviewRef.current.reload();
      return;
    }
    setFrameKey((key) => key + 1);
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
          onClick={reload}
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
        desktop ? (
          <NativeWebPanel url={url} onNavigate={onNavigate} webviewRef={webviewRef} />
        ) : (
          <iframe
            key={`${url}:${frameKey}`}
            src={url}
            title={getWebUrlLabel(url)}
            // Cross-origin frames already cannot touch this origin, so a tight sandbox buys
            // little security but does break sign-in: popups inherit the sandbox (OAuth/SSO
            // windows come up crippled) and the Storage Access API is unavailable, so
            // SameSite=Lax session cookies from other Chrome tabs are never sent.
            sandbox="allow-downloads allow-forms allow-modals allow-popups allow-popups-to-escape-sandbox allow-same-origin allow-scripts allow-storage-access-by-user-activation"
            style={{ flex: 1, minHeight: 0, width: "100%", border: "none", background: "white" }}
          />
        )
      ) : (
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: 24, color: "var(--text-muted)", fontSize: 12, textAlign: "center" }}>
          {t("web.enterAddress")}
        </div>
      )}
      {url && !desktop && (
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

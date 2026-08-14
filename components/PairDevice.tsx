"use client";

import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { useI18n } from "@/hooks/useI18n";

interface PairInfo {
  url: string;
  hostname: string;
  port: string;
  authRequired: boolean;
  warning?: string;
  username?: string;
}

interface PairPassword {
  password: string | null;
  source: "env" | "runtime";
  regeneratable: boolean;
}

interface RegenerateResponse {
  password: string;
}

/**
 * Modal that shows the desktop operator a QR code their phone can scan to
 * open pi-web on the same network. Mirrors the established dialog pattern
 * (`components/ProjectTrustDialog.tsx`): backdrop click closes, `role=dialog`
 * + `aria-modal`, inline styles, CSS variables for theming.
 */
export function PairDevice({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  const [info, setInfo] = useState<PairInfo | null>(null);
  const [pairUrl, setPairUrl] = useState<string | null>(null);
  const [qrSvg, setQrSvg] = useState<string | null>(null);
  const [password, setPassword] = useState<string | null>(null);
  const [regeneratable, setRegeneratable] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState<"url" | "password" | "username" | null>(null);

  async function copyValue(value: string, which: "url" | "password" | "username") {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(which);
      window.setTimeout(
        () => setCopied((current) => (current === which ? null : current)),
        1500,
      );
    } catch {
      /* clipboard blocked — ignore, user can long-press */
    }
  }

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [infoResponse, passwordResponse, tokenResponse] = await Promise.all([
          fetch("/api/pair-info", { cache: "no-store" }),
          fetch("/api/pair-password", { cache: "no-store" }),
          fetch("/api/pair-tokens", { cache: "no-store" }),
        ]);
        if (!infoResponse.ok) throw new Error(`HTTP ${infoResponse.status}`);
        const data = (await infoResponse.json()) as PairInfo;
        const passwordData = passwordResponse.ok
          ? ((await passwordResponse.json()) as PairPassword)
          : { password: null, source: "runtime" as const, regeneratable: false };
        const tokenData = tokenResponse.ok
          ? ((await tokenResponse.json()) as { url: string; expiresAt: number })
          : null;
        if (cancelled) return;
        setInfo(data);
        setPassword(passwordData.password);
        setRegeneratable(passwordData.regeneratable);
        // QR encodes the one-time-token URL so the phone lands already
        // authenticated; fall back to the bare URL if the token endpoint
        // failed for any reason.
        const encodedUrl = tokenData?.url ?? data.url;
        setPairUrl(encodedUrl);
        const svg = await QRCode.toString(encodedUrl, {
          type: "svg",
          margin: 1,
          color: { dark: "#000000", light: "#ffffff" },
          errorCorrectionLevel: "M",
        });
        if (!cancelled) setQrSvg(svg);
      } catch (cause) {
        if (!cancelled) {
          setError(cause instanceof Error ? cause.message : String(cause));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function regenerate() {
    setBusy(true);
    setError(null);
    try {
      // Refresh both the password and the QR in parallel — clicking
      // "Regenerate" should invalidate both the visible PIN and any
      // already-scanned token, so a fresh scan is required.
      const [passwordResponse, tokenResponse] = await Promise.all([
        fetch("/api/pair-password/regenerate", { method: "POST", cache: "no-store" }),
        fetch("/api/pair-tokens", { cache: "no-store" }),
      ]);
      if (!passwordResponse.ok) throw new Error(`HTTP ${passwordResponse.status}`);
      if (!tokenResponse.ok) throw new Error(`HTTP ${tokenResponse.status}`);
      const passwordData = (await passwordResponse.json()) as RegenerateResponse;
      const tokenData = (await tokenResponse.json()) as { url: string; expiresAt: number };
      setPassword(passwordData.password);
      const svg = await QRCode.toString(tokenData.url, {
        type: "svg",
        margin: 1,
        color: { dark: "#000000", light: "#ffffff" },
        errorCorrectionLevel: "M",
      });
      setQrSvg(svg);
      setPairUrl(tokenData.url);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  const showPasswordSection = password !== null || info?.authRequired;
  const username = info?.username ?? "pi";

  return (
    <div
      role="presentation"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1100,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
        background: "rgba(0,0,0,0.4)",
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="pair-device-title"
        style={{
          width: 420,
          maxWidth: "100%",
          border: "1px solid var(--border)",
          borderRadius: 10,
          background: "var(--bg-panel)",
          boxShadow: "0 12px 36px rgba(0,0,0,0.24)",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "12px 16px",
            borderBottom: "1px solid var(--border)",
          }}
        >
          <h2
            id="pair-device-title"
            style={{ margin: 0, fontSize: 14, fontWeight: 600, color: "var(--text)" }}
          >
            {t("pair.title")}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("i18n.close")}
            title={t("i18n.close")}
            style={{
              background: "transparent",
              border: "none",
              color: "var(--text-muted)",
              fontSize: 20,
              cursor: "pointer",
              padding: 0,
              lineHeight: 1,
            }}
          >
            ×
          </button>
        </div>

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 14,
            padding: "20px 16px 16px",
          }}
        >
          {error ? (
            <p style={{ color: "#dc2626", fontSize: 13, margin: 0 }}>
              {t("pair.error")}: {error}
            </p>
          ) : !info || !qrSvg ? (
            <p style={{ color: "var(--text-muted)", fontSize: 13, margin: 0 }}>
              {t("pair.loading")}
            </p>
          ) : (
            <>
              <div
                style={{
                  padding: 12,
                  background: "#ffffff",
                  borderRadius: 8,
                  border: "1px solid var(--border)",
                  width: 220,
                  height: 220,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
                dangerouslySetInnerHTML={{ __html: qrSvg }}
              />
              <p
                style={{
                  margin: 0,
                  fontSize: 12,
                  color: "var(--text-muted)",
                  textAlign: "center",
                  maxWidth: 320,
                }}
              >
                {t("pair.scanWithPhone")}
              </p>

              {info.warning && (
                <p
                  style={{
                    margin: 0,
                    padding: "6px 10px",
                    background: "#fef3c7",
                    border: "1px solid #fbbf24",
                    borderRadius: 5,
                    color: "#92400e",
                    fontSize: 11,
                    lineHeight: 1.4,
                    textAlign: "center",
                  }}
                >
                  {t("pair.noHostnameWarning")}
                </p>
              )}

              <div style={{ width: "100%", display: "flex", flexDirection: "column", gap: 6 }}>
                <span style={{ fontSize: 11, color: "var(--text-dim)" }}>
                  {t("pair.urlLabel")}
                </span>
                <div style={{ display: "flex", gap: 6 }}>
                  <code
                    style={{
                      flex: 1,
                      padding: "6px 8px",
                      border: "1px solid var(--border)",
                      borderRadius: 5,
                      background: "var(--bg)",
                      color: "var(--text)",
                      fontFamily: "var(--font-mono)",
                      fontSize: 12,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {pairUrl ?? info.url}
                  </code>
                  <button
                    type="button"
                    onClick={() => void copyValue(pairUrl ?? info.url, "url")}
                    style={{
                      padding: "0 10px",
                      border: "1px solid var(--border)",
                      borderRadius: 5,
                      background: "var(--bg-hover)",
                      color: "var(--text)",
                      cursor: "pointer",
                      fontSize: 12,
                      whiteSpace: "nowrap",
                    }}
                  >
                    {copied === "url" ? t("pair.copied") : t("pair.copy")}
                  </button>
                </div>
              </div>

              <div
                style={{
                  width: "100%",
                  display: "flex",
                  flexDirection: "column",
                  gap: 6,
                }}
              >
                <span style={{ fontSize: 11, color: "var(--text-dim)" }}>
                  {t("pair.usernameLabel")}
                </span>
                <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  <code
                    style={{
                      flex: 1,
                      padding: "6px 8px",
                      border: "1px solid var(--border)",
                      borderRadius: 5,
                      background: "var(--bg)",
                      color: "var(--text)",
                      fontFamily: "var(--font-mono)",
                      fontSize: 13,
                      userSelect: "all",
                    }}
                  >
                    {username}
                  </code>
                  <button
                    type="button"
                    onClick={() => void copyValue(username, "username")}
                    style={{
                      padding: "0 10px",
                      border: "1px solid var(--border)",
                      borderRadius: 5,
                      background: "var(--bg-hover)",
                      color: "var(--text)",
                      cursor: "pointer",
                      fontSize: 12,
                      whiteSpace: "nowrap",
                    }}
                  >
                    {copied === "username" ? t("pair.copied") : t("pair.copy")}
                  </button>
                </div>
              </div>

              {showPasswordSection && (
                <div
                  style={{
                    width: "100%",
                    display: "flex",
                    flexDirection: "column",
                    gap: 6,
                    padding: 10,
                    border: "1px solid var(--border)",
                    borderRadius: 5,
                    background: "var(--bg-subtle)",
                  }}
                >
                  <span style={{ fontSize: 11, color: "var(--text-dim)" }}>
                    {t("pair.passwordLabel")}
                  </span>
                  {password === null ? (
                    <p style={{ margin: 0, fontSize: 12, color: "var(--text-muted)" }}>
                      {t("pair.notSet")}
                    </p>
                  ) : (
                    <>
                      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                        <code
                          style={{
                            flex: 1,
                            padding: "6px 8px",
                            border: "1px solid var(--border)",
                            borderRadius: 5,
                            background: "var(--bg)",
                            color: "var(--text)",
                            fontFamily: "var(--font-mono)",
                            fontSize: 13,
                            userSelect: "all",
                          }}
                        >
                          {password}
                        </code>
                        <button
                          type="button"
                          onClick={() => void copyValue(password, "password")}
                          style={{
                            padding: "0 10px",
                            border: "1px solid var(--border)",
                            borderRadius: 5,
                            background: "var(--bg-hover)",
                            color: "var(--text)",
                            cursor: "pointer",
                            fontSize: 12,
                            whiteSpace: "nowrap",
                          }}
                        >
                          {copied === "password" ? t("pair.copied") : t("pair.copy")}
                        </button>
                        <button
                          type="button"
                          onClick={() => void regenerate()}
                          disabled={busy || !regeneratable}
                          title={regeneratable ? undefined : t("pair.regenerateEnvLocked")}
                          style={{
                            padding: "0 10px",
                            border: "1px solid var(--accent)",
                            borderRadius: 5,
                            background: regeneratable ? "var(--accent)" : "var(--bg-hover)",
                            color: regeneratable ? "white" : "var(--text-muted)",
                            cursor: busy ? "wait" : regeneratable ? "pointer" : "not-allowed",
                            fontSize: 12,
                            whiteSpace: "nowrap",
                            opacity: busy ? 0.7 : 1,
                          }}
                        >
                          {t("pair.regenerate")}
                        </button>
                      </div>
                      <p
                        style={{
                          margin: 0,
                          fontSize: 11,
                          color: "var(--text-muted)",
                          lineHeight: 1.4,
                        }}
                      >
                        {t("pair.passwordHint")}
                      </p>
                    </>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
"use client";

import { useCallback, useEffect, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { ShutdownConfirmDialog } from "./ShutdownConfirmDialog";

// The countdown shares one route with the action endpoint: GET /api/shutdown
// returns the current state, POST /api/shutdown starts or cancels it.
const SHUTDOWN_API = "/api/shutdown";
const POLL_INTERVAL_MS = 1000;
const DANGER_COLOR = "#ef4444";
// Matches AppShell's TOP_BAR_ICON_BUTTON_SIZE so the mobile toolbar stays uniform.
const MOBILE_ICON_BUTTON_WIDTH = 36;

interface ShutdownStatus {
  state: "idle" | "counting" | "done";
  remainingSeconds: number | null;
  deadline: number | null;
}

export function ShutdownButton({ mobile = false }: { mobile?: boolean }) {
  const { t } = useI18n();
  const [status, setStatus] = useState<ShutdownStatus | null>(null);
  const [busy, setBusy] = useState<"start" | "cancel" | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchStatus = useCallback(async () => {
    try {
      const response = await fetch(SHUTDOWN_API, { cache: "no-store" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const next = (await response.json()) as ShutdownStatus;
      setStatus(next);
      // Errors persist until the next explicit action succeeds or the dialog
      // is dismissed — polling must not wipe a destructive-action failure.
    } catch {
      setStatus(null);
    }
  }, []);

  useEffect(() => {
    const timer = setInterval(() => {
      void fetchStatus();
    }, POLL_INTERVAL_MS);
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") void fetchStatus();
    };
    const onFocus = () => {
      void fetchStatus();
    };

    void fetchStatus();
    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("focus", onFocus);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("focus", onFocus);
    };
  }, [fetchStatus]);

  const postAction = useCallback(async (action: "start" | "cancel"): Promise<boolean> => {
    try {
      const response = await fetch(SHUTDOWN_API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      setStatus((await response.json()) as ShutdownStatus);
      return true;
    } catch {
      return false;
    }
  }, []);

  const handleCancel = useCallback(async () => {
    setBusy("cancel");
    setError(null);
    const ok = await postAction("cancel");
    setBusy(null);
    // A failed cancel may leave the OS timer armed, so keep showing the
    // countdown and surface the failure on the button.
    if (!ok) setError(t("shutdown.failed"));
  }, [postAction, t]);

  const handleConfirm = useCallback(async () => {
    setBusy("start");
    setError(null);
    const ok = await postAction("start");
    setBusy(null);
    if (ok) {
      setConfirmOpen(false);
      return;
    }
    setError(t("shutdown.failed"));
  }, [postAction, t]);

  const handleButtonClick = () => {
    if (status?.state === "counting") {
      void handleCancel();
      return;
    }
    setError(null);
    setConfirmOpen(true);
  };

  const counting = status?.state === "counting";
  const done = status?.state === "done";
  const remainingSeconds = status?.remainingSeconds ?? 0;
  const danger = counting || done || error !== null;
  const label = busy === "start"
    ? t("shutdown.start")
    : error
      ? t("shutdown.failed")
      : counting
        ? `${t("shutdown.cancel")} · ${t("shutdown.remaining", { seconds: remainingSeconds })}`
        : done
          ? t("shutdown.aboutToShutdown")
          : t("shutdown.start");

  return (
    <>
      <button
        type="button"
        onClick={handleButtonClick}
        disabled={busy !== null}
        title={error ?? label}
        aria-label={error ?? label}
        style={{
          display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
          width: mobile ? MOBILE_ICON_BUTTON_WIDTH : undefined,
          height: "100%", padding: mobile ? 0 : "0 12px",
          background: "none",
          border: "none",
          borderTop: "2px solid transparent",
          borderRight: "1px solid var(--border)",
          color: danger ? DANGER_COLOR : "var(--text-muted)",
          cursor: busy ? "wait" : "pointer",
          opacity: busy === "start" ? 0.7 : 1,
          flexShrink: 0,
          fontSize: 11, whiteSpace: "nowrap", transition: "color 0.1s, background 0.1s",
        }}
        onMouseEnter={(event) => {
          event.currentTarget.style.color = danger ? DANGER_COLOR : "var(--text)";
          event.currentTarget.style.background = "var(--bg-hover)";
        }}
        onMouseLeave={(event) => {
          event.currentTarget.style.color = danger ? DANGER_COLOR : "var(--text-muted)";
          event.currentTarget.style.background = "none";
        }}
      >
        <span style={{ position: "relative", display: "flex", flexShrink: 0 }}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M12 2v9" />
            <path d="M6.3 6.5a8 8 0 1 0 11.4 0" />
          </svg>
          {mobile && counting && (
            <span
              aria-hidden="true"
              style={{
                position: "absolute", top: -5, right: -8,
                minWidth: 14, height: 14, padding: "0 3px",
                borderRadius: 7,
                background: DANGER_COLOR,
                color: "#fff",
                fontSize: 9, fontWeight: 600, lineHeight: "14px", textAlign: "center",
              }}
            >
              {remainingSeconds}
            </span>
          )}
        </span>
        {!mobile && <span>{label}</span>}
      </button>
      {confirmOpen && (
        <ShutdownConfirmDialog
          busy={busy === "start"}
          error={error}
          onCancel={() => {
            setConfirmOpen(false);
            setError(null);
          }}
          onConfirm={() => {
            void handleConfirm();
          }}
        />
      )}
    </>
  );
}

"use client";

import { useCallback, useEffect, useState } from "react";

interface GoogleStatus {
  configured: boolean;
  connected: boolean;
  redirectUri: string;
  hint?: string;
}

/**
 * Connect/disconnect control for the read-only Google calendar feed.
 *
 * `status` is what the events endpoint reported (including a fetch error, which
 * only that response knows about); this component fetches the fuller
 * configuration state on its own.
 */
export function GoogleConnect({
  status,
  onChanged,
}: {
  status?: { connected: boolean; error?: string };
  onChanged: () => void;
}) {
  const [config, setConfig] = useState<GoogleStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/robin/google");
      if (!response.ok) return;
      setConfig(await response.json() as GoogleStatus);
    } catch {
      // Leave the row hidden rather than showing a broken control.
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const act = async (action: "connect" | "disconnect") => {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/robin/google", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const body = await response.json().catch(() => null) as
        { authorizeUrl?: string; error?: string } | null;
      if (!response.ok) throw new Error(body?.error ?? `Request failed (${response.status})`);

      if (action === "connect" && body?.authorizeUrl) {
        // Full navigation, not a popup: Google blocks consent in many embedded
        // and popup contexts, and the callback lands back on this origin.
        window.location.href = body.authorizeUrl;
        return;
      }
      await load();
      onChanged();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  };

  if (!config) return null;

  const connected = status?.connected ?? config.connected;

  return (
    <div className="flex flex-col gap-1 border-t pt-2" style={{ borderColor: "var(--border)" }}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs" style={{ color: "var(--text-dim)" }}>
          {connected ? "Google Calendar connected (read-only)" : "Google Calendar not connected"}
        </span>
        {config.configured ? (
          <button
            type="button"
            onClick={() => void act(connected ? "disconnect" : "connect")}
            disabled={busy}
            className="text-xs disabled:opacity-40"
            style={{ color: "var(--accent)" }}
          >
            {busy ? "…" : connected ? "Disconnect" : "Connect"}
          </button>
        ) : (
          <span className="text-xs" style={{ color: "var(--text-dim)" }}>not configured</span>
        )}
      </div>

      {!config.configured && config.hint && (
        <p className="text-xs" style={{ color: "var(--text-dim)" }}>
          {config.hint}. Redirect URI: <code>{config.redirectUri}</code>
        </p>
      )}
      {status?.error && (
        <p className="text-xs" style={{ color: "var(--accent)" }}>Google: {status.error}</p>
      )}
      {error && <p className="text-xs" style={{ color: "var(--accent)" }}>{error}</p>}
    </div>
  );
}

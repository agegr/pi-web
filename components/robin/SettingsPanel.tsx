"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useI18n } from "@/hooks/useI18n";

interface SecretStatus {
  set: boolean;
  source?: "file" | "env";
  hint?: string;
  length?: number;
}

interface SettingsResponse {
  google: { clientId: SecretStatus; clientSecret: SecretStatus };
  telegram: { botToken: SecretStatus; allowedChatIds: number[] };
  storedAt: string;
  googleRedirectUri: string;
}

type Translate = (key: string, params?: Record<string, string>) => string;

const inputStyle = {
  background: "var(--bg)",
  border: "1px solid var(--border)",
  color: "var(--text)",
} as const;

/** Shows presence and provenance only — the value itself never reaches here. */
function StatusLine({ label, status, t }: { label: string; status: SecretStatus; t: Translate }) {
  if (!status.set) {
    return (
      <p className="text-xs" style={{ color: "var(--text-dim)" }}>
        {t("robin.settings.notSet", { label })}
      </p>
    );
  }
  const detail = status.source === "env"
    ? t("robin.settings.fromEnv", { length: String(status.length ?? 0) })
    : t("robin.settings.fromFile", { length: String(status.length ?? 0) });
  return (
    <p className="text-xs" style={{ color: "var(--text-muted)" }}>
      {t("robin.settings.isSet", { label })}{" "}
      <span className="tabular-nums">••••{status.hint}</span>
      <span style={{ color: "var(--text-dim)" }}> （{detail}）</span>
    </p>
  );
}

export function SettingsPanel() {
  const { t } = useI18n();
  const [data, setData] = useState<SettingsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [botToken, setBotToken] = useState("");
  const [chatIds, setChatIds] = useState("");
  const [detected, setDetected] = useState<{ id: number; name: string }[] | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/robin/settings");
      const body = await response.json() as SettingsResponse & { error?: string };
      if (!response.ok) throw new Error(body.error ?? `Request failed (${response.status})`);
      setData(body);
      setChatIds(body.telegram.allowedChatIds.join(", "));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function send(method: string, payload: unknown, message: string) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch("/api/robin/settings", {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await response.json().catch(() => null) as { error?: string } | null;
      if (!response.ok) throw new Error(body?.error ?? `Request failed (${response.status})`);
      setNotice(message);
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  }

  const detect = async () => {
    setBusy(true);
    setError(null);
    setDetected(null);
    try {
      const response = await fetch("/api/robin/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "detectChatIds" }),
      });
      const body = await response.json() as { chats?: { id: number; name: string }[]; error?: string };
      if (!response.ok) throw new Error(body.error ?? `Request failed (${response.status})`);
      setDetected(body.chats ?? []);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    // globals.css locks html/body to the viewport height with
    // overflow:hidden for the chat shell. This page is a document, so it
    // supplies its own scroll container rather than changing that shared rule.
    <div className="flex-1 overflow-y-auto" style={{ minHeight: 0 }}>
      <main className="mx-auto flex w-full max-w-3xl flex-col gap-4 p-4 desktop:p-6">
      <header className="flex items-baseline justify-between gap-4">
        <div>
          <h1 className="text-lg font-semibold" style={{ color: "var(--text)" }}>
            {t("robin.settings.title")}
          </h1>
          <p className="text-sm" style={{ color: "var(--text-muted)" }}>
            {t("robin.settings.subtitle")}
          </p>
        </div>
        <Link href="/dashboard" className="text-sm hover:underline" style={{ color: "var(--accent)" }}>
          {t("robin.nav.back")}
        </Link>
      </header>

      <section
        className="flex flex-col gap-2 rounded-lg p-4 text-xs"
        style={{ background: "var(--bg-panel)", border: "1px solid var(--border)", color: "var(--text-muted)" }}
      >
        <p>{t("robin.settings.storedAt", { path: data?.storedAt ?? "~/.pi/robin/secrets.json" })}</p>
        <p style={{ color: "var(--text-dim)" }}>{t("robin.settings.privacyNote")}</p>
      </section>

      {error && <p className="text-sm" style={{ color: "var(--accent)" }}>{error}</p>}
      {notice && <p className="text-sm" style={{ color: "var(--text-muted)" }}>{notice}</p>}

      {/* ---------- Google ---------- */}
      <section
        className="flex flex-col gap-3 rounded-lg p-4"
        style={{ background: "var(--bg-panel)", border: "1px solid var(--border)" }}
      >
        <h2 className="text-sm font-semibold" style={{ color: "var(--text)" }}>
          {t("robin.settings.googleTitle")}
        </h2>

        <div className="flex flex-col gap-1">
          <StatusLine label={t("robin.settings.clientId")} status={data?.google.clientId ?? { set: false }} t={t} />
          <StatusLine
            label={t("robin.settings.clientSecret")}
            status={data?.google.clientSecret ?? { set: false }}
            t={t}
          />
        </div>

        <p className="text-xs" style={{ color: "var(--text-dim)" }}>{t("robin.settings.redirectHint")}</p>
        <code
          className="block overflow-x-auto rounded px-2 py-1 text-xs"
          style={{ background: "var(--bg)", border: "1px solid var(--border)", color: "var(--text)" }}
        >
          {data?.googleRedirectUri ?? "…"}
        </code>

        <input
          value={clientId}
          onChange={(event) => setClientId(event.target.value)}
          placeholder={t("robin.settings.clientId")}
          autoComplete="off"
          spellCheck={false}
          className="rounded px-2 py-1 text-sm outline-none"
          style={inputStyle}
        />
        <input
          type="password"
          value={clientSecret}
          onChange={(event) => setClientSecret(event.target.value)}
          placeholder={t("robin.settings.clientSecret")}
          autoComplete="new-password"
          className="rounded px-2 py-1 text-sm outline-none"
          style={inputStyle}
        />
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={busy || !clientId.trim() || !clientSecret.trim()}
            onClick={() => void send(
              "POST",
              { section: "google", clientId, clientSecret },
              t("robin.settings.googleSaved"),
            ).then(() => { setClientId(""); setClientSecret(""); })}
            className="rounded px-3 py-1 text-sm disabled:opacity-40"
            style={{ background: "var(--accent)", color: "#fff" }}
          >
            {t("robin.common.save")}
          </button>
          <button
            type="button"
            disabled={busy || !data?.google.clientId.set}
            onClick={() => void send("DELETE", { section: "google" }, t("robin.settings.googleCleared"))}
            className="rounded px-3 py-1 text-sm disabled:opacity-40"
            style={{ border: "1px solid var(--border)", color: "var(--text-muted)" }}
          >
            {t("robin.common.clear")}
          </button>
        </div>
        <p className="text-xs" style={{ color: "var(--text-dim)" }}>{t("robin.settings.googleNext")}</p>
      </section>

      {/* ---------- Telegram ---------- */}
      <section
        className="flex flex-col gap-3 rounded-lg p-4"
        style={{ background: "var(--bg-panel)", border: "1px solid var(--border)" }}
      >
        <h2 className="text-sm font-semibold" style={{ color: "var(--text)" }}>
          {t("robin.settings.telegramTitle")}
        </h2>

        <StatusLine label={t("robin.settings.botToken")} status={data?.telegram.botToken ?? { set: false }} t={t} />

        <input
          type="password"
          value={botToken}
          onChange={(event) => setBotToken(event.target.value)}
          placeholder={t("robin.settings.botTokenPlaceholder")}
          autoComplete="new-password"
          className="rounded px-2 py-1 text-sm outline-none"
          style={inputStyle}
        />
        <button
          type="button"
          disabled={busy || !botToken.trim()}
          onClick={() => void send(
            "POST",
            { section: "telegram", botToken },
            t("robin.settings.tokenSaved"),
          ).then(() => setBotToken(""))}
          className="self-start rounded px-3 py-1 text-sm disabled:opacity-40"
          style={{ background: "var(--accent)", color: "#fff" }}
        >
          {t("robin.settings.saveToken")}
        </button>

        <div className="mt-2 flex flex-col gap-2 border-t pt-3" style={{ borderColor: "var(--border)" }}>
          <p className="text-xs" style={{ color: "var(--text-dim)" }}>{t("robin.settings.chatIdsHint")}</p>
          <input
            value={chatIds}
            onChange={(event) => setChatIds(event.target.value)}
            placeholder={t("robin.settings.chatIdsPlaceholder")}
            inputMode="numeric"
            className="rounded px-2 py-1 text-sm outline-none"
            style={inputStyle}
          />
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => void send(
                "POST",
                { section: "telegram", chatIds },
                t("robin.settings.chatIdsSaved"),
              )}
              className="rounded px-3 py-1 text-sm disabled:opacity-40"
              style={{ background: "var(--accent)", color: "#fff" }}
            >
              {t("robin.settings.saveChatIds")}
            </button>
            <button
              type="button"
              disabled={busy || !data?.telegram.botToken.set}
              onClick={() => void detect()}
              className="rounded px-3 py-1 text-sm disabled:opacity-40"
              style={{ border: "1px solid var(--border)", color: "var(--text-muted)" }}
            >
              {t("robin.settings.detect")}
            </button>
          </div>
          <p className="text-xs" style={{ color: "var(--text-dim)" }}>{t("robin.settings.detectHint")}</p>

          {detected && (
            detected.length === 0 ? (
              <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                {t("robin.settings.detectEmpty")}
              </p>
            ) : (
              <div className="flex flex-col gap-1">
                {detected.map((chat) => (
                  <button
                    key={chat.id}
                    type="button"
                    onClick={() => setChatIds((current) => (
                      current.split(",").map((part) => part.trim()).filter(Boolean).includes(String(chat.id))
                        ? current
                        : [current, String(chat.id)].filter(Boolean).join(", ")
                    ))}
                    className="flex items-center gap-2 rounded px-2 py-1 text-left text-xs"
                    style={{ background: "var(--bg-subtle)", color: "var(--text)" }}
                  >
                    <span className="tabular-nums">{chat.id}</span>
                    <span style={{ color: "var(--text-dim)" }}>{chat.name}</span>
                    <span style={{ color: "var(--accent)" }}>{t("robin.settings.addToAllowlist")}</span>
                  </button>
                ))}
              </div>
            )
          )}
        </div>

        <div className="flex flex-wrap gap-2 border-t pt-3" style={{ borderColor: "var(--border)" }}>
          <button
            type="button"
            disabled={busy || !data?.telegram.botToken.set}
            onClick={() => void send("DELETE", { section: "telegram" }, t("robin.settings.telegramCleared"))}
            className="rounded px-3 py-1 text-sm disabled:opacity-40"
            style={{ border: "1px solid var(--border)", color: "var(--text-muted)" }}
          >
            {t("robin.settings.clearTelegram")}
          </button>
        </div>

        <p className="text-xs" style={{ color: "var(--text-dim)" }}>{t("robin.settings.restartBridge")}</p>
      </section>
      </main>
    </div>
  );
}

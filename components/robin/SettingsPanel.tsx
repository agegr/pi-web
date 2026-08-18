"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import type { DailyAgendaSettings, GmailDigestSettings, JobDigestSettings } from "@/extension/robin/settings";
import { useI18n } from "@/hooks/useI18n";
import { ChatLink } from "./ChatLink";

interface SecretStatus {
  set: boolean;
  source?: "file" | "env";
  hint?: string;
  length?: number;
}

interface SettingsResponse {
  google: { clientId: SecretStatus; clientSecret: SecretStatus };
  telegram: {
    botToken: SecretStatus;
    allowedChatIds: number[];
    dailyAgenda: DailyAgendaSettings;
    jobDigest: JobDigestSettings;
    gmailDigest: GmailDigestSettings;
  };
  storedAt: string;
  googleRedirectUri: string;
}

type Translate = (key: string, params?: Record<string, string>) => string;
type SaveAction = "google" | "token" | "chatIds" | "dailyAgenda" | "jobDigest" | "gmailDigest";
type SavePhase = "saving" | "saved";

const inputStyle = {
  background: "var(--bg)",
  border: "1px solid var(--border)",
  color: "var(--text)",
} as const;

function SaveButton({
  label,
  phase,
  disabled,
  onClick,
  className = "",
  t,
}: {
  label: string;
  phase?: SavePhase;
  disabled: boolean;
  onClick: () => void;
  className?: string;
  t: Translate;
}) {
  const saved = phase === "saved";
  return (
    <button
      type="button"
      disabled={disabled || phase !== undefined}
      onClick={onClick}
      aria-live="polite"
      aria-busy={phase === "saving"}
      className={`ui-action ui-action--outline pi-bracket min-h-11 cursor-pointer px-3 py-2 disabled:cursor-default ${className}`}
      data-state={saved ? "success" : "accent"}
      style={{
        opacity: disabled && phase === undefined ? 0.4 : 1,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 6,
        transition: "background-color 0.2s ease",
        animation: saved ? "saved-pop 0.45s ease" : undefined,
      }}
    >
      {saved && (
        <svg
          aria-hidden="true"
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{ strokeDasharray: 18, animation: "saved-check-draw 0.35s ease forwards" }}
        >
          <polyline points="20 6 9 17 4 12" />
        </svg>
      )}
      {saved ? t("i18n.saved") : phase === "saving" ? t("i18n.saving") : label}
    </button>
  );
}

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
  const [saveFeedback, setSaveFeedback] = useState<{ action: SaveAction; phase: SavePhase } | null>(null);
  const feedbackTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [botToken, setBotToken] = useState("");
  const [chatIds, setChatIds] = useState("");
  const [jobChatIds, setJobChatIds] = useState("");
  const [dailyAgenda, setDailyAgenda] = useState<DailyAgendaSettings | null>(null);
  const [jobDigest, setJobDigest] = useState<JobDigestSettings | null>(null);
  const [gmailDigest, setGmailDigest] = useState<GmailDigestSettings | null>(null);
  const [gmailChatIds, setGmailChatIds] = useState("");
  const [detected, setDetected] = useState<{ id: number; name: string }[] | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/robin/settings");
      const body = await response.json() as SettingsResponse & { error?: string };
      if (!response.ok) throw new Error(body.error ?? `Request failed (${response.status})`);
      setData(body);
      setChatIds(body.telegram.allowedChatIds.join(", "));
      setDailyAgenda(body.telegram.dailyAgenda);
      setJobDigest(body.telegram.jobDigest);
      setJobChatIds((body.telegram.jobDigest.chatIds ?? []).join(", "));
      setGmailDigest(body.telegram.gmailDigest);
      setGmailChatIds((body.telegram.gmailDigest.chatIds ?? []).join(", "));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => () => {
    if (feedbackTimer.current) clearTimeout(feedbackTimer.current);
  }, []);

  async function send(
    method: string,
    payload: unknown,
    message: string,
    action?: SaveAction,
  ): Promise<boolean> {
    if (feedbackTimer.current) clearTimeout(feedbackTimer.current);
    setBusy(true);
    setError(null);
    setNotice(null);
    setSaveFeedback(action ? { action, phase: "saving" } : null);
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
      if (action) {
        setSaveFeedback({ action, phase: "saved" });
        feedbackTimer.current = setTimeout(() => setSaveFeedback(null), 2000);
      }
      return true;
    } catch (caught) {
      setSaveFeedback(null);
      setError(caught instanceof Error ? caught.message : String(caught));
      return false;
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
        <nav className="flex items-baseline gap-3">
          <Link href="/dashboard" className="text-sm hover:underline" style={{ color: "var(--accent)" }}>
            {t("robin.nav.back")}
          </Link>
          <ChatLink />
        </nav>
      </header>

      <section
        className="flex flex-col gap-2 rounded-lg p-4 text-xs"
        style={{ background: "var(--bg-panel)", border: "1px solid var(--border)", color: "var(--text-muted)" }}
      >
        <p>{t("robin.settings.storedAt", { path: data?.storedAt ?? "~/.pi/robin/secrets.json" })}</p>
        <p style={{ color: "var(--text-dim)" }}>{t("robin.settings.privacyNote")}</p>
      </section>

      {error && <p className="text-sm" style={{ color: "var(--accent)" }}>{error}</p>}
      {notice && <p role="status" className="text-sm" style={{ color: "var(--success)" }}>{notice}</p>}

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
          <SaveButton
            label={t("robin.common.save")}
            phase={saveFeedback?.action === "google" ? saveFeedback.phase : undefined}
            disabled={busy || !clientId.trim() || !clientSecret.trim()}
            onClick={() => void send(
              "POST",
              { section: "google", clientId, clientSecret },
              t("robin.settings.googleSaved"),
              "google",
            ).then((saved) => {
              if (saved) { setClientId(""); setClientSecret(""); }
            })}
            t={t}
          />
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
        <p className="text-xs" style={{ color: "var(--text-dim)" }}>{t("robin.settings.googleGmailHint")}</p>
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
        <SaveButton
          label={t("robin.settings.saveToken")}
          phase={saveFeedback?.action === "token" ? saveFeedback.phase : undefined}
          disabled={busy || !botToken.trim()}
          onClick={() => void send(
            "POST",
            { section: "telegram", botToken },
            t("robin.settings.tokenSaved"),
            "token",
          ).then((saved) => {
            if (saved) setBotToken("");
          })}
          className="self-start"
          t={t}
        />

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
            <SaveButton
              label={t("robin.settings.saveChatIds")}
              phase={saveFeedback?.action === "chatIds" ? saveFeedback.phase : undefined}
              disabled={busy}
              onClick={() => void send(
                "POST",
                { section: "telegram", chatIds },
                t("robin.settings.chatIdsSaved"),
                "chatIds",
              )}
              t={t}
            />
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

        <div className="flex flex-col gap-3 border-t pt-3" style={{ borderColor: "var(--border)" }}>
          <div>
            <h3 className="text-sm font-medium" style={{ color: "var(--text)" }}>
              {t("robin.settings.dailyAgendaTitle")}
            </h3>
            <p className="text-xs" style={{ color: "var(--text-dim)" }}>
              {t("robin.settings.dailyAgendaHint")}
            </p>
          </div>
          {dailyAgenda && (
            <>
              <label className="flex min-h-11 items-center gap-2 text-sm" style={{ color: "var(--text)" }}>
                <input
                  type="checkbox"
                  checked={dailyAgenda.enabled}
                  onChange={(event) => setDailyAgenda({ ...dailyAgenda, enabled: event.target.checked })}
                />
                {t("robin.settings.dailyAgendaEnabled")}
              </label>
              <div className="grid gap-3 desktop:grid-cols-2">
                <label className="flex flex-col gap-1 text-xs" style={{ color: "var(--text-muted)" }}>
                  {t("robin.settings.dailyAgendaTime")}
                  <input
                    type="time"
                    value={dailyAgenda.time}
                    onChange={(event) => setDailyAgenda({ ...dailyAgenda, time: event.target.value })}
                    className="min-h-11 rounded px-2 text-sm"
                    style={inputStyle}
                  />
                </label>
                <label className="flex flex-col gap-1 text-xs" style={{ color: "var(--text-muted)" }}>
                  {t("robin.settings.dailyAgendaLanguage")}
                  <select
                    value={dailyAgenda.locale}
                    onChange={(event) => setDailyAgenda({
                      ...dailyAgenda,
                      locale: event.target.value === "zh" ? "zh" : "en",
                    })}
                    className="min-h-11 rounded px-2 text-sm"
                    style={inputStyle}
                  >
                    <option value="en">English</option>
                    <option value="zh">中文</option>
                  </select>
                </label>
              </div>
              <SaveButton
                label={t("robin.settings.saveDailyAgenda")}
                phase={saveFeedback?.action === "dailyAgenda" ? saveFeedback.phase : undefined}
                disabled={busy || !dailyAgenda.time}
                onClick={() => void send(
                  "POST",
                  { section: "telegram", dailyAgenda },
                  t("robin.settings.dailyAgendaSaved"),
                  "dailyAgenda",
                )}
                className="self-start"
                t={t}
              />
            </>
          )}
        </div>

        <div className="flex flex-col gap-3 border-t pt-3" style={{ borderColor: "var(--border)" }}>
          <div>
            <h3 className="text-sm font-medium" style={{ color: "var(--text)" }}>
              {t("robin.settings.jobDigestTitle")}
            </h3>
            <p className="text-xs" style={{ color: "var(--text-dim)" }}>
              {t("robin.settings.jobDigestHint")}
            </p>
          </div>
          {jobDigest && (
            <>
              <label className="flex min-h-11 items-center gap-2 text-sm" style={{ color: "var(--text)" }}>
                <input
                  type="checkbox"
                  checked={jobDigest.enabled}
                  onChange={(event) => setJobDigest({ ...jobDigest, enabled: event.target.checked })}
                />
                {t("robin.settings.jobDigestEnabled")}
              </label>
              <label className="flex flex-col gap-1 text-xs" style={{ color: "var(--text-muted)" }}>
                {t("robin.settings.jobChatIds")}
                <input
                  value={jobChatIds}
                  onChange={(event) => setJobChatIds(event.target.value)}
                  placeholder={t("robin.settings.jobChatIdsPlaceholder")}
                  spellCheck={false}
                  className="min-h-11 rounded px-2 text-sm"
                  style={inputStyle}
                />
                <span style={{ color: "var(--text-dim)" }}>{t("robin.settings.jobChatIdsHint")}</span>
              </label>
              <div className="grid gap-3 desktop:grid-cols-5">
                <label className="flex flex-col gap-1 text-xs" style={{ color: "var(--text-muted)" }}>
                  {t("robin.settings.jobDigestSweep")}
                  <input
                    type="time"
                    value={jobDigest.sweepAt}
                    onChange={(event) => setJobDigest({ ...jobDigest, sweepAt: event.target.value })}
                    className="min-h-11 rounded px-2 text-sm"
                    style={inputStyle}
                  />
                </label>
                <label className="flex flex-col gap-1 text-xs" style={{ color: "var(--text-muted)" }}>
                  {t("robin.settings.jobDigestMorning")}
                  <input
                    type="time"
                    value={jobDigest.morning}
                    onChange={(event) => setJobDigest({ ...jobDigest, morning: event.target.value })}
                    className="min-h-11 rounded px-2 text-sm"
                    style={inputStyle}
                  />
                </label>
                <label className="flex flex-col gap-1 text-xs" style={{ color: "var(--text-muted)" }}>
                  {t("robin.settings.jobDigestEvening")}
                  <input
                    type="time"
                    value={jobDigest.evening}
                    onChange={(event) => setJobDigest({ ...jobDigest, evening: event.target.value })}
                    className="min-h-11 rounded px-2 text-sm"
                    style={inputStyle}
                  />
                </label>
                <label className="flex flex-col gap-1 text-xs" style={{ color: "var(--text-muted)" }}>
                  {t("robin.settings.jobDigestCount")}
                  <input
                    type="number"
                    min={1}
                    max={50}
                    value={jobDigest.count}
                    onChange={(event) => setJobDigest({ ...jobDigest, count: Number(event.target.value) })}
                    className="min-h-11 rounded px-2 text-sm tabular-nums"
                    style={inputStyle}
                  />
                </label>
                <label className="flex flex-col gap-1 text-xs" style={{ color: "var(--text-muted)" }}>
                  {t("robin.settings.dailyAgendaLanguage")}
                  <select
                    value={jobDigest.locale}
                    onChange={(event) => setJobDigest({
                      ...jobDigest,
                      locale: event.target.value === "zh" ? "zh" : "en",
                    })}
                    className="min-h-11 rounded px-2 text-sm"
                    style={inputStyle}
                  >
                    <option value="en">English</option>
                    <option value="zh">中文</option>
                  </select>
                </label>
              </div>
              <SaveButton
                label={t("robin.settings.saveJobDigest")}
                phase={saveFeedback?.action === "jobDigest" ? saveFeedback.phase : undefined}
                disabled={busy || !jobDigest.morning || !jobDigest.evening}
                onClick={() => void send(
                  "POST",
                  { section: "telegram", jobDigest: { ...jobDigest, chatIds: jobChatIds } },
                  t("robin.settings.jobDigestSaved"),
                  "jobDigest",
                )}
                className="self-start"
                t={t}
              />
            </>
          )}
        </div>

        <div className="flex flex-col gap-3 border-t pt-3" style={{ borderColor: "var(--border)" }}>
          <div>
            <h3 className="text-sm font-medium" style={{ color: "var(--text)" }}>
              {t("robin.settings.gmailDigestTitle")}
            </h3>
            <p className="text-xs" style={{ color: "var(--text-dim)" }}>
              {t("robin.settings.gmailDigestHint")}
            </p>
          </div>
          {gmailDigest && (
            <>
              <label className="flex min-h-11 items-center gap-2 text-sm" style={{ color: "var(--text)" }}>
                <input
                  type="checkbox"
                  checked={gmailDigest.enabled}
                  onChange={(event) => setGmailDigest({ ...gmailDigest, enabled: event.target.checked })}
                />
                {t("robin.settings.gmailDigestEnabled")}
              </label>
              <label className="flex flex-col gap-1 text-xs" style={{ color: "var(--text-muted)" }}>
                {t("robin.settings.gmailDigestChatIds")}
                <input
                  value={gmailChatIds}
                  onChange={(event) => setGmailChatIds(event.target.value)}
                  placeholder={t("robin.settings.gmailDigestChatIdsPlaceholder")}
                  spellCheck={false}
                  className="min-h-11 rounded px-2 text-sm"
                  style={inputStyle}
                />
                <span style={{ color: "var(--text-dim)" }}>{t("robin.settings.gmailDigestChatIdsHint")}</span>
              </label>
              <div className="grid gap-3 desktop:grid-cols-3">
                <label className="flex flex-col gap-1 text-xs" style={{ color: "var(--text-muted)" }}>
                  {t("robin.settings.gmailDigestTime")}
                  <input
                    type="time"
                    value={gmailDigest.time}
                    onChange={(event) => setGmailDigest({ ...gmailDigest, time: event.target.value })}
                    className="min-h-11 rounded px-2 text-sm"
                    style={inputStyle}
                  />
                </label>
                <label className="flex flex-col gap-1 text-xs" style={{ color: "var(--text-muted)" }}>
                  {t("robin.settings.dailyAgendaLanguage")}
                  <select
                    value={gmailDigest.locale}
                    onChange={(event) => setGmailDigest({
                      ...gmailDigest,
                      locale: event.target.value === "zh" ? "zh" : "en",
                    })}
                    className="min-h-11 rounded px-2 text-sm"
                    style={inputStyle}
                  >
                    <option value="en">English</option>
                    <option value="zh">中文</option>
                  </select>
                </label>
                <label className="flex flex-col gap-1 text-xs" style={{ color: "var(--text-muted)" }}>
                  {t("robin.settings.gmailDigestQuery")}
                  <input
                    value={gmailDigest.query}
                    onChange={(event) => setGmailDigest({ ...gmailDigest, query: event.target.value })}
                    placeholder="newer_than:1d"
                    spellCheck={false}
                    className="min-h-11 rounded px-2 text-sm"
                    style={inputStyle}
                  />
                </label>
              </div>
              <SaveButton
                label={t("robin.settings.saveGmailDigest")}
                phase={saveFeedback?.action === "gmailDigest" ? saveFeedback.phase : undefined}
                disabled={busy || !gmailDigest.time}
                onClick={() => void send(
                  "POST",
                  { section: "telegram", gmailDigest: { ...gmailDigest, chatIds: gmailChatIds } },
                  t("robin.settings.gmailDigestSaved"),
                  "gmailDigest",
                )}
                className="self-start"
                t={t}
              />
            </>
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

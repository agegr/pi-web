"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { GlobeLock, KeyRound, Plus, Server, ShieldAlert, X } from "lucide-react";
import { useI18n } from "@/hooks/useI18n";

export interface RemoteDraftController {
  dirty: boolean;
  discard(): void;
  handleBack(): boolean;
  mobileDetailOpen: boolean;
}

interface RemoteAccessSnapshot {
  schemaVersion: 1;
  configPath: string;
  bindHostname: string;
  bindPort: string;
  allowedHosts: string[];
  envAllowedHosts: string[];
  passwordConfigured: boolean;
  passwordSource?: "file" | "env";
  username: "pi";
  configError?: string;
}

interface Draft {
  allowedHosts: string[];
  password: string;
  confirm: string;
  removePassword: boolean;
}

interface Props {
  onControllerChange(controller: RemoteDraftController): void;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hostsEqual(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((host, index) => host === right[index]);
}

async function readApiError(response: Response): Promise<{ error: string; code?: string }> {
  try {
    const body = await response.json() as unknown;
    if (isRecord(body) && typeof body.error === "string") {
      return { error: body.error, code: typeof body.code === "string" ? body.code : undefined };
    }
  } catch {
    // Fall through to the status code.
  }
  return { error: `HTTP ${response.status}` };
}

export function RemoteAccessConfig({ onControllerChange }: Props) {
  const { t } = useI18n();
  const [snapshot, setSnapshot] = useState<RemoteAccessSnapshot | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [hostInput, setHostInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [action, setAction] = useState<"load" | "save" | "reload" | null>("load");

  const dirty = Boolean(
    snapshot
    && draft
    && (
      !hostsEqual(draft.allowedHosts, snapshot.allowedHosts)
      || draft.password.length > 0
      || draft.confirm.length > 0
      || draft.removePassword
    ),
  );

  const load = useCallback(async () => {
    setError(null);
    setMessage(null);
    const response = await fetch("/api/remote-access", { cache: "no-store" });
    if (!response.ok) throw new Error((await readApiError(response)).error);
    const next = await response.json() as RemoteAccessSnapshot;
    setSnapshot(next);
    setDraft({
      allowedHosts: [...next.allowedHosts],
      password: "",
      confirm: "",
      removePassword: false,
    });
    setHostInput("");
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        await load();
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        setAction(null);
      }
    })();
  }, [load]);

  useEffect(() => {
    onControllerChange({
      dirty,
      discard() {
        if (!snapshot) return;
        setDraft({
          allowedHosts: [...snapshot.allowedHosts],
          password: "",
          confirm: "",
          removePassword: false,
        });
        setHostInput("");
        setError(null);
        setMessage(null);
      },
      handleBack: () => false,
      mobileDetailOpen: false,
    });
  }, [dirty, onControllerChange, snapshot]);

  const errorForCode = useMemo(() => ({
    invalid_hostname: t("remote.error.invalid_hostname"),
    password_required: t("remote.error.password_required"),
    password_invalid: t("remote.error.password_invalid"),
    cannot_disable_password_remotely: t("remote.error.cannot_disable_password_remotely"),
  }), [t]);

  const addHost = (event?: FormEvent) => {
    event?.preventDefault();
    if (!draft) return;
    const hostname = hostInput.trim().toLowerCase().replace(/\.$/, "");
    if (!hostname) return;
    if (draft.allowedHosts.includes(hostname) || snapshot?.envAllowedHosts.includes(hostname)) {
      setHostInput("");
      return;
    }
    setDraft({ ...draft, allowedHosts: [...draft.allowedHosts, hostname] });
    setHostInput("");
    setMessage(null);
  };

  const save = () => {
    if (!draft || action) return;
    if (draft.password && draft.password !== draft.confirm) {
      setError(t("remote.passwordMismatch"));
      return;
    }
    setAction("save");
    setError(null);
    setMessage(null);
    void (async () => {
      try {
        const body: { allowedHosts: string[]; password?: string | null } = {
          allowedHosts: draft.allowedHosts,
        };
        if (draft.removePassword) body.password = null;
        else if (draft.password) body.password = draft.password;
        const response = await fetch("/api/remote-access", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!response.ok) {
          const apiError = await readApiError(response);
          throw new Error(apiError.code && apiError.code in errorForCode
            ? errorForCode[apiError.code as keyof typeof errorForCode]
            : apiError.error);
        }
        const next = await response.json() as RemoteAccessSnapshot;
        const enabledAuth = !snapshot?.passwordConfigured && next.passwordConfigured;
        setSnapshot(next);
        setDraft({
          allowedHosts: [...next.allowedHosts],
          password: "",
          confirm: "",
          removePassword: false,
        });
        setMessage(enabledAuth ? t("remote.savedAuthHint") : t("remote.saved"));
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        setAction(null);
      }
    })();
  };

  const reload = () => {
    if (action) return;
    setAction("reload");
    void load().finally(() => setAction(null));
  };

  if (!draft || !snapshot) {
    return (
      <div className="settings-form-page">
        <div className="settings-form-heading">
          <GlobeLock size={18} aria-hidden="true" />
          <div>
            <h3>{t("remote.title")}</h3>
            <p>{action === "load" ? t("remote.loading") : (error ?? t("remote.loading"))}</p>
          </div>
        </div>
        {error && <div className="settings-inline-error" role="alert">{error}</div>}
      </div>
    );
  }

  const busy = action !== null;
  const filePassword = snapshot.passwordSource === "file";

  return (
    <div className="settings-form-page">
      <div className="settings-form-heading">
        <GlobeLock size={18} aria-hidden="true" />
        <div>
          <h3>{t("remote.title")}</h3>
          <p>{t("remote.description")}</p>
        </div>
      </div>

      <div className="settings-callout" data-kind="warning">
        <ShieldAlert size={16} aria-hidden="true" />
        <p>{t("remote.warning")}</p>
      </div>
      {snapshot.configError && (
        <div className="settings-inline-error" role="alert">{t("remote.configError")}: {snapshot.configError}</div>
      )}
      {error && <div className="settings-inline-error" role="alert">{error}</div>}
      {message && <div className="settings-inline-success" role="status">{message}</div>}
      {snapshot.passwordSource === "env" && (
        <div className="settings-callout">{t("remote.envWins")}</div>
      )}

      <section className="settings-form-section">
        <div className="settings-form-label">
          <Server size={16} aria-hidden="true" />
          <div>
            <strong>{t("remote.listen")}</strong>
            <span>{t("remote.listenDescription")}</span>
          </div>
        </div>
        <code className="settings-readonly-value">{snapshot.bindHostname}:{snapshot.bindPort}</code>
      </section>

      <section className="settings-form-section settings-form-section-stack">
        <div className="settings-form-label">
          <GlobeLock size={16} aria-hidden="true" />
          <div>
            <strong>{t("remote.hosts")}</strong>
            <span>{t("remote.hostsDescription")}</span>
          </div>
        </div>
        <div className="settings-host-editor">
          <div className="settings-host-chips">
            {draft.allowedHosts.map((host) => (
              <span className="settings-host-chip" key={host}>
                {host}
                <button
                  type="button"
                  disabled={busy}
                  aria-label={t("remote.removeHost")}
                  onClick={() => setDraft({ ...draft, allowedHosts: draft.allowedHosts.filter((item) => item !== host) })}
                >
                  <X size={12} aria-hidden="true" />
                </button>
              </span>
            ))}
            {snapshot.envAllowedHosts.map((host) => (
              <span className="settings-host-chip" data-env="true" key={`env:${host}`} title={t("remote.envHost")}>
                {host}
                <em>{t("remote.envHost")}</em>
              </span>
            ))}
          </div>
          <form className="settings-host-add" onSubmit={addHost}>
            <input
              value={hostInput}
              disabled={busy}
              autoComplete="off"
              spellCheck={false}
              placeholder={t("remote.hostPlaceholder")}
              onChange={(event) => setHostInput(event.target.value)}
            />
            <button type="submit" disabled={busy || hostInput.trim().length === 0}>
              <Plus size={14} aria-hidden="true" />
              {t("remote.addHost")}
            </button>
          </form>
        </div>
      </section>

      <section className="settings-form-section settings-form-section-stack">
        <div className="settings-form-label">
          <KeyRound size={16} aria-hidden="true" />
          <div>
            <strong>{t("remote.password")}</strong>
            <span>{t("remote.passwordDescription", { username: snapshot.username })}</span>
          </div>
        </div>
        <div className="settings-password-stack">
          <p className="settings-password-status">
            {snapshot.passwordConfigured ? t("remote.passwordSet") : t("remote.passwordUnset")}
            {filePassword ? ` · ${t("remote.keepPassword")}` : null}
          </p>
          <label>
            <span>{t("remote.newPassword")}</span>
            <input
              type="password"
              autoComplete="new-password"
              disabled={busy || draft.removePassword}
              value={draft.password}
              onChange={(event) => setDraft({ ...draft, password: event.target.value, removePassword: false })}
            />
          </label>
          <label>
            <span>{t("remote.confirmPassword")}</span>
            <input
              type="password"
              autoComplete="new-password"
              disabled={busy || draft.removePassword}
              value={draft.confirm}
              onChange={(event) => setDraft({ ...draft, confirm: event.target.value })}
            />
          </label>
          {filePassword && (
            <button
              type="button"
              className="settings-text-action"
              disabled={busy}
              onClick={() => setDraft({ ...draft, removePassword: !draft.removePassword, password: "", confirm: "" })}
            >
              {draft.removePassword ? t("remote.keepPassword") : t("remote.removePassword")}
            </button>
          )}
        </div>
      </section>

      <div className="settings-form-actions">
        <button type="button" className="settings-primary-button" disabled={busy} onClick={save}>
          {action === "save" ? t("remote.saving") : t("remote.save")}
        </button>
        <button type="button" className="settings-secondary-button" disabled={busy} onClick={reload}>
          {t("remote.reload")}
        </button>
      </div>
      <p className="settings-help">{t("remote.help", { address: `http://${snapshot.bindHostname}:${snapshot.bindPort}` })}</p>
    </div>
  );
}

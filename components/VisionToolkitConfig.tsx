"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "@/hooks/useI18n";

export interface VisionDraftController {
  dirty: boolean;
  discard(): void;
  handleBack(): boolean;
  mobileDetailOpen: boolean;
  reveal(): void;
}

type VisionProtocol = "chat_completions" | "responses" | "anthropic";

interface VisionToolkitSettings {
  protocol: VisionProtocol;
  baseUrl: string;
  model: string;
  language: "zh" | "en" | "";
}

interface VisionToolkitSnapshot {
  schemaVersion: 1;
  configPath: string;
  writable: boolean;
  settings: VisionToolkitSettings;
  credential: { configured: boolean; source?: "file" | "env"; writable: boolean };
  install: {
    extension: { present: boolean; path: string };
    skill: { present: boolean; path: string };
  };
}

type HealthStatus = "ok" | "warning" | "error" | "not_tested";
interface HealthCheck { status: HealthStatus; detail: string }
interface HealthResult {
  checks: Record<string, HealthCheck>;
  healthy: boolean;
  connectionTested: boolean;
}

interface Draft extends VisionToolkitSettings {
  apiKey: string;
}

interface Props {
  onControllerChange(controller: VisionDraftController): void;
}

const HEALTH_ORDER = [
  "python",
  "dependencies",
  "chrome",
  "credential",
  "configFile",
  "extension",
  "skill",
  "service",
] as const;

const HEALTH_NAME_KEYS: Record<string, string> = {
  python: "vision.healthPython",
  dependencies: "vision.healthDependencies",
  chrome: "vision.healthChrome",
  credential: "vision.healthCredential",
  configFile: "vision.healthConfigFile",
  extension: "vision.healthExtension",
  skill: "vision.healthSkill",
  service: "vision.healthService",
};

const HEALTH_STATUS_KEYS: Record<HealthStatus, string> = {
  ok: "vision.statusOk",
  warning: "vision.statusWarning",
  error: "vision.statusError",
  not_tested: "vision.statusNotTested",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function draftFrom(settings: VisionToolkitSettings): Draft {
  return { ...settings, apiKey: "" };
}

function draftsMatch(draft: Draft, settings: VisionToolkitSettings, apiKey: string): boolean {
  return draft.protocol === settings.protocol
    && draft.baseUrl === settings.baseUrl
    && draft.model === settings.model
    && draft.language === settings.language
    && apiKey.length === 0;
}

function apiKeyFailure(value: string, t: (key: string) => string): string | undefined {
  if (value.length === 0) return undefined;
  const trimmed = value.trim();
  if (trimmed.length === 0) return t("vision.apiKeyBlank");
  const quote = trimmed[0];
  const quoted = trimmed.length > 1
    && (quote === '"' || quote === "'" || quote === "`")
    && trimmed.endsWith(quote);
  const environmentLine = /^[A-Z][A-Z0-9_]*=[^=]/.test(trimmed);
  if (quoted || environmentLine || !/^[\x21-\x7E]+$/.test(trimmed)) return t("vision.apiKeyInvalid");
  return undefined;
}

async function readApiError(response: Response): Promise<string> {
  try {
    const body = await response.json() as unknown;
    if (isRecord(body) && typeof body.error === "string") return body.error;
  } catch {
    // Fall through to the status code.
  }
  return `HTTP ${response.status}`;
}

export function VisionToolkitConfig({ onControllerChange }: Props) {
  const { t } = useI18n();
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [snapshot, setSnapshot] = useState<VisionToolkitSnapshot | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [health, setHealth] = useState<HealthResult | null>(null);
  const [action, setAction] = useState<"save" | "reload" | "health" | "connection" | "reveal" | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const apiKeyRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setStatus((current) => current === "ready" ? current : "loading");
    setError(null);
    setMessage(null);
    try {
      const response = await fetch("/api/vision-toolkit", { cache: "no-store" });
      if (!response.ok) throw new Error(await readApiError(response));
      const next = await response.json() as VisionToolkitSnapshot;
      setSnapshot(next);
      setDraft(draftFrom(next.settings));
      setStatus("ready");
    } catch (cause) {
      setStatus("error");
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const dirty = Boolean(
    snapshot && draft && !draftsMatch(draft, snapshot.settings, draft.apiKey),
  );

  const discard = useCallback(() => {
    if (!snapshot) return;
    setDraft(draftFrom(snapshot.settings));
    setFieldError(null);
    setError(null);
    setMessage(null);
  }, [snapshot]);

  const reveal = useCallback(() => {
    if (action) return;
    setAction("reveal");
    setError(null);
    setMessage(null);
    void (async () => {
      try {
        const response = await fetch("/api/vision-toolkit/reveal", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{}",
        });
        if (response.status === 404) {
          setError(await readApiError(response));
          return;
        }
        if (!response.ok) throw new Error(await readApiError(response));
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        setAction(null);
      }
    })();
  }, [action]);

  const controller = useMemo<VisionDraftController>(() => ({
    dirty,
    discard,
    handleBack: () => false,
    mobileDetailOpen: false,
    reveal,
  }), [dirty, discard, reveal]);

  useEffect(() => {
    onControllerChange(controller);
  }, [controller, onControllerChange]);

  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  const update = <K extends keyof Draft>(key: K, value: Draft[K]) => {
    setDraft((current) => current ? { ...current, [key]: value } : current);
    setMessage(null);
    if (key === "apiKey") setFieldError(null);
  };

  const save = () => {
    if (!draft || action) return;
    const keyFailure = apiKeyFailure(draft.apiKey, t);
    if (keyFailure) {
      setFieldError(keyFailure);
      apiKeyRef.current?.focus();
      return;
    }
    setAction("save");
    setError(null);
    setFieldError(null);
    setMessage(null);
    void (async () => {
      try {
        const body: Record<string, unknown> = {
          protocol: draft.protocol,
          baseUrl: draft.baseUrl,
          model: draft.model,
          language: draft.language,
        };
        if (draft.apiKey.length > 0) body.apiKey = draft.apiKey;
        const response = await fetch("/api/vision-toolkit", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!response.ok) {
          const saveError = await readApiError(response);
          setError(saveError);
          if (saveError === t("vision.apiKeyBlank") || saveError.includes("spaces") || saveError.includes("quotes")) {
            apiKeyRef.current?.focus();
          }
          return;
        }
        const next = await response.json() as VisionToolkitSnapshot;
        setSnapshot(next);
        setDraft(draftFrom(next.settings));
        setMessage(t("vision.saved"));
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

  const runHealth = (testConnection: boolean) => {
    if (action) return;
    if (testConnection && dirty) {
      setError(t("vision.saveBeforeTesting"));
      return;
    }
    setAction(testConnection ? "connection" : "health");
    setError(null);
    setMessage(null);
    void (async () => {
      try {
        const response = await fetch("/api/vision-toolkit/health", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ testConnection }),
        });
        if (!response.ok) throw new Error(await readApiError(response));
        setHealth(await response.json() as HealthResult);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        setAction(null);
      }
    })();
  };

  if (status === "loading" && !snapshot) {
    return <div className="vision-settings-loading">{t("vision.testing")}</div>;
  }
  if (!draft || !snapshot) {
    return (
      <div className="vision-settings-loading">
        {error ?? t("vision.testing")}
        <button type="button" className="vision-settings-reload" onClick={() => void load()}>{t("vision.reload")}</button>
      </div>
    );
  }

  const keyLocked = !snapshot.credential.writable;
  const busy = action !== null;
  const checks = health
    ? HEALTH_ORDER.filter((name) => health.checks[name]).map((name) => [name, health.checks[name]] as const)
    : [];

  return (
    <div className="vision-settings">
      <div className="vision-settings-banner">{t("vision.externalNotice")}</div>
      {fieldError && <div className="vision-settings-alert" data-kind="error" role="alert">{fieldError}</div>}
      {error && <div className="vision-settings-alert" data-kind="error" role="alert">{error}</div>}
      {message && <div className="vision-settings-alert" data-kind="success" role="status">{message}</div>}

      <section className="vision-settings-card">
        <div className="vision-settings-card-title">
          <div>
            <h3>{t("vision.provider")}</h3>
            <p>{t("vision.providerHint")}</p>
          </div>
          <span className="vision-settings-badge" data-ok={snapshot.credential.configured}>
            {snapshot.credential.configured ? t("vision.configured") : t("vision.missing")}
          </span>
        </div>
        <div className="vision-settings-grid">
          <label className="vision-settings-field">
            <span>{t("vision.protocol")}</span>
            <select
              value={draft.protocol}
              disabled={busy || !snapshot.writable}
              onChange={(event) => update("protocol", event.target.value as VisionProtocol)}
            >
              <option value="chat_completions">OpenAI Chat Completions</option>
              <option value="responses">OpenAI Responses</option>
              <option value="anthropic">Anthropic Messages</option>
            </select>
          </label>
          <label className="vision-settings-field">
            <span>{t("vision.baseUrl")}</span>
            <input
              value={draft.baseUrl}
              disabled={busy || !snapshot.writable}
              autoComplete="off"
              onChange={(event) => update("baseUrl", event.target.value)}
            />
          </label>
          <label className="vision-settings-field">
            <span>{t("vision.model")}</span>
            <input
              value={draft.model}
              disabled={busy || !snapshot.writable}
              autoComplete="off"
              onChange={(event) => update("model", event.target.value)}
            />
          </label>
          <label className="vision-settings-field">
            <span>{t("vision.apiKey")}</span>
            <input
              ref={apiKeyRef}
              type="password"
              value={draft.apiKey}
              disabled={busy || keyLocked}
              autoComplete="new-password"
              placeholder={snapshot.credential.configured
                ? t("vision.apiKeyPlaceholderConfigured")
                : t("vision.apiKeyPlaceholderMissing")}
              onChange={(event) => update("apiKey", event.target.value)}
            />
            <small>{keyLocked ? t("vision.apiKeyLocked") : t("vision.apiKeyHint")}</small>
          </label>
        </div>
      </section>

      <div className="vision-settings-actions">
        <button type="button" className="vision-settings-save" disabled={busy || (!snapshot.writable && !draft.apiKey)} onClick={save}>
          {action === "save" ? t("vision.saving") : t("vision.save")}
        </button>
        <button type="button" className="vision-settings-reload" disabled={busy} onClick={reload}>
          {t("vision.reload")}
        </button>
      </div>

      <section className="vision-settings-card">
        <div className="vision-settings-card-title">
          <div>
            <h3>{t("vision.health")}</h3>
            <p>{t("vision.connectionHint")}</p>
          </div>
          <div className="vision-settings-health-actions">
            <button type="button" className="vision-settings-reload" disabled={busy} onClick={() => runHealth(false)}>
              {action === "health" ? t("vision.testing") : t("vision.runHealth")}
            </button>
            <button type="button" className="vision-settings-reload" disabled={busy} onClick={() => runHealth(true)}>
              {action === "connection" ? t("vision.testing") : t("vision.testConnection")}
            </button>
          </div>
        </div>
        <p className="vision-settings-hint">{t("vision.saveBeforeTesting")}</p>
        {checks.length === 0 ? (
          <p className="vision-settings-hint">{t("vision.notTested")}</p>
        ) : (
          <div className="vision-settings-health-grid">
            {checks.map(([name, check]) => (
              <div key={name} data-status={check.status}>
                <span>{t(HEALTH_NAME_KEYS[name] ?? "vision.health")}</span>
                <strong>{t(HEALTH_STATUS_KEYS[check.status])}</strong>
                <p>{check.detail}</p>
              </div>
            ))}
          </div>
        )}
      </section>

      <details className="vision-settings-advanced">
        <summary>
          <span>
            <strong>{t("vision.advanced")}</strong>
            <small>{t("vision.advancedHint")}</small>
          </span>
        </summary>
        <div className="vision-settings-advanced-body">
          <label className="vision-settings-field">
            <span>{t("vision.language")}</span>
            <select
              value={draft.language}
              disabled={busy || !snapshot.writable}
              onChange={(event) => update("language", event.target.value as Draft["language"])}
            >
              <option value="">—</option>
              <option value="zh">中文</option>
              <option value="en">English</option>
            </select>
          </label>
        </div>
      </details>

      <footer className="vision-settings-footer">
        <div>
          <span className="vision-settings-kicker">{t("vision.pluginKind")}</span>
          <h2>{t("vision.title")}</h2>
          <p>{t("vision.intro")}</p>
        </div>
        <div className="vision-settings-facts">
          <span><span>{t("vision.extension")}</span><strong>{snapshot.install.extension.present ? t("vision.present") : t("vision.absent")}</strong></span>
          <span><span>{t("vision.skill")}</span><strong>{snapshot.install.skill.present ? t("vision.present") : t("vision.absent")}</strong></span>
          <span><span>{t("vision.configPath")}</span><strong title={snapshot.configPath}>{snapshot.configPath}</strong></span>
        </div>
      </footer>
    </div>
  );
}

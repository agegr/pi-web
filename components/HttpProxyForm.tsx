"use client";

import { useEffect, useRef, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import type { HttpProxySettingsResponse } from "@/lib/api-types";
import { readJsonOrThrow } from "@/lib/fetch-json";
import { ConfigButton, ConfigDetailActions, ConfigSwitch } from "./SettingsUi";

const DEFAULT_PROXY_ADDRESS = "http://127.0.0.1:7890";
const DEFAULT_PORTS: Record<string, string> = { "http:": "80", "https:": "443", "socks:": "1080", "socks5:": "1080" };

const ERROR_KEYS = {
  load: "settings.httpProxyLoadFailed",
  save: "settings.httpProxySaveFailed",
  "proxy-required": "settings.httpProxyRequired",
  "invalid-proxy": "settings.httpProxyInvalid",
} as const;

export function HttpProxyForm({ label }: { label: string }) {
  const { t } = useI18n();
  const [settings, setSettings] = useState<HttpProxySettingsResponse | null>(null);
  const [draft, setDraft] = useState<{ address: string; port: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<keyof typeof ERROR_KEYS | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const saved = settings?.displayAddress ? new URL(settings.displayAddress) : null;
  const savedAddress = saved ? `${saved.protocol}//${saved.hostname}` : "";
  const savedPort = saved ? saved.port || DEFAULT_PORTS[saved.protocol] : "";
  const { address, port } = draft ?? { address: savedAddress, port: savedPort };
  const addressChanged = address.trim() !== savedAddress;
  const portChanged = port !== savedPort;

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/http-proxy")
      .then(async (response) => {
        const data = await readJsonOrThrow<HttpProxySettingsResponse>(response);
        if (!cancelled) setSettings(data);
      })
      .catch(() => {
        if (!cancelled) setError("load");
      });
    return () => { cancelled = true; };
  }, []);

  async function saveProxy(update: { enabled: false } | { enabled: true; httpProxy: string } | { enabled: true; port: number | null }) {
    if (!settings || saving) return;
    setError(null);
    setSaving(true);
    try {
      const response = await fetch("/api/http-proxy", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(update),
      });
      if (!response.ok) {
        const { reason } = await response.json();
        if (reason === "proxy-required" || reason === "invalid-proxy") {
          setError(reason);
          inputRef.current?.focus();
        } else {
          setError("save");
        }
        return;
      }
      setSettings(await readJsonOrThrow<HttpProxySettingsResponse>(response));
      setDraft(null);
    } catch {
      setError("save");
    } finally {
      setSaving(false);
    }
  }

  function submitAddress() {
    if (!addressChanged) {
      if (portChanged) void saveProxy({ enabled: true, port: port ? Number(port) : null });
      return;
    }
    try {
      const value = address.trim();
      const url = new URL(value);
      // A complete URL pasted into Address supplies its own port, including an explicit :80 or :443.
      if (portChanged || !/^[\w+.-]+:\/\/[^/?#]*:\d+(?:[/?#]|$)/.test(value)) {
        url.port = port ? String(Number(port)) : "";
      }
      void saveProxy({ enabled: true, httpProxy: url.href });
    } catch {
      setError(address.trim() ? "invalid-proxy" : "proxy-required");
      inputRef.current?.focus();
    }
  }

  const sources = settings?.sources;
  const sourcesByProtocol = sources && sources.http === sources.https ? { "HTTP/HTTPS": sources.http } : sources;
  const sourceNote = Object.entries(sourcesByProtocol ?? {})
    .filter(([, source]) => source !== "settings" && source !== "direct")
    .map(([protocol, source]) => t("settings.httpProxyEnvironment", { protocol: protocol.toUpperCase(), source }))
    .join(" ");
  const addressError = error === "proxy-required" || error === "invalid-proxy";

  return (
    <form onSubmit={(event) => {
      event.preventDefault();
      submitAddress();
    }}>
      <div className="settings-chat-options">
        <div className="settings-chat-option settings-chat-switch-option">
          <h3 className="settings-general-heading">{label}</h3>
          <ConfigDetailActions>
            {settings?.enabled && (addressChanged || portChanged) && (
              <ConfigButton type="submit" size="small" disabled={saving}>
                {t("i18n.save")}
              </ConfigButton>
            )}
            <ConfigSwitch
              checked={settings?.enabled === true}
              disabled={!settings}
              loading={saving || (!settings && !error)}
              label={label}
              describedBy={sourceNote ? "settings-proxy-source" : undefined}
              onChange={(enabled) => void saveProxy(enabled ? { enabled, httpProxy: DEFAULT_PROXY_ADDRESS } : { enabled })}
            />
          </ConfigDetailActions>
        </div>
        {settings?.enabled && (
          <div className="settings-proxy-address-row">
            <label className="config-field">
              <span className="config-field-label">{t("settings.httpProxyAddress")}</span>
              <input
                ref={inputRef}
                className="config-add-source-input"
                type="text"
                inputMode="url"
                autoComplete="off"
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
                readOnly={saving}
                value={address}
                aria-invalid={addressError || undefined}
                aria-describedby={addressError ? "settings-proxy-error" : undefined}
                onChange={(event) => {
                  setDraft({ address: event.target.value, port });
                  setError(null);
                }}
              />
            </label>
            <label className="config-field">
              <span className="config-field-label">{t("settings.httpProxyPort")}</span>
              <input
                className="config-add-source-input"
                type="number"
                inputMode="numeric"
                min={1}
                max={65535}
                step={1}
                readOnly={saving}
                value={port}
                onChange={(event) => {
                  setDraft({ address, port: event.target.value });
                  setError(null);
                }}
              />
            </label>
          </div>
        )}
      </div>
      {sourceNote && <p id="settings-proxy-source" className="settings-general-description">{sourceNote}</p>}
      {error && <p id="settings-proxy-error" role="alert" className="settings-general-error">{t(ERROR_KEYS[error])}</p>}
    </form>
  );
}

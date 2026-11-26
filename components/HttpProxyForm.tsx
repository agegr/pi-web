"use client";

import { useEffect, useRef, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import type { HttpProxySettingsResponse } from "@/lib/api-types";
import { readJsonOrThrow } from "@/lib/fetch-json";
import { ConfigButton, ConfigDetailActions, ConfigSwitch } from "./SettingsUi";

const ERROR_KEYS = {
  load: "settings.httpProxyLoadFailed",
  save: "settings.httpProxySaveFailed",
  "proxy-required": "settings.httpProxyRequired",
  "invalid-proxy": "settings.httpProxyInvalid",
} as const;

export function HttpProxyForm({ label }: { label: string }) {
  const { t } = useI18n();
  const [settings, setSettings] = useState<HttpProxySettingsResponse | null>(null);
  // Switching on only opens the field; nothing is saved until an address is.
  const [opened, setOpened] = useState(false);
  const [draft, setDraft] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<keyof typeof ERROR_KEYS | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  // The server sends the address without the credentials a saved URL may hold;
  // saving a new address replaces the whole URL.
  const savedAddress = settings?.displayAddress ?? "";
  const address = draft ?? savedAddress;
  const changed = address.trim() !== savedAddress;
  const checked = settings?.enabled === true || opened;

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

  useEffect(() => {
    if (opened) inputRef.current?.focus();
  }, [opened]);

  async function saveProxy(update: { enabled: false } | { enabled: true; httpProxy: string }) {
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
        const { reason } = await response.json().catch(() => ({}));
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
      setOpened(false);
    } catch {
      setError("save");
    } finally {
      setSaving(false);
    }
  }

  function toggle(enabled: boolean) {
    setError(null);
    setDraft(null);
    if (enabled) setOpened(true);
    else if (settings?.enabled) void saveProxy({ enabled: false });
    else setOpened(false);
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
      if (changed) void saveProxy({ enabled: true, httpProxy: address.trim() });
    }}>
      <div className="settings-chat-options">
        <div className="settings-chat-option settings-chat-switch-option">
          <h3 className="settings-general-heading">{label}</h3>
          <ConfigDetailActions>
            {checked && changed && (
              <ConfigButton type="submit" size="small" disabled={saving}>
                {t("i18n.save")}
              </ConfigButton>
            )}
            <ConfigSwitch
              checked={checked}
              disabled={!settings}
              loading={saving || (!settings && !error)}
              label={label}
              describedBy={sourceNote ? "settings-proxy-source" : undefined}
              onChange={toggle}
            />
          </ConfigDetailActions>
        </div>
        {checked && (
          <input
            ref={inputRef}
            className="config-add-source-input"
            type="text"
            inputMode="url"
            placeholder="http://127.0.0.1:7890"
            aria-label={t("settings.httpProxyAddress")}
            autoComplete="off"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            readOnly={saving}
            value={address}
            aria-invalid={addressError || undefined}
            aria-describedby={addressError ? "settings-proxy-error" : undefined}
            onChange={(event) => {
              setDraft(event.target.value);
              setError(null);
            }}
          />
        )}
      </div>
      {sourceNote && <p id="settings-proxy-source" className="settings-general-description">{sourceNote}</p>}
      {error && <p id="settings-proxy-error" role="alert" className="settings-general-error">{t(ERROR_KEYS[error])}</p>}
    </form>
  );
}

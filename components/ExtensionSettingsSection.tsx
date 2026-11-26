"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { useI18n } from "@/hooks/useI18n";
import {
  applySettingsSection,
  readSettingsSection,
  readSettingsSectionStatus,
} from "@/lib/settings-sections-client";
import {
  describeSettingsError,
  initialFieldValues,
  localizedText,
  type SettingsField,
  type SettingsFieldValue,
  type SettingsSectionDescriptor,
  type SettingsSectionStatus,
} from "@/lib/settings-sections";
import { ConfigButton, ConfigField, ConfigStatusDot, ConfigSwitch } from "./SettingsUi";

/**
 * A Settings section a pi extension registered (`docs/integrations.md`).
 *
 * The extension keeps the values, validates them and stores them: an `apply`
 * that rejects shows its message under the form. This panel renders only the
 * declared fields, with Pi Web's own blocks, so nothing the extension writes
 * becomes markup.
 */

const STATUS_POLL_MS = 2500;

const inputStyle: CSSProperties = {
  width: "100%",
  minWidth: 0,
  height: 32,
  padding: "0 10px",
  border: "1px solid var(--border)",
  borderRadius: 6,
  background: "var(--bg-panel)",
  color: "var(--text)",
  fontFamily: "var(--font-mono)",
  fontSize: 12,
  outline: "none",
};

type Message = { kind: "ok" | "error"; text: string };

/** Red for a failure, the accent while healthy: the colours Settings already uses. */
function dotColor(state: SettingsSectionStatus["state"]): string | undefined {
  if (state === "ok" || state === "busy") return "var(--accent)";
  if (state === "warn" || state === "error") return "#ef4444";
  return "var(--text-dim)";
}

function rowKey(field: SettingsField, index: number): string {
  return field.kind === "readonly" ? `readonly-${index}` : field.key;
}

export function ExtensionSettingsSection({ descriptor }: { descriptor: SettingsSectionDescriptor }) {
  const { t, locale } = useI18n();
  const [values, setValues] = useState<Record<string, SettingsFieldValue> | null>(null);
  const [status, setStatus] = useState<SettingsSectionStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [revealed, setRevealed] = useState<ReadonlySet<string>>(() => new Set());
  const [message, setMessage] = useState<Message | null>(null);
  const mountedRef = useRef(true);
  const readRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const read = useCallback(async (): Promise<void> => {
    try {
      const answer = await readSettingsSection(descriptor.id);
      if (!mountedRef.current) return;
      setValues(initialFieldValues(descriptor, answer.values));
      setStatus(answer.status);
    } catch (cause) {
      if (!mountedRef.current) return;
      setMessage({ kind: "error", text: describeSettingsError(cause, t("settings.extension.unavailable")) });
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [descriptor, t]);

  // The extension answers once per mounted section; reopening Settings reads again.
  useEffect(() => {
    if (readRef.current) return;
    readRef.current = true;
    void read();
  }, [read]);

  // Status only: never a field the user is editing. Stops with the section.
  useEffect(() => {
    let cancelled = false;
    const timer = setInterval(() => {
      void readSettingsSectionStatus(descriptor.id)
        .then((next) => { if (!cancelled) setStatus(next); })
        .catch(() => undefined);
    }, STATUS_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [descriptor.id]);

  const update = (key: string, value: SettingsFieldValue): void => {
    setValues((current) => (current ? { ...current, [key]: value } : current));
  };

  const apply = useCallback(async (): Promise<void> => {
    if (!values || saving) return;
    setSaving(true);
    setMessage(null);
    try {
      await applySettingsSection(descriptor.id, values);
      if (!mountedRef.current) return;
      setMessage({ kind: "ok", text: t("settings.extension.applied") });
      await read();
    } catch (cause) {
      if (!mountedRef.current) return;
      setMessage({ kind: "error", text: describeSettingsError(cause, t("settings.extension.unavailable")) });
    } finally {
      if (mountedRef.current) setSaving(false);
    }
  }, [descriptor.id, read, saving, t, values]);

  const controlsDisabled = loading || saving || values === null;
  const applyLabel = descriptor.applyLabel
    ? localizedText(descriptor.applyLabel, locale)
    : t("settings.extension.apply");

  const renderField = (field: SettingsField, index: number) => {
    const label = localizedText(field.label, locale);
    if (field.kind === "readonly") {
      return (
        <ConfigField key={rowKey(field, index)} label={label}>
          <span style={{
            fontSize: 12,
            color: "var(--text)",
            overflowWrap: "anywhere",
            ...(field.mono ? { fontFamily: "var(--font-mono)" } : {}),
          }}>
            {localizedText(field.value, locale)}
          </span>
        </ConfigField>
      );
    }
    if (field.kind === "switch") {
      return (
        <div key={rowKey(field, index)} style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ color: "var(--text-muted)", fontSize: 11, fontWeight: 500 }}>{label}</span>
          <ConfigSwitch
            checked={values?.[field.key] === true}
            disabled={controlsDisabled}
            label={label}
            onChange={(checked) => update(field.key, checked)}
          />
        </div>
      );
    }
    if (field.kind === "select") {
      return (
        <ConfigField key={rowKey(field, index)} label={label}>
          <select
            style={{ ...inputStyle, fontFamily: "inherit" }}
            aria-label={label}
            value={typeof values?.[field.key] === "string" ? values[field.key] as string : ""}
            disabled={controlsDisabled}
            onChange={(event) => update(field.key, event.target.value)}
          >
            {field.options.map((option) => (
              <option key={option.value} value={option.value}>{localizedText(option.label, locale)}</option>
            ))}
          </select>
        </ConfigField>
      );
    }
    const secret = field.kind === "password";
    const shown = secret && revealed.has(field.key);
    return (
      <ConfigField key={rowKey(field, index)} label={label}>
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <input
            style={inputStyle}
            aria-label={label}
            type={secret && !shown ? "password" : "text"}
            value={typeof values?.[field.key] === "string" ? values[field.key] as string : ""}
            disabled={controlsDisabled}
            placeholder={field.placeholder}
            spellCheck={false}
            autoComplete="off"
            onChange={(event) => update(field.key, event.target.value)}
          />
          {secret && (
            <ConfigButton
              size="small"
              variant="secondary"
              disabled={controlsDisabled}
              aria-label={shown ? t("settings.extension.hideSecret") : t("settings.extension.showSecret")}
              onClick={() => setRevealed((current) => {
                const next = new Set(current);
                if (next.has(field.key)) next.delete(field.key);
                else next.add(field.key);
                return next;
              })}
            >
              {shown ? t("settings.extension.hideSecret") : t("settings.extension.showSecret")}
            </ConfigButton>
          )}
        </div>
      </ConfigField>
    );
  };

  return (
    <div className="settings-general">
      <section className="settings-general-section">
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
          <span style={{ color: "var(--text-muted)", fontSize: 12 }}>{t("settings.extension.status")}</span>
          <ConfigStatusDot
            active={status ? status.state === "ok" || status.state === "busy" : undefined}
            color={status ? dotColor(status.state) : undefined}
          />
          <span style={{ fontSize: 12 }}>
            {status ? localizedText(status.text, locale) : loading ? t("settings.extension.loading") : ""}
          </span>
        </div>

        <div style={{ display: "grid", gap: 12 }}>
          {descriptor.fields.map(renderField)}

          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <ConfigButton variant="primary" disabled={controlsDisabled} onClick={() => void apply()}>
              {saving ? t("settings.extension.applying") : applyLabel}
            </ConfigButton>
            {message && (
              <span
                role={message.kind === "error" ? "alert" : "status"}
                className={message.kind === "error" ? "settings-general-error" : "settings-general-description"}
                style={message.kind === "ok" ? { margin: 0, color: "var(--accent)" } : { margin: 0 }}
              >
                {message.text}
              </span>
            )}
          </div>
        </div>

        {(descriptor.notes ?? []).map((note, index) => (
          <p key={index} className="settings-general-description">{localizedText(note, locale)}</p>
        ))}
      </section>
    </div>
  );
}

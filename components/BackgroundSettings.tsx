"use client";

import { useRef, useState, type ChangeEvent } from "react";
import { useBackgroundAppearance } from "@/hooks/useBackgroundAppearance";
import { useI18n } from "@/hooks/useI18n";
import { ConfigButton } from "./SettingsUi";

export function BackgroundSettings() {
  const { t } = useI18n();
  const {
    activeId,
    opacity,
    history,
    loading,
    error: storageError,
    addBackground,
    removeBackground,
    selectBackground,
    setOpacity,
  } = useBackgroundAppearance();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const handleFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setBusy(true);
    setActionError(null);
    try {
      await addBackground(file);
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  const handleRemove = async (id: string) => {
    setBusy(true);
    setActionError(null);
    try {
      await removeBackground(id);
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="settings-background">
      <div className="settings-background-header">
        <div>
          <h4>{t("settings.backgroundImage")}</h4>
          <p>{t("settings.backgroundDescription")}</p>
        </div>
        <div className="settings-background-actions">
          <input ref={inputRef} type="file" accept="image/*" onChange={(event) => void handleFile(event)} className="sr-only" />
          <ConfigButton size="small" variant="secondary" disabled={busy || loading} onClick={() => inputRef.current?.click()}>
            {busy ? t("settings.backgroundSaving") : t("settings.backgroundChoose")}
          </ConfigButton>
          <ConfigButton size="small" variant="ghost" disabled={!activeId} onClick={() => selectBackground(null)}>
            {t("settings.backgroundDisable")}
          </ConfigButton>
        </div>
      </div>

      <div className="settings-background-opacity">
        <div className="settings-chat-range-header">
          <label htmlFor="settings-background-opacity">{t("settings.backgroundOpacity")}</label>
          <output htmlFor="settings-background-opacity">{opacity}%</output>
          <span aria-hidden="true" />
        </div>
        <input
          id="settings-background-opacity"
          type="range"
          min={0}
          max={100}
          step={1}
          value={opacity}
          disabled={!activeId}
          onChange={(event) => setOpacity(Number(event.target.value))}
        />
      </div>

      {history.length > 0 && (
        <div className="settings-background-history-wrap">
          <div className="settings-background-history-title">
            <span>{t("settings.backgroundHistory")}</span>
            <span>{history.length}/20</span>
          </div>
          <div className="settings-background-history">
            {history.map((item) => (
              <div key={item.id} className="settings-background-item">
                <button
                  type="button"
                  className="settings-background-thumbnail"
                  aria-pressed={activeId === item.id}
                  title={item.name}
                  aria-label={t("settings.backgroundUse", { name: item.name })}
                  onClick={() => selectBackground(item.id)}
                >
                  <img src={item.url} alt="" />
                </button>
                <button
                  type="button"
                  className="settings-background-remove"
                  disabled={busy}
                  title={t("settings.backgroundRemove")}
                  aria-label={t("settings.backgroundRemoveNamed", { name: item.name })}
                  onClick={() => void handleRemove(item.id)}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {(actionError || storageError) && <p role="alert" className="settings-general-error">{actionError || storageError}</p>}
    </div>
  );
}

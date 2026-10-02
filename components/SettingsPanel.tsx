"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useI18n } from "@/hooks/useI18n";
import { useTheme } from "@/hooks/useTheme";
import { useBackground, INTERVAL_OPTIONS_SEC, formatIntervalSec } from "@/hooks/useBackground";
import { THEME_OPTIONS } from "@/lib/theme";
import { ThemeIcon } from "./ThemeIcon";
import {
  CHAT_CONTENT_WIDTH_DEFAULT,
  CHAT_CONTENT_WIDTH_MAX,
  CHAT_CONTENT_WIDTH_MIN,
  CHAT_CONTENT_FONT_SIZE_DEFAULT,
  CHAT_CONTENT_FONT_SIZE_MAX,
  CHAT_CONTENT_FONT_SIZE_MIN,
  useChatAppearance,
} from "@/hooks/useChatAppearance";
import { useEnterSendMode, setEnterSendMode } from "@/hooks/useEnterSendMode";
import { sendAgentCommand } from "@/lib/agent-client";
import type { ToolSettingsResponse } from "@/lib/api-types";
import {
  setLastSettingsSection,
  type SettingsSection,
} from "@/lib/settings-navigation";
import {
  isThinkingExpandedByDefault,
  setThinkingExpandedByDefault,
} from "@/lib/thinking-expansion-preference";
import { ModelsConfig } from "./ModelsConfig";
import { setupPushSubscription } from "@/lib/push-client";
import { SkillsConfig } from "./SkillsConfig";
import { AgentsConfig } from "./AgentsConfig";
import { PluginsConfig } from "./PluginsConfig";
import { ConfigButton, ConfigSwitch } from "./SettingsUi";

interface Props {
  cwd: string | null;
  sessionId: string | null;
  initialSection: SettingsSection;
  onClose: () => void;
  onSessionReloaded: () => void;
  quoteSelectionEnabled: boolean;
  onQuoteSelectionChange: (enabled: boolean) => void;
  undockable?: boolean;
  standalone?: boolean;
}

export function SettingsSectionIcon({ section, size = 16, strokeWidth = 1.8 }: { section: SettingsSection; size?: number; strokeWidth?: number }) {
  const common = {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
    className: "settings-section-icon",
  };

  if (section === "general") return <svg {...common}><path d="M20 7h-9M14 17H5" /><circle cx="7" cy="7" r="3" /><circle cx="17" cy="17" r="3" /></svg>;
  if (section === "models") return <svg {...common}><rect x="4" y="4" width="16" height="16" rx="2" /><rect x="9" y="9" width="6" height="6" /><path d="M9 1v3M15 1v3M9 20v3M15 20v3M20 9h3M20 15h3M1 9h3M1 15h3" /></svg>;
  if (section === "skills") return <svg {...common}><path d="m12 2-10 5 10 5 10-5-10-5Z" /><path d="m2 12 10 5 10-5M2 17l10 5 10-5" /></svg>;
  if (section === "agents") return <svg {...common} className="settings-section-icon is-agent"><rect x="5" y="7" width="14" height="11" rx="2" /><path d="M9 11h.01M15 11h.01M9 15h6M12 7V4M10 4h4" /></svg>;
  return <svg {...common}><path d="M9 7V2M15 7V2M6 13V8a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v5a6 6 0 0 1-12 0ZM12 19v3" /></svg>;
}

function GeneralSettings({ sessionId, onSessionReloaded, quoteSelectionEnabled, onQuoteSelectionChange }: Pick<Props, "sessionId" | "onSessionReloaded" | "quoteSelectionEnabled" | "onQuoteSelectionChange">) {
  const { locale, setLocale, supportedLocales, t } = useI18n();
  const { preference, setThemePreference } = useTheme();
  const {
    enabled: bgEnabled,
    coverage: bgCoverage,
    sound: bgSound,
    dim: bgDim,
    intervalSec: bgIntervalSec,
    order: bgOrder,
    items: bgItems,
    currentIndex: bgCurrentIndex,
    currentItem: bgCurrentItem,
    addFiles: bgAddFiles,
    removeItem: bgRemoveItem,
    removeAll: bgRemoveAll,
    setEnabled: bgSetEnabled,
    setCoverage: bgSetCoverage,
    setSound: bgSetSound,
    setDim: bgSetDim,
    setIntervalSec: bgSetIntervalSec,
    setCurrentIndex: bgSetCurrentIndex,
  } = useBackground();
  const { width: chatContentWidth, setWidth: setChatContentWidth, fontSize, setFontSize } = useChatAppearance();
  const enterSendMode = useEnterSendMode();
  const [shellSettings, setShellSettings] = useState<ToolSettingsResponse | null>(null);
  const [shellSaving, setShellSaving] = useState(false);
  const [shellError, setShellError] = useState<string | null>(null);
  const [thinkingExpanded, setThinkingExpanded] = useState(false);
  const [pushRegistering, setPushRegistering] = useState(false);
  const [pushStatus, setPushStatus] = useState<{ kind: "ok" | "error"; message: string } | null>(null);
  const [webAuthEnabled, setWebAuthEnabled] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [logoutError, setLogoutError] = useState("");

  useEffect(() => {
    setThinkingExpanded(isThinkingExpandedByDefault());
    void fetch("/api/web-auth")
      .then((response) => response.ok ? response.json() : null)
      .then((data: { enabled?: boolean } | null) => setWebAuthEnabled(data?.enabled === true))
      .catch(() => {});
  }, []);

  const logOut = async () => {
    setLoggingOut(true);
    setLogoutError("");
    try {
      const response = await fetch("/api/web-auth", { method: "DELETE" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      window.location.replace("/login");
    } catch {
      setLogoutError(t("auth.logoutFailed"));
    } finally {
      setLoggingOut(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/tools/settings")
      .then(async (response) => {
        const data = await response.json() as ToolSettingsResponse & { error?: string };
        if (!response.ok || data.error) throw new Error(data.error ?? `HTTP ${response.status}`);
        if (!cancelled) setShellSettings(data);
      })
      .catch((cause) => {
        if (!cancelled) setShellError(cause instanceof Error ? cause.message : String(cause));
      });
    return () => { cancelled = true; };
  }, []);

  const togglePowerShell = async (enabled: boolean) => {
    setShellSaving(true);
    setShellError(null);
    try {
      const response = await fetch("/api/tools/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled }),
      });
      const data = await response.json() as ToolSettingsResponse & { error?: string };
      if (!response.ok || data.error) throw new Error(data.error ?? `HTTP ${response.status}`);
      setShellSettings(data);
      if (sessionId) {
        await sendAgentCommand(sessionId, { type: "reload" });
        onSessionReloaded();
      }
    } catch (cause) {
      setShellError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setShellSaving(false);
    }
  };

  const registerPush = async () => {
    if (pushRegistering) return;
    setPushRegistering(true);
    setPushStatus(null);
    try {
      if (typeof window === "undefined" || !("Notification" in window)) {
        throw new Error("unsupported or not permitted");
      }
      const permission = Notification.permission === "default"
        ? await Notification.requestPermission()
        : Notification.permission;
      if (permission !== "granted") throw new Error("unsupported or not permitted");
      const ok = await setupPushSubscription(locale);
      if (!ok) throw new Error("unsupported or not permitted");
      setPushStatus({ kind: "ok", message: t("settings.pushRegistered") });
    } catch (cause) {
      setPushStatus({ kind: "error", message: `${t("settings.pushRegisterFailed")} ${cause instanceof Error ? cause.message : String(cause)}` });
    } finally {
      setPushRegistering(false);
    }
  };

  return (
    <div className="settings-general">
      <h2 className="settings-general-title">{t("settings.general")}</h2>

      <section className="settings-general-section">
        <h3 className="settings-general-heading">{t("settings.appearance")}</h3>
        <div role="radiogroup" aria-label={t("settings.appearance")} className="settings-theme-options">
          {THEME_OPTIONS.map((option) => {
            const selected = preference === option.id;
            return (
              <label
                key={option.id}
                className="settings-theme-option"
              >
                <input
                  type="radio"
                  name="theme"
                  value={option.id}
                  checked={selected}
                  onChange={() => setThemePreference(option.id)}
                  className="sr-only"
                />
                <ThemeIcon preference={option.id} />
                <span className="settings-theme-option-label">{t(option.label)}</span>
              </label>
            );
          })}
        </div>
      </section>

      <section className="settings-general-section">
        <h3 className="settings-general-heading">{t("settings.background")}</h3>
        <p className="settings-general-description">{t("settings.backgroundDescription")}</p>
        <div className="settings-bg-options">
          <label className="config-button config-button-small config-button-secondary settings-bg-pick">
            <input
              type="file"
              accept="image/*,video/*"
              multiple
              className="sr-only"
              onChange={(event) => {
                if (event.target.files && event.target.files.length > 0) {
                  bgAddFiles(event.target.files);
                  event.target.value = "";
                }
              }}
            />
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M4 15a2 2 0 0 0 2 2h2" /><path d="M18 8a2 2 0 0 0-2-2h-2" /><circle cx="12" cy="13" r="8" /><path d="M12 9v8" /><path d="M8 13h8" />
            </svg>
            {t("settings.bgPick")}
          </label>

          {bgOrder.length > 0 && (
            <div className="settings-bg-list-wrap">
              <div className="settings-bg-list-heading">
                <span>{t("settings.bgList")}（{bgOrder.length}）</span>
                <button type="button" className="config-button config-button-small config-button-ghost" onClick={bgRemoveAll}>
                  {t("settings.bgClearAll")}
                </button>
              </div>
              <ul className="settings-bg-list">
                {bgOrder.map((item, index) => {
                  const itemData = bgItems.find((bg) => bg.id === item.id);
                  return (
                    <li
                      key={item.id}
                      className={bgItems.length > 0 && index === bgCurrentIndex ? "is-current" : ""}
                      onClick={() => bgSetCurrentIndex(index)}
                      title={t("settings.bgSelect")}
                    >
                      <span className="settings-bg-thumb" aria-hidden="true">
                        {itemData && itemData.kind === "video" ? (
                          <video src={itemData.url} muted playsInline />
                        ) : itemData ? (
                          <img src={itemData.url} alt="" />
                        ) : (
                          <span className="settings-bg-list-kind">{item.kind === "video" ? "▶" : "▣"}</span>
                        )}
                      </span>
                      <span className="settings-bg-list-name" title={item.name}>{item.name}</span>
                      <button
                        type="button"
                        className="settings-bg-list-remove"
                        title={t("settings.bgRemove")}
                        aria-label={`${t("settings.bgRemove")}: ${item.name}`}
                        onClick={(event) => { event.stopPropagation(); bgRemoveItem(item.id); }}
                      >
                        ×
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          {bgCurrentItem && (
            <div className="settings-bg-preview">
              {bgCurrentItem.kind === "video" ? (
                <video src={bgCurrentItem.url} muted autoPlay loop playsInline />
              ) : (
                <img src={bgCurrentItem.url} alt="" />
              )}
            </div>
          )}

          <div className="settings-chat-option settings-chat-switch-option">
            <span>{t("settings.bgEnabled")}</span>
            <ConfigSwitch checked={bgEnabled} label={t("settings.bgEnabled")} onChange={bgSetEnabled} />
          </div>

          <div className="settings-chat-option settings-chat-switch-option">
            <span>{t("settings.bgVideoSound")}</span>
            <ConfigSwitch checked={bgSound} label={t("settings.bgVideoSound")} onChange={bgSetSound} />
          </div>

          <div className="settings-chat-option settings-chat-range-option">
            <div className="settings-chat-range-header">
              <label id="settings-bg-coverage">{t("settings.bgCoverage")}</label>
            </div>
            <div role="radiogroup" aria-labelledby="settings-bg-coverage" className="settings-bg-radios">
              <label className="settings-bg-radio">
                <input type="radio" name="bg-coverage" value="full" checked={bgCoverage === "full"} onChange={() => bgSetCoverage("full")} />
                <span>{t("settings.bgCoverageFull")}</span>
              </label>
              <label className="settings-bg-radio">
                <input type="radio" name="bg-coverage" value="chat" checked={bgCoverage === "chat"} onChange={() => bgSetCoverage("chat")} />
                <span>{t("settings.bgCoverageChat")}</span>
              </label>
            </div>
          </div>

          <div className="settings-chat-option settings-chat-range-option">
            <div className="settings-chat-range-header">
              <label htmlFor="settings-bg-interval">{t("settings.bgInterval")}</label>
              <output htmlFor="settings-bg-interval">{formatIntervalSec(bgIntervalSec, t("settings.bgIntervalNever"))}</output>
            </div>
            <select
              id="settings-bg-interval"
              className="settings-bg-interval-select"
              value={bgIntervalSec}
              onChange={(event) => bgSetIntervalSec(Number(event.target.value))}
            >
              {INTERVAL_OPTIONS_SEC.map((sec) => (
                <option key={sec} value={sec}>
                  {formatIntervalSec(sec, t("settings.bgIntervalNever"))}
                </option>
              ))}
            </select>
          </div>

          <div className="settings-chat-option settings-chat-range-option">
            <div className="settings-chat-range-header">
              <label htmlFor="settings-bg-dim">{t("settings.bgDim")}</label>
              <output htmlFor="settings-bg-dim">{Math.round(bgDim * 100)}%</output>
            </div>
            <input
              id="settings-bg-dim"
              type="range"
              min={0}
              max={80}
              step={5}
              value={Math.round(bgDim * 100)}
              onChange={(event) => bgSetDim(Number(event.target.value) / 100)}
            />
          </div>
        </div>
      </section>

      <section className="settings-general-section">
        <h3 className="settings-general-heading">{t("settings.chat")}</h3>
        <div className="settings-chat-options">
          <div className="settings-chat-option settings-chat-switch-option">
            <span>{t("settings.thinkingExpandedDefault")}</span>
            <ConfigSwitch
              checked={thinkingExpanded}
              label={t("settings.thinkingExpandedDefault")}
              onChange={(enabled) => {
                setThinkingExpandedByDefault(enabled);
                setThinkingExpanded(enabled);
              }}
            />
          </div>
          <div className="settings-chat-option settings-chat-range-option">
            <div className="settings-chat-range-header">
              <label htmlFor="settings-chat-content-width">{t("settings.chatContentWidth")}</label>
              <output htmlFor="settings-chat-content-width">{chatContentWidth}px</output>
              <ConfigButton
                variant="ghost"
                size="small"
                className="settings-chat-reset"
                title={t("settings.resetChatContentWidth")}
                aria-label={t("settings.resetChatContentWidth")}
                disabled={chatContentWidth === CHAT_CONTENT_WIDTH_DEFAULT}
                onClick={() => setChatContentWidth(CHAT_CONTENT_WIDTH_DEFAULT)}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8M3 3v5h5" />
                </svg>
              </ConfigButton>
            </div>
            <input
              id="settings-chat-content-width"
              type="range"
              min={CHAT_CONTENT_WIDTH_MIN}
              max={CHAT_CONTENT_WIDTH_MAX}
              step={10}
              value={chatContentWidth}
              onChange={(event) => setChatContentWidth(Number(event.target.value))}
            />
          </div>
          <div className="settings-chat-option settings-chat-range-option">
            <div className="settings-chat-range-header">
              <label htmlFor="settings-chat-content-font-size">{t("settings.chatContentFontSize")}</label>
              <output htmlFor="settings-chat-content-font-size">{fontSize}px</output>
              <ConfigButton
                variant="ghost"
                size="small"
                className="settings-chat-reset"
                title={t("settings.resetChatContentFontSize")}
                aria-label={t("settings.resetChatContentFontSize")}
                disabled={fontSize === CHAT_CONTENT_FONT_SIZE_DEFAULT}
                onClick={() => setFontSize(CHAT_CONTENT_FONT_SIZE_DEFAULT)}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8M3 3v5h5" />
                </svg>
              </ConfigButton>
            </div>
            <input
              id="settings-chat-content-font-size"
              type="range"
              min={CHAT_CONTENT_FONT_SIZE_MIN}
              max={CHAT_CONTENT_FONT_SIZE_MAX}
              step={1}
              value={fontSize}
              onChange={(event) => setFontSize(Number(event.target.value))}
            />
          </div>
          <div className="settings-chat-option settings-chat-switch-option">
            <span>{t("settings.quoteSelection")}</span>
            <ConfigSwitch
              checked={quoteSelectionEnabled}
              label={t("settings.quoteSelection")}
              onChange={onQuoteSelectionChange}
            />
          </div>
          <div className="settings-chat-option settings-chat-switch-option" role="radiogroup" aria-label={t("settings.enterSendMode")}>
            <span>{t("settings.enterSendMode")}</span>
            <div className="settings-send-mode-options">
              <label className="settings-send-mode-option">
                <input
                  type="radio"
                  name="enter-send-mode"
                  value="enter"
                  checked={enterSendMode === "enter"}
                  onChange={() => setEnterSendMode("enter")}
                  className="sr-only"
                />
                <span className="settings-send-mode-label">{t("settings.enterSendModeEnter")}</span>
              </label>
              <label className="settings-send-mode-option">
                <input
                  type="radio"
                  name="enter-send-mode"
                  value="ctrlEnter"
                  checked={enterSendMode === "ctrlEnter"}
                  onChange={() => setEnterSendMode("ctrlEnter")}
                  className="sr-only"
                />
                <span className="settings-send-mode-label">{t("settings.enterSendModeCtrlEnter")}</span>
              </label>
            </div>
          </div>
        </div>
      </section>

      {shellSettings?.isWindows && (
        <section className="settings-general-section">
          <h3 className="settings-general-heading">{t("settings.shellTool")}</h3>
          <p className="settings-general-description">{t("settings.shellToolDescription")}</p>
          <div className="settings-shell-option">
            <span>{t("settings.usePowerShell")}</span>
            <ConfigSwitch
              checked={shellSettings.powerShellEnabled}
              loading={shellSaving}
              label={t("settings.usePowerShell")}
              onChange={(enabled) => void togglePowerShell(enabled)}
            />
          </div>
          {shellError && <p role="alert" className="settings-general-error">{shellError}</p>}
        </section>
      )}

      <section className="settings-general-section">
        <h3 className="settings-general-heading">{t("settings.pushPermission")}</h3>
        <p className="settings-general-description">{t("settings.pushPermissionDescription")}</p>
        <div className="settings-shell-option">
          <span>{t("settings.pushPermission")}</span>
          <button
            type="button"
            className="config-button config-button-small config-button-secondary"
            disabled={pushRegistering}
            onClick={() => void registerPush()}
          >
            {pushRegistering ? t("settings.pushRegisterLoading") : t("settings.pushRegister")}
          </button>
        </div>
        {pushStatus && (
          <p
            role="status"
            className="settings-general-error"
            style={pushStatus.kind === "ok" ? { color: "var(--accent)" } : undefined}
          >
            {pushStatus.message}
          </p>
        )}
      </section>

      <section className="settings-general-section">
        <h3 className="settings-general-heading">{t("common.language")}</h3>
        <div role="radiogroup" aria-label={t("common.language")} className="settings-language-options">
          {supportedLocales.map((plugin) => {
            const selected = locale === plugin.id;
            return (
              <button
                key={plugin.id}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => setLocale(plugin.id as typeof locale)}
                className="settings-language-option"
              >
                <span className="settings-language-radio">
                  {selected && <span className="settings-language-radio-dot" />}
                </span>
                <span className="settings-language-label">{plugin.label}</span>
                <span className="settings-language-code">{plugin.id}</span>
              </button>
            );
          })}
        </div>
      </section>

      {webAuthEnabled && (
        <section className="settings-general-section">
          <ConfigButton variant="secondary" disabled={loggingOut} onClick={() => void logOut()}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M10 17l5-5-5-5M15 12H3M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" />
            </svg>
            {loggingOut ? t("auth.loggingOut") : t("auth.logOut")}
          </ConfigButton>
          {logoutError && <p role="alert" className="settings-general-error">{logoutError}</p>}
        </section>
      )}
    </div>
  );
}

export function SettingsPanel({ cwd, sessionId, initialSection, onClose, onSessionReloaded, quoteSelectionEnabled, onQuoteSelectionChange, undockable = true, standalone = false }: Props) {
  const { t } = useI18n();
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const dragStart = useRef<{ dx: number; dy: number } | null>(null);
  const [maximized, setMaximized] = useState(false);

  // 小窗口适配：对话框支持按住标题栏拖动（默认居中，拖动后变为自由定位）。
  // 拖动范围限制在窗口内，避免面板拖出窗口导致内容被裁剪。
  const onHeaderPointerDown = (event: React.PointerEvent) => {
    if (event.button !== 0 || maximized) return;
    if ((event.target as HTMLElement).closest(".settings-dialog-close, .settings-dialog-maximize")) return;
    const surface = surfaceRef.current;
    if (!surface) return;
    const rect = surface.getBoundingClientRect();
    surface.style.position = "fixed";
    surface.style.left = `${rect.left}px`;
    surface.style.top = `${rect.top}px`;
    surface.style.margin = "0";
    dragStart.current = { dx: event.clientX - rect.left, dy: event.clientY - rect.top };
    const onMove = (ev: PointerEvent) => {
      if (!dragStart.current) return;
      const w = surface.offsetWidth, h = surface.offsetHeight;
      const vw = window.innerWidth, vh = window.innerHeight;
      // 面板始终保持在窗口内：内容不可能被拖出裁剪
      const left = Math.max(Math.min(ev.clientX - dragStart.current.dx, vw - Math.min(w, vw)), Math.min(0, vw - w));
      const top = Math.max(Math.min(ev.clientY - dragStart.current.dy, vh - Math.min(h, vh)), Math.min(0, vh - h));
      surface.style.left = `${left}px`;
      surface.style.top = `${top}px`;
    };
    const onUp = () => {
      dragStart.current = null;
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  // 最大化：铺满窗口（内部滚动），小窗口下最方便；再点一次还原居中
  const toggleMaximize = () => {
    const surface = surfaceRef.current;
    if (!surface) return;
    if (!maximized) {
      surface.style.cssText = "position:fixed; left:8px; top:8px; width:calc(100vw - 16px); height:calc(100dvh - 16px); margin:0; max-width:none; max-height:none;";
      setMaximized(true);
    } else {
      surface.style.cssText = "";
      setMaximized(false);
    }
  };

  // 移出到桌面：在独立窗口打开设置面板（Pi 桌面壳会弹出真·系统窗口，可拖到桌面任意位置）
  const undock = () => {
    const cwdParam = cwd ? `&cwd=${encodeURIComponent(cwd)}` : "";
    const url = `${window.location.origin}/settings?section=${section}${cwdParam}`;
    window.open(url, "pi-settings", "width=1000,height=720");
  };

  const [section, setSection] = useState<SettingsSection>(initialSection);
  const [mountedSections, setMountedSections] = useState<ReadonlySet<SettingsSection>>(
    () => new Set([section]),
  );
  const sections: { id: SettingsSection; label: string; requiresProject: boolean }[] = [
    { id: "general", label: t("settings.general"), requiresProject: false },
    { id: "models", label: t("common.models"), requiresProject: false },
    { id: "skills", label: t("common.skills"), requiresProject: true },
    { id: "agents", label: t("common.agents"), requiresProject: true },
    { id: "plugins", label: t("common.plugins"), requiresProject: true },
  ];

  useEffect(() => setLastSettingsSection(initialSection), [initialSection]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      event.preventDefault();
      onClose();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  useEffect(() => {
    if (cwd || (section !== "skills" && section !== "agents" && section !== "plugins")) return;
    setSection("general");
    setMountedSections((current) => new Set(current).add("general"));
    setLastSettingsSection("general");
  }, [cwd, section]);

  const activateSection = (nextSection: SettingsSection) => {
    setMountedSections((current) => new Set(current).add(nextSection));
    setSection(nextSection);
    setLastSettingsSection(nextSection);
  };

  const sectionHost = (id: SettingsSection, content: ReactNode) => mountedSections.has(id) ? (
    <div
      key={id}
      hidden={section !== id}
      className="settings-section-host"
    >
      {content}
    </div>
  ) : null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t("settings.title")}
      onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}
      className={standalone ? "settings-dialog-backdrop settings-dialog-backdrop-standalone" : "settings-dialog-backdrop"}
    >
      <div className={standalone ? "settings-dialog-surface settings-dialog-surface-standalone" : "settings-dialog-surface"} ref={surfaceRef}>
        <div className="settings-dialog-header" onPointerDown={standalone ? undefined : onHeaderPointerDown}>
          <strong className="settings-dialog-title">{t("settings.title")}</strong>
          <select
            aria-label={t("settings.title")}
            value={section}
            onChange={(event) => activateSection(event.target.value as SettingsSection)}
            className="settings-mobile-section-picker"
          >
            {sections.map((item) => (
              <option key={item.id} value={item.id} disabled={item.requiresProject && !cwd}>
                {item.label}
              </option>
            ))}
          </select>
          <nav aria-label={t("settings.title")} className="settings-section-tabs">
            {sections.map((item) => {
              const selected = section === item.id;
              const disabled = item.requiresProject && !cwd;
              return (
                <button
                  key={item.id}
                  type="button"
                  className="settings-section-tab"
                  disabled={disabled}
                  title={disabled ? t("settings.projectRequired") : item.label}
                  aria-current={selected ? "page" : undefined}
                  onClick={() => activateSection(item.id)}
                >
                  <SettingsSectionIcon section={item.id} />
                  <span>{item.label}</span>
                </button>
              );
            })}
          </nav>
          {undockable !== false && (
            <button type="button" onClick={undock} title={t("settings.undock")} aria-label={t("settings.undock")} className="config-close-button settings-dialog-undock">⧉</button>
          )}
          {!standalone && (
            <button type="button" onClick={toggleMaximize} title={maximized ? t("i18n.restore") : t("i18n.maximize")} aria-label={maximized ? t("i18n.restore") : t("i18n.maximize")} className="config-close-button settings-dialog-maximize">
              {maximized ? "⤡" : "⤢"}
            </button>
          )}
          {!standalone && (
            <button type="button" onClick={onClose} title={t("i18n.close")} aria-label={t("i18n.close")} className="config-close-button settings-dialog-close">×</button>
          )}
        </div>

        <main className="settings-dialog-main">
          {sectionHost("general", <GeneralSettings sessionId={sessionId} onSessionReloaded={onSessionReloaded} quoteSelectionEnabled={quoteSelectionEnabled} onQuoteSelectionChange={onQuoteSelectionChange} />)}
          {sectionHost("models", <ModelsConfig embedded cwd={cwd} onClose={onClose} />)}
          {cwd && sectionHost("skills", <SkillsConfig embedded key={cwd} cwd={cwd} onClose={onClose} />)}
          {cwd && sectionHost("agents", <AgentsConfig embedded key={cwd} cwd={cwd} sessionId={sessionId} onClose={onClose} onReloaded={onSessionReloaded} />)}
          {cwd && sectionHost("plugins", <PluginsConfig embedded key={cwd} cwd={cwd} sessionId={sessionId} onClose={onClose} onReloaded={onSessionReloaded} />)}
        </main>
      </div>
    </div>
  );
}

"use client";

import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactElement,
} from "react";
import { useI18n } from "@/hooks/useI18n";
import { useIsMobile } from "@/hooks/useIsMobile";
import { useTheme } from "@/hooks/useTheme";
import type { Locale } from "@/lib/i18n/types";
import { ModelsConfig } from "./ModelsConfig";
import { PasswordChangeForm } from "./PasswordChangeForm";
import { PluginsConfig } from "./PluginsConfig";
import { SkillsConfig } from "./SkillsConfig";

const FOCUSABLE_SELECTOR = [
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[href]",
  '[tabindex]:not([tabindex="-1"])',
].join(", ");

/**
 * 设置中心一级菜单标识，用于关联 tab 与对应 panel。
 */
export type SettingsSection = "general" | "models" | "skills" | "plugins" | "security";

/**
 * 设置中心属性，包含当前应用上下文和设置操作完成后的回调。
 */
export interface SettingsModalProps {
  /** 当前项目工作目录；未选择项目时为 null。 */
  cwd: string | null;
  /** 当前会话 ID；没有活动会话时为 null。 */
  sessionId: string | null;
  /** 应用层认证错误。 */
  authError: string | null;
  /** 请求关闭设置中心。 */
  onClose: () => void;
  /** 模型配置保存成功后的回调。 */
  onModelsSaved: () => void;
  /** 插件触发会话重载后的回调。 */
  onSessionReloaded: () => void;
  /** 密码修改成功后的回调。 */
  onPasswordChanged: () => void;
}

function GeneralSettings(): ReactElement {
  const { isDark, toggleTheme } = useTheme();
  const { locale, setLocale, supportedLocales, t: translate } = useI18n();

  return (
    <div className="settings-general">
      <fieldset className="settings-fieldset">
        <legend>{translate("settings.theme")}</legend>
        <div className="settings-choice-grid">
          {([
            { id: "light", label: translate("settings.light") },
            { id: "dark", label: translate("settings.dark") },
          ] as const).map(option => {
            const selected = option.id === (isDark ? "dark" : "light");
            return (
              <button
                key={option.id}
                type="button"
                className="settings-choice"
                aria-pressed={selected}
                onClick={event => {
                  if (selected) return;
                  const rect = event.currentTarget.getBoundingClientRect();
                  toggleTheme({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
                }}
              >
                {option.label}
              </button>
            );
          })}
        </div>
      </fieldset>
      <fieldset className="settings-fieldset">
        <legend>{translate("common.language")}</legend>
        <div className="settings-choice-grid">
          {supportedLocales.map(plugin => (
            <button
              key={plugin.id}
              type="button"
              className="settings-choice"
              aria-pressed={plugin.id === locale}
              onClick={() => setLocale(plugin.id as Locale)}
            >
              {plugin.label}
            </button>
          ))}
        </div>
      </fieldset>
    </div>
  );
}

/**
 * 渲染统一设置中心，并管理导航、焦点约束和各设置面板的生命周期。
 *
 * @param props - 设置中心属性。
 * @param props.cwd - 当前项目工作目录。
 * @param props.sessionId - 当前会话 ID。
 * @param props.authError - 应用层认证错误。
 * @param props.onClose - 请求关闭设置中心的回调。
 * @param props.onModelsSaved - 模型配置保存成功后的回调。
 * @param props.onSessionReloaded - 插件触发会话重载后的回调。
 * @param props.onPasswordChanged - 密码修改成功后的回调。
 * @returns 具有可访问 tab 导航和焦点约束的设置 dialog。
 * @throws 不直接抛出异常；子设置组件自行处理请求错误。
 */
export function SettingsModal({
  cwd,
  sessionId,
  authError,
  onClose,
  onModelsSaved,
  onSessionReloaded,
  onPasswordChanged,
}: SettingsModalProps): ReactElement {
  const { t: translate } = useI18n();
  const isMobile = useIsMobile();
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const generalTabRef = useRef<HTMLButtonElement>(null);
  const [activeSection, setActiveSection] = useState<SettingsSection>("general");
  const [visitedSections, setVisitedSections] = useState<Set<SettingsSection>>(() => new Set(["general"]));

  const sections: Array<{ id: SettingsSection; label: string; disabled: boolean }> = [
    { id: "general", label: translate("settings.general"), disabled: false },
    { id: "models", label: translate("common.models"), disabled: false },
    { id: "skills", label: translate("common.skills"), disabled: !cwd },
    { id: "plugins", label: translate("common.plugins"), disabled: !cwd },
    { id: "security", label: translate("settings.security"), disabled: false },
  ];
  const projectRequired = translate("settings.projectRequired");

  useEffect(() => {
    const previouslyFocused = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    closeButtonRef.current?.focus();
    return () => {
      if (previouslyFocused?.isConnected) previouslyFocused.focus();
    };
  }, []);

  const activeSectionDisabled = sections.some(
    section => section.id === activeSection && section.disabled,
  );

  useEffect(() => {
    // 仅当已选择的项目页因 cwd 消失而失效时回退，不干扰首次打开的初始焦点。
    if (!activeSectionDisabled) return;
    setActiveSection("general");
    generalTabRef.current?.focus();
  }, [activeSectionDisabled]);

  function selectSection(section: SettingsSection, disabled: boolean): void {
    if (disabled) return;
    setActiveSection(section);
    setVisitedSections(current => {
      if (current.has(section)) return current;
      const next = new Set(current);
      next.add(section);
      return next;
    });
  }

  function handleDialogKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    // 子 dialog 已消费的 Escape 不应关闭设置中心。
    if (event.defaultPrevented) return;
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onClose();
      return;
    }
    if (event.key !== "Tab") return;

    const focusable = Array.from(
      dialogRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR) ?? [],
    ).filter(element => (
      !element.closest('[hidden], [aria-hidden="true"]')
      && element.getClientRects().length > 0
    ));
    if (focusable.length === 0) {
      event.preventDefault();
      dialogRef.current?.focus();
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  function handleTabKeyDown(event: KeyboardEvent<HTMLButtonElement>, current: SettingsSection): void {
    const directionKeys = isMobile ? ["ArrowLeft", "ArrowRight"] : ["ArrowUp", "ArrowDown"];
    if (!directionKeys.includes(event.key)) return;
    event.preventDefault();

    const availableSections = sections.filter(section => !section.disabled);
    const currentIndex = availableSections.findIndex(section => section.id === current);
    const offset = event.key === directionKeys[0] ? -1 : 1;
    const nextIndex = (currentIndex + offset + availableSections.length) % availableSections.length;
    const nextSection = availableSections[nextIndex];
    selectSection(nextSection.id, false);
    document.getElementById(`settings-tab-${nextSection.id}`)?.focus();
  }

  return (
    <div
      className="settings-modal"
      onMouseDown={event => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        className="settings-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
        tabIndex={-1}
        onKeyDown={handleDialogKeyDown}
        onMouseDown={event => event.stopPropagation()}
      >
        <header className="settings-header">
          <h2 id="settings-title">{translate("settings.title")}</h2>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            title={translate("i18n.close")}
            aria-label={translate("i18n.close")}
            className="settings-close"
          >
            ×
          </button>
        </header>
        <div className="settings-layout">
          <nav className="settings-navigation">
            <div
              className="settings-navigation-list"
              role="tablist"
              aria-orientation={isMobile ? "horizontal" : "vertical"}
            >
              {sections.map(section => (
                <button
                  key={section.id}
                  ref={section.id === "general" ? generalTabRef : undefined}
                  id={`settings-tab-${section.id}`}
                  type="button"
                  role="tab"
                  aria-controls={`settings-panel-${section.id}`}
                  aria-selected={activeSection === section.id}
                  aria-disabled={section.disabled ? "true" : undefined}
                  disabled={section.disabled}
                  tabIndex={activeSection === section.id ? 0 : -1}
                  title={section.disabled ? projectRequired : undefined}
                  onClick={() => selectSection(section.id, section.disabled)}
                  onKeyDown={event => handleTabKeyDown(event, section.id)}
                  className={`settings-tab${activeSection === section.id ? " settings-tab-active" : ""}`}
                >
                  {section.label}
                </button>
              ))}
            </div>
            {!cwd && (
              <p className="settings-project-required">
                {projectRequired}
              </p>
            )}
          </nav>
          <div className="settings-content">
            {sections.map(section => visitedSections.has(section.id) && (
              <section
                key={section.id}
                id={`settings-panel-${section.id}`}
                role="tabpanel"
                aria-labelledby={`settings-tab-${section.id}`}
                hidden={activeSection !== section.id}
                className="settings-content-panel"
              >
                {section.id === "general" && <GeneralSettings />}
                {section.id === "models" && <ModelsConfig onSaved={onModelsSaved} />}
                {section.id === "skills" && cwd && <SkillsConfig cwd={cwd} />}
                {section.id === "plugins" && cwd && (
                  <PluginsConfig cwd={cwd} sessionId={sessionId} onReloaded={onSessionReloaded} />
                )}
                {section.id === "security" && (
                  <div className="settings-security">
                    <PasswordChangeForm onSuccess={onPasswordChanged} />
                    {authError && <div className="auth-form-error" role="alert">{authError}</div>}
                  </div>
                )}
              </section>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

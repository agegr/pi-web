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
import { useTheme, type ThemePreference } from "@/hooks/useTheme";
import { ModelsConfig } from "./ModelsConfig";
import { OptionSelect } from "./ui/OptionSelect";
import { PasswordChangeForm } from "./PasswordChangeForm";
import { PluginsConfig } from "./PluginsConfig";
import { SegmentedControl } from "./ui/SegmentedControl";
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
 * Top-level settings menu identifier used to associate a tab with its panel.
 */
export type SettingsSection = "general" | "models" | "skills" | "plugins" | "security";

/**
 * Settings center props, including the current application context and callbacks after settings operations.
 */
export interface SettingsModalProps {
  /** Current project working directory, or null when no project is selected. */
  cwd: string | null;
  /** Current session ID, or null when no session is active. */
  sessionId: string | null;
  /** Application-level authentication error. */
  authError: string | null;
  /** Requests that the settings center close. */
  onClose: () => void;
  /** Callback invoked after model configuration is saved successfully. */
  onModelsSaved: () => void;
  /** Callback invoked after a plugin triggers a session reload. */
  onSessionReloaded: () => void;
  /** Callback invoked after the password changes successfully. */
  onPasswordChanged: () => void;
}

function GeneralSettings(): ReactElement {
  const { preference, setThemePreference } = useTheme();
  const { locale, setLocale, supportedLocales, t: translate } = useI18n();

  return (
    <div className="settings-general">
      <fieldset className="settings-fieldset">
        <legend>{translate("settings.theme")}</legend>
        <SegmentedControl
          ariaLabel={translate("settings.theme")}
          value={preference}
          options={[
            { value: "system", label: translate("settings.system") },
            { value: "light", label: translate("settings.light") },
            { value: "dark", label: translate("settings.dark") },
          ]}
          onChange={(value, event) => {
            const rect = event.currentTarget.getBoundingClientRect();
            setThemePreference(value as ThemePreference, {
              x: rect.left + rect.width / 2,
              y: rect.top + rect.height / 2,
            });
          }}
        />
      </fieldset>
      <fieldset className="settings-fieldset">
        <legend>{translate("common.language")}</legend>
        <OptionSelect
          ariaLabel={translate("common.language")}
          value={locale}
          options={supportedLocales.map(plugin => ({ value: plugin.id, label: plugin.label }))}
          onChange={value => setLocale(value)}
        />
      </fieldset>
    </div>
  );
}

/**
 * Renders the unified settings center and manages navigation, focus trapping, and settings panel lifecycles.
 *
 * @param props - Settings center props.
 * @param props.cwd - Current project working directory.
 * @param props.sessionId - Current session ID.
 * @param props.authError - Application-level authentication error.
 * @param props.onClose - Callback requesting that the settings center close.
 * @param props.onModelsSaved - Callback invoked after model configuration is saved successfully.
 * @param props.onSessionReloaded - Callback invoked after a plugin triggers a session reload.
 * @param props.onPasswordChanged - Callback invoked after the password changes successfully.
 * @returns A settings dialog with accessible tab navigation and focus trapping.
 * @throws Does not throw directly; child settings components handle request errors themselves.
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
    // Fall back only when the selected project tab becomes invalid because cwd disappeared.
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
    // Escape consumed by a child dialog must not close the settings center.
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

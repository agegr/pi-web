"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  Bell,
  Bot,
  Check,
  Cpu,
  FolderCog,
  Languages,
  Layers3,
  Monitor,
  Moon,
  Plug,
  ShieldCheck,
  SlidersHorizontal,
  Sun,
  Volume2,
  X,
} from "lucide-react";
import { useI18n } from "@/hooks/useI18n";
import type { ThemePreference } from "@/hooks/useTheme";
import type { Locale, LocalePlugin } from "@/lib/i18n/types";
import type { ProjectTrustStatus } from "@/lib/api-types";
import { ModelsConfig } from "./ModelsConfig";
import { PluginsConfig } from "./PluginsConfig";
import { SkillsConfig } from "./SkillsConfig";

type SettingsSection = "general" | "project" | "models" | "skills" | "plugins";

interface Props {
  cwd: string | null;
  sessionId: string | null;
  themePreference: ThemePreference;
  onThemeChange: (preference: ThemePreference) => void;
  locale: Locale;
  supportedLocales: LocalePlugin[];
  onLocaleChange: (locale: Locale) => void;
  soundEnabled: boolean;
  onSoundToggle: () => void;
  projectTrust: ProjectTrustStatus | null;
  projectTrustBusy: boolean;
  projectTrustError: string | null;
  onTrustProject: () => void;
  onClose: () => void;
  onModelsChanged: () => void;
  onSessionReloaded: () => void;
}

function SectionIcon({ section }: { section: SettingsSection }) {
  const icons = {
    general: SlidersHorizontal,
    project: FolderCog,
    models: Cpu,
    skills: Layers3,
    plugins: Plug,
  };
  const Icon = icons[section];
  return <Icon size={16} strokeWidth={1.8} aria-hidden="true" />;
}

export function SettingsPage({
  cwd,
  sessionId,
  themePreference,
  onThemeChange,
  locale,
  supportedLocales,
  onLocaleChange,
  soundEnabled,
  onSoundToggle,
  projectTrust,
  projectTrustBusy,
  projectTrustError,
  onTrustProject,
  onClose,
  onModelsChanged,
  onSessionReloaded,
}: Props) {
  const { t } = useI18n();
  const [section, setSection] = useState<SettingsSection>("general");
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const close = useCallback(() => {
    onModelsChanged();
    onClose();
  }, [onClose, onModelsChanged]);

  useEffect(() => {
    closeButtonRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [close]);

  const sections: { id: SettingsSection; label: string; disabled: boolean }[] = [
    { id: "general", label: t("settings.general"), disabled: false },
    { id: "project", label: t("settings.project"), disabled: false },
    { id: "models", label: t("common.models"), disabled: false },
    { id: "skills", label: t("common.skills"), disabled: !cwd },
    { id: "plugins", label: t("common.plugins"), disabled: !cwd },
  ];

  let content: ReactNode;
  if (section === "general") {
    const themes: { id: ThemePreference; label: string; Icon: typeof Sun }[] = [
      { id: "light", label: t("settings.themeLight"), Icon: Sun },
      { id: "dark", label: t("settings.themeDark"), Icon: Moon },
      { id: "auto", label: t("settings.themeSystem"), Icon: Monitor },
    ];
    content = (
      <div className="settings-form-page">
        <div className="settings-form-heading">
          <SlidersHorizontal size={18} aria-hidden="true" />
          <div><h3>{t("settings.general")}</h3><p>{t("settings.generalDescription")}</p></div>
        </div>
        <section className="settings-form-section">
          <div className="settings-form-label"><Sun size={16} aria-hidden="true" /><div><strong>{t("settings.appearance")}</strong><span>{t("settings.appearanceDescription")}</span></div></div>
          <div className="settings-segmented" role="radiogroup" aria-label={t("settings.appearance")}>
            {themes.map(({ id, label, Icon }) => (
              <button key={id} type="button" role="radio" aria-checked={themePreference === id} data-active={themePreference === id} onClick={() => onThemeChange(id)}>
                <Icon size={15} aria-hidden="true" /><span>{label}</span>
              </button>
            ))}
          </div>
        </section>
        <section className="settings-form-section">
          <label className="settings-form-label" htmlFor="settings-language"><Languages size={16} aria-hidden="true" /><div><strong>{t("common.language")}</strong><span>{t("settings.languageDescription")}</span></div></label>
          <select id="settings-language" value={locale} onChange={(event) => onLocaleChange(event.target.value as Locale)}>
            {supportedLocales.map((plugin) => <option key={plugin.id} value={plugin.id}>{plugin.label}</option>)}
          </select>
        </section>
        <section className="settings-form-section">
          <div className="settings-form-label"><Bell size={16} aria-hidden="true" /><div><strong>{t("settings.completionSound")}</strong><span>{t("settings.completionSoundDescription")}</span></div></div>
          <button className="settings-switch" type="button" role="switch" aria-checked={soundEnabled} onClick={onSoundToggle} title={t("settings.completionSound")}>
            <span /><Volume2 size={15} aria-hidden="true" />
          </button>
        </section>
      </div>
    );
  } else if (section === "project") {
    content = !cwd ? (
      <div className="settings-page-empty"><FolderCog size={20} aria-hidden="true" /><strong>{t("settings.projectRequired")}</strong><span>{t("settings.projectSettingsDescription")}</span></div>
    ) : (
      <div className="settings-form-page">
        <div className="settings-form-heading"><FolderCog size={18} aria-hidden="true" /><div><h3>{t("settings.project")}</h3><p>{t("settings.projectDescription")}</p></div></div>
        <section className="settings-form-section settings-project-path">
          <div className="settings-form-label"><Bot size={16} aria-hidden="true" /><div><strong>{t("settings.activeProject")}</strong><span>{t("settings.activeProjectDescription")}</span></div></div>
          <code title={cwd}>{cwd}</code>
        </section>
        <section className="settings-form-section">
          <div className="settings-form-label"><ShieldCheck size={16} aria-hidden="true" /><div><strong>{t("settings.projectTrust")}</strong><span>{projectTrust?.requiresTrust ? (projectTrust.trusted ? t("settings.projectTrusted") : t("settings.projectRestricted")) : t("settings.projectTrustNotRequired")}</span></div></div>
          {projectTrust?.requiresTrust && !projectTrust.trusted ? (
            <button className="settings-primary-button" type="button" disabled={projectTrustBusy} onClick={onTrustProject}>{projectTrustBusy ? t("trust.trusting") : t("trust.trustProject")}</button>
          ) : <span className="settings-status"><Check size={14} aria-hidden="true" />{t("settings.ready")}</span>}
        </section>
        {projectTrustError && <div className="settings-inline-error" role="alert">{projectTrustError}</div>}
      </div>
    );
  } else if (section === "models") {
    content = <ModelsConfig embedded onClose={close} />;
  } else if (!cwd) {
    content = (
      <div className="settings-page-empty">
        <SectionIcon section={section} />
        <strong>{t("settings.projectRequired")}</strong>
        <span>{t("settings.projectRequiredDescription")}</span>
      </div>
    );
  } else if (section === "skills") {
    content = <SkillsConfig embedded cwd={cwd} onClose={close} />;
  } else {
    content = (
      <PluginsConfig
        embedded
        cwd={cwd}
        sessionId={sessionId}
        onClose={close}
        onReloaded={onSessionReloaded}
      />
    );
  }

  return createPortal(
    <div
      className="settings-page-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="settings-page-title"
      onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }}
    >
      <div className="settings-page-shell">
        <header className="settings-page-header">
          <h2 id="settings-page-title">{t("common.settings")}</h2>
          <button ref={closeButtonRef} type="button" onClick={close} aria-label={t("i18n.close")} title={t("i18n.close")}><X size={17} aria-hidden="true" /></button>
        </header>
        <div className="settings-page-layout">
          <nav className="settings-page-nav" aria-label={t("settings.categories")}>
            {sections.map((item) => (
              <button
                key={item.id}
                type="button"
                data-active={section === item.id}
                disabled={item.disabled}
                title={item.disabled ? t("settings.selectProjectFirst") : item.label}
                onClick={() => setSection(item.id)}
              >
                <SectionIcon section={item.id} />
                <span>{item.label}</span>
              </button>
            ))}
          </nav>
          <main className="settings-page-content">{content}</main>
        </div>
      </div>
    </div>,
    document.body,
  );
}

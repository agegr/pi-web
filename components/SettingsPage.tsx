"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  Archive,
  ArchiveRestore,
  Bell,
  Bot,
  Check,
  Cpu,
  FolderCog,
  Info,
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
import type { ProjectPreference } from "@/lib/project-registry";
import { ModelsConfig } from "./ModelsConfig";
import { PluginsConfig } from "./PluginsConfig";
import { SkillsConfig } from "./SkillsConfig";

type SettingsSection = "general" | "project" | "archived" | "models" | "skills" | "plugins";

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
  onProjectsChanged: () => void;
}

function SectionIcon({ section }: { section: SettingsSection }) {
  const icons = {
    general: SlidersHorizontal,
    project: FolderCog,
    archived: Archive,
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
  onProjectsChanged,
}: Props) {
  const { t } = useI18n();
  const [section, setSection] = useState<SettingsSection>("general");
  const [projects, setProjects] = useState<ProjectPreference[]>([]);
  const [projectsLoading, setProjectsLoading] = useState(false);
  const [projectsError, setProjectsError] = useState<string | null>(null);
  const [restoringProjects, setRestoringProjects] = useState<Set<string>>(new Set());
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

  const loadProjects = useCallback(async (clearError = true) => {
    setProjectsLoading(true);
    if (clearError) setProjectsError(null);
    try {
      const response = await fetch("/api/projects", { cache: "no-store" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json() as { projects: ProjectPreference[] };
      setProjects(data.projects);
    } catch (cause) {
      setProjectsError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setProjectsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (section === "archived") void loadProjects();
  }, [loadProjects, section]);

  const restoreProject = useCallback(async (path: string) => {
    if (restoringProjects.has(path)) return;
    setRestoringProjects((current) => new Set(current).add(path));
    setProjectsError(null);
    try {
      const response = await fetch("/api/projects", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path, update: { archived: false } }),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      setProjects((current) => current.map((project) => project.path === path ? { ...project, archived: false } : project));
      onProjectsChanged();
    } catch (cause) {
      setProjectsError(cause instanceof Error ? cause.message : String(cause));
      void loadProjects(false);
    } finally {
      setRestoringProjects((current) => {
        const next = new Set(current);
        next.delete(path);
        return next;
      });
    }
  }, [loadProjects, onProjectsChanged, restoringProjects]);

  const sections: { id: SettingsSection; label: string; disabled: boolean }[] = [
    { id: "general", label: t("settings.general"), disabled: false },
    { id: "project", label: t("settings.project"), disabled: false },
    { id: "archived", label: t("sidebar.archived"), disabled: false },
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
        <section className="settings-form-section">
          <div className="settings-form-label"><Info size={16} aria-hidden="true" /><div><strong>{t("settings.about")}</strong><span>{t("settings.aboutVersion", { web: process.env.NEXT_PUBLIC_APP_VERSION ?? "0.0.0", pi: process.env.NEXT_PUBLIC_PI_VERSION ?? "0.0.0" })}</span></div></div>
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
  } else if (section === "archived") {
    const archivedProjects = projects.filter((project) => project.archived && !project.removed);
    content = (
      <div className="settings-form-page">
        <div className="settings-form-heading"><Archive size={18} aria-hidden="true" /><div><h3>{t("sidebar.archivedProjects")}</h3><p>{t("settings.archivedProjectsDescription")}</p></div></div>
        {projectsLoading ? (
          <div className="settings-page-empty"><span>{t("sidebar.loading")}</span></div>
        ) : projectsError && projects.length === 0 ? null : archivedProjects.length === 0 ? (
          <div className="settings-page-empty"><Archive size={20} aria-hidden="true" /><strong>{t("sidebar.noArchivedProjects")}</strong><span>{t("settings.archivedProjectsEmptyDescription")}</span></div>
        ) : (
          <div className="settings-archived-list">
            {archivedProjects.map((project) => (
              <div className="settings-archived-row" key={project.path}>
                <div><strong>{project.name ?? project.path.replace(/[\\/]+$/, "").split(/[\\/]/).pop() ?? project.path}</strong><span title={project.path}>{project.path}</span></div>
                <button type="button" disabled={restoringProjects.has(project.path)} onClick={() => void restoreProject(project.path)}><ArchiveRestore size={14} aria-hidden="true" />{t("sidebar.restoreProject")}</button>
              </div>
            ))}
          </div>
        )}
        {projectsError && <div className="settings-inline-error" role="alert">{projectsError}</div>}
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

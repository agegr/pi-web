"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  Archive,
  ArchiveRestore,
  Bell,
  Cpu,
  GlobeLock,
  Info,
  Languages,
  Layers3,
  Monitor,
  Moon,
  Plug,
  ScanEye,
  SlidersHorizontal,
  Sun,
  Volume2,
  X,
} from "lucide-react";
import { useI18n } from "@/hooks/useI18n";
import type { ThemePreference } from "@/hooks/useTheme";
import type { Locale, LocalePlugin } from "@/lib/i18n/types";
import { readArchivedSessionIds, writeArchivedSessionIds } from "@/lib/archived-sessions";
import { sidebarSessionTitle } from "@/lib/codex-sidebar-search";
import type { ProjectPreference } from "@/lib/project-registry";
import type { SessionInfo } from "@/lib/types";
import { ModelsConfig } from "./ModelsConfig";
import type { ModelsDraftController } from "./models-config/models-config-types";
import type { SettingsSectionController } from "./resource-settings/resource-settings-types";
import { PluginsConfig } from "./PluginsConfig";
import { SkillsConfig } from "./SkillsConfig";
import { VisionToolkitConfig, type VisionDraftController } from "./VisionToolkitConfig";
import { RemoteAccessConfig, type RemoteDraftController } from "./RemoteAccessConfig";
import { DialogShell } from "./DialogShell";

type SettingsSection = "general" | "remote" | "archived" | "models" | "skills" | "plugins" | "vision";

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
  onClose: () => void;
  onModelsChanged: () => void;
  onSessionReloaded: () => void;
  onProjectsChanged: () => void;
  onRegisterSettingsBack: (handler: () => boolean) => void;
}

function SectionIcon({ section }: { section: SettingsSection }) {
  const icons = {
    general: SlidersHorizontal,
    remote: GlobeLock,
    archived: Archive,
    models: Cpu,
    skills: Layers3,
    plugins: Plug,
    vision: ScanEye,
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
  onClose,
  onModelsChanged,
  onSessionReloaded,
  onProjectsChanged,
  onRegisterSettingsBack,
}: Props) {
  const { t } = useI18n();
  const [section, setSection] = useState<SettingsSection>("general");
  const [projects, setProjects] = useState<ProjectPreference[]>([]);
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [archivedSessionIds, setArchivedSessionIds] = useState<Set<string>>(() => new Set());
  const [projectsLoading, setProjectsLoading] = useState(false);
  const [projectsError, setProjectsError] = useState<string | null>(null);
  const [restoringProjects, setRestoringProjects] = useState<Set<string>>(new Set());
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const [modelsController, setModelsController] = useState<ModelsDraftController | null>(null);
  const [skillsController, setSkillsController] = useState<SettingsSectionController | null>(null);
  const [pluginsController, setPluginsController] = useState<SettingsSectionController | null>(null);
  const [visionController, setVisionController] = useState<VisionDraftController | null>(null);
  const [remoteController, setRemoteController] = useState<RemoteDraftController | null>(null);
  const [discardDialogOpen, setDiscardDialogOpen] = useState(false);
  const [pendingExit, setPendingExit] = useState<(() => void) | null>(null);

  const close = useCallback(() => {
    onModelsChanged();
    onClose();
  }, [onClose, onModelsChanged]);

  // One exit-request path: every Settings close/navigation action goes through
  // here so unsaved custom model drafts are never lost silently.
  const requestCloseOrNavigate = useCallback((action: () => void) => {
    if (modelsController?.dirty || visionController?.dirty || remoteController?.dirty) {
      setPendingExit(() => action);
      setDiscardDialogOpen(true);
    } else {
      action();
    }
  }, [modelsController, remoteController, visionController]);

  const handleDiscardConfirm = useCallback(() => {
    const action = pendingExit;
    setDiscardDialogOpen(false);
    setPendingExit(null);
    setModelsController(null);
    setVisionController(null);
    setRemoteController(null);
    modelsController?.discard();
    visionController?.discard();
    remoteController?.discard();
    action?.();
  }, [modelsController, pendingExit, remoteController, visionController]);

  const activeController = section === "models"
    ? modelsController
    : section === "skills"
      ? skillsController
      : section === "plugins"
        ? pluginsController
        : section === "vision"
          ? visionController
          : section === "remote"
            ? remoteController
            : null;

  useEffect(() => {
    closeButtonRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (discardDialogOpen) return; // native <dialog> handles its own Escape
      if (activeController?.handleBack()) return;
      requestCloseOrNavigate(close);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [activeController, close, discardDialogOpen, requestCloseOrNavigate]);

  const handleSettingsBack = useCallback((): boolean => {
    if (activeController?.handleBack()) return true;
    if (modelsController?.dirty || visionController?.dirty || remoteController?.dirty) {
      setPendingExit(() => close);
      setDiscardDialogOpen(true);
      return true;
    }
    return false;
  }, [activeController, close, modelsController, remoteController, visionController]);

  useEffect(() => {
    onRegisterSettingsBack(handleSettingsBack);
  }, [onRegisterSettingsBack, handleSettingsBack]);

  const loadProjects = useCallback(async (clearError = true) => {
    setProjectsLoading(true);
    if (clearError) setProjectsError(null);
    try {
      const [projectsResponse, sessionsResponse] = await Promise.all([
        fetch("/api/projects", { cache: "no-store" }),
        fetch("/api/sessions", { cache: "no-store" }),
      ]);
      if (!projectsResponse.ok) throw new Error(`HTTP ${projectsResponse.status}`);
      const projectData = await projectsResponse.json() as { projects: ProjectPreference[] };
      setProjects(projectData.projects);
      if (sessionsResponse.ok) {
        const sessionData = await sessionsResponse.json() as { sessions: SessionInfo[] };
        setSessions(sessionData.sessions);
      }
      setArchivedSessionIds(readArchivedSessionIds());
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

  const restoreSession = useCallback((id: string) => {
    setArchivedSessionIds((current) => {
      if (!current.has(id)) return current;
      const next = new Set(current);
      next.delete(id);
      writeArchivedSessionIds(next);
      return next;
    });
    onProjectsChanged();
  }, [onProjectsChanged]);

  const sections: { id: SettingsSection; label: string; disabled: boolean }[] = [
    { id: "general", label: t("settings.general"), disabled: false },
    { id: "archived", label: t("sidebar.archived"), disabled: false },
    { id: "models", label: t("common.models"), disabled: false },
    { id: "skills", label: t("common.skills"), disabled: !cwd },
    { id: "plugins", label: t("common.plugins"), disabled: !cwd },
    { id: "vision", label: t("vision.nav"), disabled: false },
    { id: "remote", label: t("remote.nav"), disabled: false },
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
  } else if (section === "archived") {
    const archivedProjects = projects.filter((project) => project.archived && !project.removed);
    const archivedSessions = sessions.filter((session) => archivedSessionIds.has(session.id) && session.sessionRole !== "subagent");
    const archivedEmpty = archivedProjects.length === 0 && archivedSessions.length === 0;
    content = (
      <div className="settings-form-page">
        <div className="settings-form-heading"><Archive size={18} aria-hidden="true" /><div><h3>{t("sidebar.archived")}</h3><p>{t("settings.archivedEmptyDescription")}</p></div></div>
        {projectsLoading ? (
          <div className="settings-page-empty"><span>{t("sidebar.loading")}</span></div>
        ) : archivedEmpty ? (
          <div className="settings-page-empty"><Archive size={20} aria-hidden="true" /><strong>{t("sidebar.noArchivedProjects")}</strong><span>{t("settings.archivedEmptyDescription")}</span></div>
        ) : (
          <>
            {archivedProjects.length > 0 && (
              <>
                <div className="settings-form-heading"><div><h3>{t("sidebar.archivedProjects")}</h3><p>{t("settings.archivedProjectsDescription")}</p></div></div>
                <div className="settings-archived-list">
                  {archivedProjects.map((project) => (
                    <div className="settings-archived-row" key={project.path}>
                      <div><strong>{project.name ?? project.path.replace(/[\\/]+$/, "").split(/[\\/]/).pop() ?? project.path}</strong><span title={project.path}>{project.path}</span></div>
                      <button type="button" disabled={restoringProjects.has(project.path)} onClick={() => void restoreProject(project.path)}><ArchiveRestore size={14} aria-hidden="true" />{t("sidebar.restoreProject")}</button>
                    </div>
                  ))}
                </div>
              </>
            )}
            {archivedSessions.length > 0 && (
              <>
                <div className="settings-form-heading"><div><h3>{t("sidebar.archivedSessions")}</h3><p>{t("settings.archivedSessionsDescription")}</p></div></div>
                <div className="settings-archived-list">
                  {archivedSessions.map((session) => (
                    <div className="settings-archived-row" key={session.id}>
                      <div><strong>{sidebarSessionTitle(session)}</strong><span title={session.cwd}>{session.cwd}</span></div>
                      <button type="button" onClick={() => restoreSession(session.id)}><ArchiveRestore size={14} aria-hidden="true" />{t("sidebar.restoreSession")}</button>
                    </div>
                  ))}
                </div>
              </>
            )}
          </>
        )}
        {projectsError && <div className="settings-inline-error" role="alert">{projectsError}</div>}
      </div>
    );
  } else if (section === "models") {
    content = <ModelsConfig onControllerChange={setModelsController} />;
  } else if (section === "remote") {
    content = <RemoteAccessConfig onControllerChange={setRemoteController} />;
  } else if (section === "vision") {
    content = <VisionToolkitConfig onControllerChange={setVisionController} />;
  } else if (!cwd) {
    content = (
      <div className="settings-page-empty">
        <SectionIcon section={section} />
        <strong>{t("settings.projectRequired")}</strong>
        <span>{t("settings.projectRequiredDescription")}</span>
      </div>
    );
  } else if (section === "skills") {
    content = <SkillsConfig cwd={cwd} onControllerChange={setSkillsController} />;
  } else {
    content = (
      <PluginsConfig
        cwd={cwd}
        sessionId={sessionId}
        onReloaded={onSessionReloaded}
        onControllerChange={setPluginsController}
      />
    );
  }

  return createPortal(
    <div
      className="settings-page-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="settings-page-title"
      onMouseDown={(event) => { if (event.target === event.currentTarget) requestCloseOrNavigate(close); }}
    >
      <div className="settings-page-shell">
        <header className="settings-page-header">
          <h2 id="settings-page-title">{t("common.settings")}</h2>
          <div className="settings-page-header-actions">
            {section === "vision" && (
              <button
                type="button"
                className="settings-page-header-text"
                onClick={() => visionController?.reveal()}
              >
                {t("vision.openConfig")}
              </button>
            )}
            <button
              ref={closeButtonRef}
              type="button"
              className="settings-page-header-close"
              onClick={() => requestCloseOrNavigate(close)}
              aria-label={t("i18n.close")}
              title={t("i18n.close")}
            >
              <X size={17} aria-hidden="true" />
            </button>
          </div>
        </header>
        <div className="settings-page-layout">
          <nav
            className="settings-page-nav"
            aria-label={t("settings.categories")}
            data-hidden-mobile={activeController?.mobileDetailOpen ? "true" : undefined}
          >
            {sections.map((item) => (
              <button
                key={item.id}
                type="button"
                data-active={section === item.id}
                disabled={item.disabled}
                title={item.disabled ? t("settings.selectProjectFirst") : item.label}
                onClick={() => requestCloseOrNavigate(() => setSection(item.id))}
              >
                <SectionIcon section={item.id} />
                <span>{item.label}</span>
              </button>
            ))}
          </nav>
          <main className="settings-page-content">{content}</main>
        </div>
      </div>
      {discardDialogOpen && (
        <DialogShell
          size="confirm"
          title={t("models.unsavedChanges")}
          ariaLabel={t("models.keepEditing")}
          onClose={() => setDiscardDialogOpen(false)}
          backdropDismissible={false}
          footer={(
            <>
              <button type="button" className="codex-dialog-button" onClick={() => setDiscardDialogOpen(false)}>{t("models.keepEditing")}</button>
              <button type="button" className="codex-dialog-button" data-variant="danger" onClick={handleDiscardConfirm}>{t("models.discard")}</button>
            </>
          )}
        >
          <p className="codex-dialog-copy">{t("models.discardChangesDescription")}</p>
        </DialogShell>
      )}
    </div>,
    document.body,
  );
}

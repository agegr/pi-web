"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { ArrowLeft } from "lucide-react";
import { useIsMobile } from "@/hooks/useIsMobile";
import { useI18n } from "@/hooks/useI18n";
import { SkillsNavigator } from "./resource-settings/SkillsNavigator";
import type { SettingsSectionController } from "./resource-settings/resource-settings-types";
import {
  filterSkillsNavigation,
  resolveSkillsSelection,
  skillsSelectionLabel,
} from "./resource-settings/skills-navigation";
import type {
  SkillInfo as Skill,
  SkillInstallScope,
  SkillSearchResult,
  SkillsResponse,
  SkillUpdateResult,
} from "@/lib/api-types";

function shortenPath(p: string): string {
  // Match common home dir patterns: /Users/xxx, /home/xxx
  return p.replace(/^\/(?:Users|home)\/[^/]+/, "~");
}

function sourceLabel(skill: Skill): string {
  const src = skill.sourceInfo?.source;
  const scope = skill.sourceInfo?.scope;
  if (scope === "user" || src === "user") return "global";
  if (scope === "project" || src === "project") return "project";
  return "path";
}

function updateKey(skill: Skill): string | null {
  return skill.install
    ? `${skill.install.scope}\0${skill.install.package}`
    : null;
}

function shortVersion(version?: string): string {
  return version ? version.slice(0, 8) : "unknown";
}

function Toggle({
  enabled,
  loading,
  onToggle,
}: {
  enabled: boolean;
  loading: boolean;
  onToggle: () => void;
}) {
  const { t } = useI18n();
  return (
    <button
      onClick={onToggle}
      disabled={loading}
      title={
        enabled
          ? t("i18n.visibleInPrompt")
          : t("i18n.hiddenFromPrompt")
      }
      style={{
        flexShrink: 0,
        width: 40,
        height: 22,
        borderRadius: 11,
        border: "none",
        padding: 0,
        cursor: loading ? "wait" : "pointer",
        background: enabled ? "var(--accent)" : "var(--border)",
        position: "relative",
        transition: "background 0.18s",
        outline: "none",
      }}
    >
      <span
        style={{
          position: "absolute",
          top: 3,
          left: enabled ? 21 : 3,
          width: 16,
          height: 16,
          borderRadius: "50%",
          background: "var(--bg)",
          boxShadow: "0 1px 4px rgba(0,0,0,0.22)",
          transition: "left 0.18s cubic-bezier(.4,0,.2,1)",
        }}
      />
    </button>
  );
}

function SkillDetail({
  skill,
  cwd,
  onToggle,
  toggling,
  saveError,
  updateStatus,
  checkingUpdate,
  updating,
  updateError,
  onCheckUpdate,
  onUpdate,
}: {
  skill: Skill;
  cwd: string;
  onToggle: (skill: Skill) => void;
  toggling: boolean;
  saveError: string | null;
  updateStatus?: SkillUpdateResult;
  checkingUpdate: boolean;
  updating: boolean;
  updateError: string | null;
  onCheckUpdate: () => void;
  onUpdate: () => void;
}) {
  const { t } = useI18n();
  const label = sourceLabel(skill);
  const enabled = !skill.disableModelInvocation;

  function displayPath(p: string): string {
    if (label === "project" && p.startsWith(cwd)) {
      const rel = p.slice(cwd.length).replace(/^[/\\]/, "");
      return `./${rel}`;
    }
    return shortenPath(p);
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {/* Path + tag + toggle, with a stable status row below. */}
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
          <span
            style={{
              fontSize: "var(--text-meta)",
              padding: "1px 5px",
              borderRadius: 3,
              flexShrink: 0,
              background:
                label === "project"
                  ? "rgba(99,102,241,0.12)"
                  : "rgba(120,120,120,0.12)",
              color:
                label === "project" ? "rgba(99,102,241,0.8)" : "var(--text-dim)",
            }}
          >
            {label}
          </span>
          <span
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: "var(--text-meta)",
              color: "var(--text-dim)",
              flex: 1,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {displayPath(skill.filePath)}
          </span>
          <Toggle
            enabled={enabled}
            loading={toggling}
            onToggle={() => onToggle(skill)}
          />
        </div>
        <div
          style={{
            minHeight: 16,
            display: "flex",
            alignItems: "center",
            justifyContent: "flex-end",
            gap: 8,
            flexWrap: "wrap",
            textAlign: "right",
          }}
        >
          {!enabled && (
            <span style={{ fontSize: "var(--text-meta)", color: "var(--text-dim)" }}>
              {t("i18n.hiddenButInvocable")}
            </span>
          )}
          {saveError && (
            <span style={{ fontSize: "var(--text-meta)", color: "#f87171", overflowWrap: "anywhere" }}>
              {saveError}
            </span>
          )}
        </div>
      </div>

      {skill.install?.skillsShUrl && (
        <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
          <span
            style={{ fontSize: "var(--text-meta)", color: "var(--text-muted)", fontWeight: 500 }}
          >
            Source
          </span>
          <a
            href={skill.install.skillsShUrl}
            target="_blank"
            rel="noreferrer"
            title={skill.install.skillsShUrl}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              width: "fit-content",
              maxWidth: "100%",
              color: "var(--accent)",
              textDecoration: "none",
            }}
          >
            <span
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: "var(--text-ui)",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {skill.install.skillsShUrl.replace(/^https?:\/\//, "")} ↗
            </span>
          </a>
        </div>
      )}

      {skill.install && (
        <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
          <span
            style={{ fontSize: "var(--text-meta)", color: "var(--text-muted)", fontWeight: 500 }}
          >
            Version
          </span>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              flexWrap: "wrap",
            }}
          >
            <span
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: "var(--text-meta)",
                color: "var(--text-muted)",
              }}
            >
              {shortVersion(updateStatus?.currentVersion ?? skill.install.versionHash)}
            </span>
            {skill.install.canCheckForUpdates && (
              <button
                onClick={onCheckUpdate}
                disabled={checkingUpdate || updating}
                style={{
                  padding: "4px 9px",
                  border: "1px solid var(--border)",
                  borderRadius: 5,
                  background: "none",
                  color: "var(--text-muted)",
                  cursor: checkingUpdate || updating ? "not-allowed" : "pointer",
                  opacity: checkingUpdate || updating ? 0.5 : 1,
                  fontSize: "var(--text-meta)",
                }}
              >
                 {t("i18n.check")}
              </button>
            )}
            {updateStatus?.state === "update-available" && (
              <span
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: "var(--text-meta)",
                  color: "#d97706",
                }}
              >
                {shortVersion(updateStatus.latestVersion)}
              </span>
            )}
            {(checkingUpdate ||
              (updateStatus && updateStatus.state !== "update-available")) && (
              <span
                style={{
                  fontSize: "var(--text-meta)",
                  color: checkingUpdate
                    ? "var(--accent)"
                    : updateStatus?.state === "up-to-date"
                      ? "#16a34a"
                      : updateStatus?.state === "error"
                          ? "#ef4444"
                          : "var(--text-dim)",
                }}
              >
                {checkingUpdate
                   ? t("i18n.checking")
                  : updateStatus?.state === "up-to-date"
                     ? t("i18n.upToDate")
                    : updateStatus?.state === "unsupported"
                         ? t("i18n.automaticChecksUnavailable")
                         : updateStatus?.message || t("i18n.checkFailed")}
              </span>
            )}
            {updateStatus?.state === "update-available" && (
              <button
                onClick={onUpdate}
                disabled={updating || checkingUpdate}
                style={{
                  padding: "4px 10px",
                  border: "none",
                  borderRadius: 5,
                  background: "var(--accent)",
                  color: "#fff",
                  cursor: updating || checkingUpdate ? "not-allowed" : "pointer",
                  opacity: updating || checkingUpdate ? 0.5 : 1,
                  fontSize: "var(--text-meta)",
                  fontWeight: 600,
                }}
              >
                 {updating ? t("i18n.updating") : t("i18n.update")}
              </button>
            )}
          </div>
          {updateError && (
            <span style={{ fontSize: "var(--text-meta)", color: "#ef4444" }}>{updateError}</span>
          )}
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
        <span
          style={{ fontSize: "var(--text-meta)", color: "var(--text-muted)", fontWeight: 500 }}
        >
          Name
        </span>
        <span
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: "var(--text-title)",
            color: "var(--text)",
          }}
        >
          {skill.name}
        </span>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
        <span
          style={{ fontSize: "var(--text-meta)", color: "var(--text-muted)", fontWeight: 500 }}
        >
          Description
        </span>
        <span
          style={{ fontSize: "var(--text-chat)", color: "var(--text-muted)", lineHeight: "var(--leading-prose)" }}
        >
          {skill.description}
        </span>
      </div>
    </div>
  );
}

function AddSkillPanel({
  cwd,
  installedPackages,
  projectResourcesLoaded,
  onInstalled,
}: {
  cwd: string;
  installedPackages: Record<SkillInstallScope, ReadonlySet<string>>;
  projectResourcesLoaded: boolean;
  onInstalled: () => void;
}) {
  const { t } = useI18n();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SkillSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [installing, setInstalling] = useState<string | null>(null);
  const [installError, setInstallError] = useState<string | null>(null);
  const [newlyInstalledPkgs, setNewlyInstalledPkgs] = useState<Set<string>>(
    new Set(),
  );
  const [scope, setScope] = useState<"global" | "project">("global");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const search = useCallback(async (q: string) => {
    if (!q.trim()) return;
    setSearching(true);
    setSearchError(null);
    setResults([]);
    try {
      const res = await fetch("/api/skills/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: q.trim() }),
      });
      const d = (await res.json()) as {
        results?: SkillSearchResult[];
        error?: string;
      };
      if (d.error) {
        setSearchError(d.error);
        return;
      }
      setResults(d.results ?? []);
      if ((d.results ?? []).length === 0) setSearchError("No skills found");
    } catch (e) {
      setSearchError(String(e));
    } finally {
      setSearching(false);
    }
  }, []);

  const install = useCallback(
    async (pkg: string) => {
      setInstalling(pkg);
      setInstallError(null);
      try {
        const res = await fetch("/api/skills/install", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ package: pkg, scope, cwd }),
        });
        const d = (await res.json()) as { success?: boolean; error?: string };
        if (!res.ok || d.error) {
          setInstallError(d.error ?? `HTTP ${res.status}`);
          return;
        }
        setNewlyInstalledPkgs((prev) =>
          new Set(prev).add(`${scope}:${pkg}`),
        );
        onInstalled();
      } catch (e) {
        setInstallError(String(e));
      } finally {
        setInstalling(null);
      }
    },
    [onInstalled, scope, cwd],
  );

  const installPath =
    scope === "global"
      ? "~/.pi/agent/skills/"
      : `${shortenPath(cwd)}/.pi/skills/`;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      {/* ── Header area ── */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 12,
          marginBottom: 20,
        }}
      >
        <div style={{ fontSize: "var(--text-title)", fontWeight: 600, color: "var(--text)" }}>
           {t("i18n.addSkill")}
        </div>

        {/* Search row */}
        <div style={{ display: "flex", gap: 8 }}>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") search(query);
            }}
             placeholder={t("i18n.skillSearchPlaceholder")}
            style={{
              flex: 1,
              padding: "7px 10px",
              fontSize: "var(--text-ui)",
              background: "var(--bg-panel)",
              border: "1px solid var(--border)",
              borderRadius: 6,
              color: "var(--text)",
              outline: "none",
            }}
          />
          <button
            onClick={() => search(query)}
            disabled={searching || !query.trim()}
            style={{
              padding: "7px 16px",
              fontSize: "var(--text-ui)",
              borderRadius: 6,
              border: "none",
              background: "var(--accent)",
              color: "#fff",
              cursor: searching || !query.trim() ? "not-allowed" : "pointer",
              opacity: searching || !query.trim() ? 0.5 : 1,
              flexShrink: 0,
            }}
          >
             {searching ? t("i18n.searching") : t("i18n.search")}
          </button>
        </div>

        {/* Scope + install path row */}
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div
            style={{
              display: "flex",
              borderRadius: 5,
              border: "1px solid var(--border)",
              overflow: "hidden",
              fontSize: "var(--text-ui)",
              flexShrink: 0,
            }}
          >
            {(["global", "project"] as const).map((s) => (
              <button
                key={s}
                onClick={() => {
                  if (s === "global" || projectResourcesLoaded) setScope(s);
                }}
                disabled={s === "project" && !projectResourcesLoaded}
                title={s === "project" && !projectResourcesLoaded ? t("trust.projectScopeUnavailable") : undefined}
                style={{
                  padding: "3px 10px",
                  border: "none",
                  cursor: s === "project" && !projectResourcesLoaded ? "not-allowed" : "pointer",
                  background: scope === s ? "var(--bg-selected)" : "none",
                  color: scope === s ? "var(--text)" : "var(--text-dim)",
                  fontWeight: scope === s ? 600 : 400,
                  opacity: s === "project" && !projectResourcesLoaded ? 0.45 : 1,
                  borderRight:
                    s === "global" ? "1px solid var(--border)" : "none",
                }}
              >
                {s}
              </button>
            ))}
          </div>
          <span
            style={{
              fontSize: "var(--text-meta)",
              color: "var(--text-dim)",
              fontFamily: "var(--font-mono)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            → {installPath}
          </span>
        </div>

        {/* Errors */}
        {searchError && (
          <div style={{ fontSize: "var(--text-meta)", color: "#f87171" }}>{searchError}</div>
        )}
        {installError && (
          <div
            style={{ fontSize: "var(--text-meta)", color: "#f87171", wordBreak: "break-word" }}
          >
            {installError}
          </div>
        )}
      </div>

      {/* ── Results list ── */}
      {results.length > 0 ? (
        <div style={{ flex: 1, overflowY: "auto" }}>
          {results.map((r) => {
            const isInstalled =
              installedPackages[scope].has(r.package) ||
              newlyInstalledPkgs.has(`${scope}:${r.package}`);
            const isInstalling = installing === r.package;
            // split "owner/repo@skill" for cleaner display
            const atIdx = r.package.indexOf("@");
            const repopart = atIdx > -1 ? r.package.slice(0, atIdx) : r.package;
            const skillpart = atIdx > -1 ? r.package.slice(atIdx + 1) : null;
            return (
              <div
                key={r.package}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 14,
                  padding: "12px 0",
                  borderBottom: "1px solid var(--border)",
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  {/* skill name prominent */}
                  <div
                    style={{
                      fontSize: "var(--text-ui)",
                      fontWeight: 600,
                      color: "var(--text)",
                      marginBottom: 3,
                    }}
                  >
                    {skillpart ?? repopart}
                  </div>
                  {/* repo + installs + link row */}
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      flexWrap: "wrap",
                    }}
                  >
                    <span
                      style={{
                        fontFamily: "var(--font-mono)",
                        fontSize: "var(--text-meta)",
                        color: "var(--text-dim)",
                      }}
                    >
                      {repopart}
                    </span>
                    <span
                      style={{
                        fontSize: "var(--text-meta)",
                        color: "var(--text-muted)",
                        fontWeight: 500,
                      }}
                    >
                      {r.installs}
                    </span>
                    {r.url && (
                      <a
                        href={r.url}
                        target="_blank"
                        rel="noreferrer"
                        style={{
                          fontSize: "var(--text-ui)",
                          color: "var(--accent)",
                          textDecoration: "none",
                        }}
                      >
                        skills.sh ↗
                      </a>
                    )}
                  </div>
                </div>
                <button
                  onClick={() =>
                    !isInstalled && !isInstalling && install(r.package)
                  }
                  disabled={isInstalled || isInstalling || installing !== null}
                  style={{
                    flexShrink: 0,
                    padding: "5px 14px",
                    fontSize: "var(--text-ui)",
                    fontWeight: 500,
                    borderRadius: 5,
                    border: "1px solid var(--border)",
                    cursor:
                      isInstalled || isInstalling || installing !== null
                        ? "not-allowed"
                        : "pointer",
                    background: isInstalled ? "rgba(34,197,94,0.1)" : "none",
                    color: isInstalled
                      ? "#16a34a"
                      : isInstalling
                        ? "var(--accent)"
                        : "var(--text-muted)",
                    transition: "color 0.12s",
                  }}
                >
                  {isInstalled
                     ? `✓ ${t("i18n.installed")}`
                    : isInstalling
                       ? t("i18n.installing")
                       : t("i18n.install")}
                </button>
              </div>
            );
          })}
        </div>
      ) : (
        !searchError &&
        !searching && (
          <div
            style={{ fontSize: "var(--text-ui)", color: "var(--text-dim)", lineHeight: "var(--leading-prose)" }}
          >
            Search{" "}
            <a
              href="https://skills.sh"
              target="_blank"
              rel="noreferrer"
              style={{ color: "var(--accent)", textDecoration: "none" }}
            >
              skills.sh
            </a>{" "}
            to discover and install skills for your agent.
          </div>
        )
      )}
    </div>
  );
}

export function SkillsConfig({
  cwd,
  onControllerChange,
}: {
  cwd: string;
  onControllerChange?(controller: SettingsSectionController): void;
}) {
  const isMobile = useIsMobile();
  const { t } = useI18n();
  const [skills, setSkills] = useState<Skill[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [mobileView, setMobileView] = useState<"list" | "detail">("list");
  const [toggling, setToggling] = useState<Set<string>>(new Set());
  const [saveError, setSaveError] = useState<string | null>(null);
  const [addMode, setAddMode] = useState(false);
  const [updateStatuses, setUpdateStatuses] = useState<Record<string, SkillUpdateResult>>({});
  const [checkingUpdates, setCheckingUpdates] = useState<Set<string>>(new Set());
  const [checkingAll, setCheckingAll] = useState(false);
  const [updatingSkill, setUpdatingSkill] = useState<string | null>(null);
  const [updateError, setUpdateError] = useState<string | null>(null);
  const [projectResourcesLoaded, setProjectResourcesLoaded] = useState(true);
  const [dormantOpen, setDormantOpen] = useState(false);

  const loadSkills = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/skills?cwd=${encodeURIComponent(cwd)}`);
      const d = (await res.json()) as Partial<SkillsResponse> & { error?: string };
      if (!res.ok || d.error) throw new Error(d.error ?? `HTTP ${res.status}`);
      const list = d.skills ?? [];
      setSkills(list);
      setProjectResourcesLoaded(d.projectResourcesLoaded ?? true);
      setSelected((current) => {
        const repaired = resolveSkillsSelection(current, list);
        if (repaired) return repaired;
        if (current) {
          setMobileView("list");
          return null;
        }
        const initialSkill = list.find((skill) => !skill.disableModelInvocation) ?? list[0];
        return initialSkill?.filePath ?? null;
      });
      return list;
    } catch (e) {
      setError(String(e));
      return [];
    } finally {
      setLoading(false);
    }
  }, [cwd, selected]);

  useEffect(() => {
    setUpdateStatuses({});
    setUpdateError(null);
    void loadSkills();
  }, [cwd]); // eslint-disable-line react-hooks/exhaustive-deps

  const checkForUpdates = useCallback(async (skill?: Skill) => {
    const targets = skill
      ? [skill]
      : skills.filter((item) => Boolean(item.install));
    const keys = targets
      .map(updateKey)
      .filter((key): key is string => Boolean(key));
    if (keys.length === 0) return;

    setUpdateError(null);
    setCheckingUpdates((current) => new Set([...current, ...keys]));
    if (!skill) setCheckingAll(true);
    try {
      const res = await fetch("/api/skills/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cwd,
          package: skill?.install?.package,
          scope: skill?.install?.scope,
        }),
      });
      const data = (await res.json()) as {
        updates?: SkillUpdateResult[];
        error?: string;
      };
      if (!res.ok || data.error) throw new Error(data.error ?? `HTTP ${res.status}`);
      setUpdateStatuses((current) => {
        const next = { ...current };
        for (const update of data.updates ?? []) {
          next[`${update.scope}\0${update.package}`] = update;
        }
        return next;
      });
    } catch (e) {
      setUpdateError(e instanceof Error ? e.message : String(e));
    } finally {
      setCheckingUpdates((current) => {
        const next = new Set(current);
        for (const key of keys) next.delete(key);
        return next;
      });
      if (!skill) setCheckingAll(false);
    }
  }, [cwd, skills]);

  const updateInstalledSkill = useCallback(async (skill: Skill) => {
    if (!skill.install) return;
    const key = updateKey(skill)!;
    setUpdatingSkill(key);
    setUpdateError(null);
    try {
      const res = await fetch("/api/skills/update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cwd,
          package: skill.install.package,
          scope: skill.install.scope,
        }),
      });
      const data = (await res.json()) as {
        success?: boolean;
        skill?: Skill;
        error?: string;
      };
      if (!res.ok || data.error || !data.success) {
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }
      await loadSkills();
      const versionHash = data.skill?.install?.versionHash;
      setUpdateStatuses((current) => ({
        ...current,
        [key]: {
          package: skill.install!.package,
          scope: skill.install!.scope,
          state: "up-to-date",
          currentVersion: versionHash,
          latestVersion: versionHash,
        },
      }));
    } catch (e) {
      setUpdateError(e instanceof Error ? e.message : String(e));
    } finally {
      setUpdatingSkill(null);
    }
  }, [cwd, loadSkills]);

  const toggle = useCallback(async (skill: Skill) => {
    const next = !skill.disableModelInvocation;
    setToggling((s) => new Set(s).add(skill.filePath));
    setSaveError(null);
    try {
      const res = await fetch("/api/skills", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filePath: skill.filePath,
          disableModelInvocation: next,
        }),
      });
      const d = (await res.json()) as { success?: boolean; error?: string };
      if (!res.ok || d.error) {
        setSaveError(d.error ?? `HTTP ${res.status}`);
        return;
      }
      setSkills((prev) =>
        prev.map((s) =>
          s.filePath === skill.filePath
            ? { ...s, disableModelInvocation: next }
            : s,
        ),
      );
      if (next) setDormantOpen(true);
    } catch (e) {
      setSaveError(String(e));
    } finally {
      setToggling((s) => {
        const n = new Set(s);
        n.delete(skill.filePath);
        return n;
      });
    }
  }, []);

  const selectedSkill = skills.find((s) => s.filePath === selected) ?? null;
  const filtered = useMemo(
    () => filterSkillsNavigation(skills, query, dormantOpen),
    [skills, query, dormantOpen],
  );
  const headerLabel = addMode
    ? { title: t("i18n.addSkill") }
    : skillsSelectionLabel(selected, skills);

  const handleBack = useCallback(() => {
    if (addMode) { setAddMode(false); return true; }
    if (isMobile && mobileView === "detail") { setMobileView("list"); return true; }
    return false;
  }, [addMode, isMobile, mobileView]);

  const controller = useMemo<SettingsSectionController>(() => ({
    handleBack,
    mobileDetailOpen: isMobile && mobileView === "detail",
  }), [handleBack, isMobile, mobileView]);

  useEffect(() => {
    onControllerChange?.(controller);
  }, [controller, onControllerChange]);

  const openDetail = (filePath: string | null, add = false) => {
    setAddMode(add);
    if (filePath) setSelected(filePath);
    if (isMobile) setMobileView("detail");
  };

  return (
    <div className="resource-settings-page">
      <div className="resource-settings-header">
        {isMobile && mobileView === "detail" ? (
          <>
            <button type="button" className="resource-settings-back" onClick={() => { if (addMode) setAddMode(false); setMobileView("list"); }} aria-label={t("i18n.back")}>
              <ArrowLeft size={16} strokeWidth={2} aria-hidden="true" />
            </button>
            <div className="resource-settings-header-title">
              <span>{headerLabel.title}</span>
            </div>
          </>
        ) : (
          <div className="resource-settings-header-title">
            <span>{t("common.skills")}</span>
            <code>{shortenPath(cwd)}</code>
          </div>
        )}
        <div className="resource-settings-header-actions">
          {skills.some((skill) => Boolean(skill.install)) && (
            <button type="button" className="resource-settings-header-button" onClick={() => void checkForUpdates()} disabled={checkingAll || updatingSkill !== null}>
              {checkingAll ? t("i18n.checking") : t("i18n.checkUpdates")}
            </button>
          )}
        </div>
      </div>

      {!projectResourcesLoaded && (
        <div className="resource-settings-banner" role="status">{t("trust.skillsNotLoaded")}</div>
      )}

      <div className="resource-settings-layout" data-mobile-view={isMobile ? mobileView : undefined}>
        <SkillsNavigator
          query={query}
          selection={selected}
          active={filtered.active}
          dormant={filtered.dormant}
          dormantOpen={filtered.dormantOpen}
          loading={loading}
          error={error ?? undefined}
          addSelected={addMode}
          onQueryChange={setQuery}
          onSelect={(filePath) => openDetail(filePath)}
          onToggleDormant={() => setDormantOpen((open) => !open)}
          onAdd={() => openDetail(null, true)}
          onRetry={() => void loadSkills()}
        />
        <div className="resource-settings-detail">
          {addMode ? (
            <AddSkillPanel
              cwd={cwd}
              projectResourcesLoaded={projectResourcesLoaded}
              installedPackages={{
                global: new Set(skills.filter((skill) => skill.install?.scope === "global").map((skill) => skill.install!.package)),
                project: new Set(skills.filter((skill) => skill.install?.scope === "project").map((skill) => skill.install!.package)),
              }}
              onInstalled={() => { void loadSkills(); }}
            />
          ) : loading ? null : selectedSkill ? (
            <SkillDetail
              key={selectedSkill.filePath}
              skill={selectedSkill}
              cwd={cwd}
              onToggle={toggle}
              toggling={toggling.has(selectedSkill.filePath)}
              saveError={saveError}
              updateStatus={updateKey(selectedSkill) ? updateStatuses[updateKey(selectedSkill)!] : undefined}
              checkingUpdate={updateKey(selectedSkill) ? checkingUpdates.has(updateKey(selectedSkill)!) : false}
              updating={updatingSkill === updateKey(selectedSkill)}
              updateError={updateError}
              onCheckUpdate={() => void checkForUpdates(selectedSkill)}
              onUpdate={() => void updateInstalledSkill(selectedSkill)}
            />
          ) : (
            <div className="resource-settings-detail-empty">{t("i18n.selectSkill")}</div>
          )}
        </div>
      </div>
    </div>
  );
}

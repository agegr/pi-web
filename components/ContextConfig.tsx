"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ContextFileId, ContextFileInfo } from "@/lib/api-types";
import { useI18n } from "@/hooks/useI18n";
import { displayPathWithin, shortenPath } from "@/lib/display-path";
import { getLastSettingsSelection, setLastSettingsSelection } from "@/lib/settings-navigation";
import {
  ConfigButton,
  ConfigDetail,
  ConfigDetailGrid,
  ConfigDetailGridRow,
  ConfigDetailHeader,
  ConfigDetailHeaderInfo,
  ConfigDetailStack,
  ConfigDetailTitle,
  ConfigEmptyState,
  ConfigFooter,
  ConfigNotice,
  ConfigPanelShell,
  ConfigScopeTag,
  ConfigSidebar,
  ConfigSidebarGroupLabel,
  ConfigSidebarItem,
  ConfigSidebarList,
  ConfigSidebarText,
  ConfigSplitView,
  ConfigStatusDot,
} from "./SettingsUi";
import {
  CONTEXT_GROUPS,
  contextFailureText,
  loadContextFiles,
  pickContextFile,
  saveContextFile,
  type ContextFailure,
  type ContextGroup,
  type ContextLoadResult,
} from "./context-config-helpers";

/** The name a card shows while its file does not exist yet. Pi creates it under this name. */
const CONTEXT_DEFAULT_NAMES: Record<ContextFileId, string> = {
  "agents-global": "AGENTS.md",
  "system-global": "SYSTEM.md",
  "append-system-global": "APPEND_SYSTEM.md",
  "agents-local": "AGENTS.md",
  "system-local": ".pi/SYSTEM.md",
  "append-system-local": ".pi/APPEND_SYSTEM.md",
  "agents-override-local": "AGENTS.override.md",
};

/** What each entry does, and the discovery rule behind it (pi.dev/docs/latest/configuration). */
const CONTEXT_ENTRY_KEYS: Record<ContextFileId, { role: string; help: string }> = {
  "agents-global": { role: "context.role.agentsGlobal", help: "context.help.agents" },
  "agents-local": { role: "context.role.agentsLocal", help: "context.help.agents" },
  "system-global": { role: "context.role.systemGlobal", help: "context.help.system" },
  "system-local": { role: "context.role.systemLocal", help: "context.help.system" },
  "append-system-global": { role: "context.role.appendGlobal", help: "context.help.append" },
  "append-system-local": { role: "context.role.appendLocal", help: "context.help.append" },
  "agents-override-local": { role: "context.role.overrideLocal", help: "context.help.override" },
};

export const CONTEXT_GROUP_LABEL_KEYS: Record<ContextGroup, string> = {
  global: "context.group.global",
  local: "context.group.local",
};

/** The name of the file an entry edits, as the cards and notices show it. */
export function contextEntryName(file: Pick<ContextFileInfo, "id" | "path">): string {
  if (!file.path) return CONTEXT_DEFAULT_NAMES[file.id];
  const name = file.path.slice(Math.max(file.path.lastIndexOf("/"), file.path.lastIndexOf("\\")) + 1);
  return name || CONTEXT_DEFAULT_NAMES[file.id];
}

/**
 * Why an entry cannot be edited here, as a translation key, or null when it can.
 * The route reports a path only for a file it can reach, so a missing path is the
 * local entry waiting for a project: unavailable rather than broken, and its own
 * sentence says so.
 */
export function contextRowBlockKey(file: ContextFileInfo): string | null {
  if (file.path === null) return "context.block.noProject";
  if (file.problem === "outside-roots") return "context.block.outsideRoots";
  if (file.problem === "not-a-file") return "context.block.notAFile";
  if (file.problem === "unreadable") return "context.block.unreadable";
  return null;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KiB`;
}

/**
 * The panel without its requests, so a test can render any state. `drafts` holds
 * one unsaved draft per entry, so switching cards never discards typing.
 */
export interface ContextConfigViewProps {
  cwd: string | null;
  embedded: boolean;
  load: ContextLoadResult | { ok: null };
  selected: string | null;
  drafts: Readonly<Record<string, string>>;
  saving: string | null;
  saveError: ContextFailure | null;
  onSelect: (id: ContextFileId) => void;
  onDraftChange: (id: ContextFileId, value: string) => void;
  onSave: (file: ContextFileInfo, remove: boolean) => void;
  onRefresh: () => void;
  onClose: () => void;
}

export function ContextConfigView({
  cwd,
  embedded,
  load,
  selected,
  drafts,
  saving,
  saveError,
  onSelect,
  onDraftChange,
  onSave,
  onRefresh,
  onClose,
}: ContextConfigViewProps) {
  const { t } = useI18n();
  const data = load.ok === true ? load.data : null;
  const failure = load.ok === false ? load.error : null;
  const files = data?.files ?? [];
  const selectedFile = files.find((file) => file.id === selected) ?? null;

  const stateText = (file: ContextFileInfo): string => {
    const block = contextRowBlockKey(file);
    if (block) return t(block);
    if (!file.exists) return t("context.state.missing");
    if (file.requiresTrust) return t("context.state.needsTrust");
    if (!file.effective) return t("context.state.shadowed");
    return t("context.state.on");
  };

  return (
    <ConfigPanelShell
      embedded={embedded}
      title={t("settings.context")}
      subtitle={shortenPath(cwd ?? data?.agentDir ?? "")}
      closeLabel={t("i18n.close")}
      onClose={onClose}
    >
      {failure && (
        <ConfigNotice>
          {t("context.loadFailed")} {contextFailureText(failure, t)}
        </ConfigNotice>
      )}
      {data && !cwd && <ConfigNotice>{t("context.noProjectNotice")}</ConfigNotice>}

      <ConfigSplitView>
        <ConfigSidebar>
          <ConfigSidebarList>
            {load.ok === null ? (
              <div className="config-sidebar-message">{t("i18n.loading")}</div>
            ) : failure ? null : (
              CONTEXT_GROUPS.map((group) => {
                const rows = files.filter((file) => file.scope === group);
                return (
                  <div key={group} className="config-sidebar-group">
                    <ConfigSidebarGroupLabel
                      aside={<span className="context-group-count">{`${rows.filter((file) => file.exists).length}/${rows.length}`}</span>}
                    >
                      {t(CONTEXT_GROUP_LABEL_KEYS[group])}
                    </ConfigSidebarGroupLabel>
                    {rows.map((file) => {
                      const block = contextRowBlockKey(file);
                      const name = contextEntryName(file);
                      const state = stateText(file);
                      return (
                        <ConfigSidebarItem
                          key={file.id}
                          active={selected === file.id}
                          disabled={block !== null}
                          title={state}
                          aria-label={`${name}: ${state}`}
                          onClick={() => onSelect(file.id)}
                        >
                          <ConfigStatusDot active={block === null && file.exists && file.effective} />
                          <ConfigSidebarText className={`is-grow${block === null ? "" : " is-muted"}`}>
                            {name}
                          </ConfigSidebarText>
                        </ConfigSidebarItem>
                      );
                    })}
                  </div>
                );
              })
            )}
          </ConfigSidebarList>
        </ConfigSidebar>

        <ConfigDetail>
          <ConfigDetailStack className="is-fill">
            {load.ok === null || failure ? null : !selectedFile ? (
              <ConfigEmptyState>{t("context.selectItem")}</ConfigEmptyState>
            ) : (
              <ContextFileDetail
                file={selectedFile}
                cwd={cwd}
                draft={drafts[selectedFile.id] ?? selectedFile.content}
                saving={saving === selectedFile.id}
                saveError={saveError}
                onDraftChange={onDraftChange}
                onSave={onSave}
              />
            )}
          </ConfigDetailStack>
        </ConfigDetail>
      </ConfigSplitView>

      <ConfigFooter>
        <ConfigButton onClick={onRefresh} disabled={load.ok === null || saving !== null}>
          {t("i18n.refresh")}
        </ConfigButton>
        {!embedded && <ConfigButton onClick={onClose}>{t("i18n.close")}</ConfigButton>}
      </ConfigFooter>
    </ConfigPanelShell>
  );
}

/** One entry's card: its resolved path, what Pi does with it, and the editor. */
function ContextFileDetail({
  file,
  cwd,
  draft,
  saving,
  saveError,
  onDraftChange,
  onSave,
}: {
  file: ContextFileInfo;
  cwd: string | null;
  draft: string;
  saving: boolean;
  saveError: ContextFailure | null;
  onDraftChange: (id: ContextFileId, value: string) => void;
  onSave: (file: ContextFileInfo, remove: boolean) => void;
}) {
  const { t } = useI18n();
  const block = contextRowBlockKey(file);
  const keys = CONTEXT_ENTRY_KEYS[file.id];
  const name = contextEntryName(file);
  const dirty = draft !== file.content;
  const blockNoticeId = `context-block-${file.id}`;

  /**
   * A truncated file is only its first part, so writing the draft back would
   * drop the rest: Save asks first, as Delete does, and names the size whose
   * text the write would lose.
   */
  const startSave = () => {
    if (file.truncated && !window.confirm(t("context.truncatedConfirm", { size: formatSize(file.sizeBytes) }))) return;
    onSave(file, false);
  };

  return (
    <>
      <ConfigDetailHeader>
        <ConfigDetailHeaderInfo>
          <ConfigScopeTag scope={file.scope === "local" ? "project" : "global"}>
            {t(CONTEXT_GROUP_LABEL_KEYS[file.scope])}
          </ConfigScopeTag>
          <ConfigDetailTitle>{name}</ConfigDetailTitle>
        </ConfigDetailHeaderInfo>
      </ConfigDetailHeader>

      <ConfigDetailGrid>
        <ConfigDetailGridRow label={t("context.detail.path")} mono>
          <span className="context-path" title={file.path ?? undefined}>
            {file.path
              ? (cwd ? displayPathWithin(file.path, cwd) : shortenPath(file.path))
              : t("context.detail.noPath")}
          </span>
        </ConfigDetailGridRow>
        <ConfigDetailGridRow label={t("context.detail.absolutePath")} mono tone="dim">
          {file.path ?? t("context.detail.noPath")}
        </ConfigDetailGridRow>
        <ConfigDetailGridRow label={t("context.detail.role")} tone="plain">
          {t(keys.role)}
        </ConfigDetailGridRow>
        {/* Nothing is loaded from a file that is not there, and a project file
            waits for the project's trust before it takes over. */}
        {file.exists && (
          <ConfigDetailGridRow label={t("context.detail.precedence")} tone={file.effective ? "plain" : "dim"}>
            {file.requiresTrust
              ? t("context.precedence.needsTrust")
              : file.effective
                ? t("context.precedence.loaded")
                : t("context.precedence.shadowed", { path: shortenPath(file.shadowedBy ?? "") })}
          </ConfigDetailGridRow>
        )}
        {file.exists && (
          <ConfigDetailGridRow label={t("context.detail.size")} tone="dim">
            {formatSize(file.sizeBytes)}
          </ConfigDetailGridRow>
        )}
      </ConfigDetailGrid>

      <p className="context-help">{t(keys.help)}</p>
      {file.truncated && <ConfigNotice>{t("context.truncated", { size: formatSize(file.sizeBytes) })}</ConfigNotice>}
      {block && <ConfigNotice id={blockNoticeId}>{t(block)}</ConfigNotice>}

      <label className="context-editor-label" htmlFor={`context-editor-${file.id}`}>
        {name}
      </label>
      <textarea
        id={`context-editor-${file.id}`}
        className="context-editor"
        spellCheck={false}
        value={draft}
        disabled={block !== null || saving}
        aria-describedby={block ? blockNoticeId : undefined}
        onChange={(event) => onDraftChange(file.id, event.target.value)}
      />

      {saveError && (
        <div role="alert" className="context-save-error">
          {t("context.saveFailed")} {contextFailureText(saveError, t)}
        </div>
      )}

      <div className="context-actions">
        <ConfigButton
          variant="primary"
          disabled={block !== null || saving || !dirty}
          onClick={startSave}
        >
          {saving ? t("i18n.saving") : file.exists ? t("i18n.save") : t("context.create")}
        </ConfigButton>
        <ConfigButton
          disabled={block !== null || saving || !dirty}
          onClick={() => onDraftChange(file.id, file.content)}
        >
          {t("context.revert")}
        </ConfigButton>
        {file.deletable && file.exists && (
          <ConfigButton
            variant="danger"
            disabled={block !== null || saving}
            onClick={() => {
              if (window.confirm(t("context.deleteConfirm", { name }))) onSave(file, true);
            }}
          >
            {t("i18n.delete")}
          </ConfigButton>
        )}
      </div>
    </>
  );
}

/**
 * Settings › Context: the seven files Pi reads its instructions from, each with
 * its resolved absolute path, its text, and whether Pi loads it at all.
 *
 * Works without a project, as Settings › MCP does: the agent directory's three
 * files are the user's and always editable, and the four local entries say why
 * they wait for one. `cwd` changing reloads against the new folder.
 */
export function ContextConfig({
  cwd,
  onClose,
  embedded = false,
}: {
  cwd: string | null;
  onClose: () => void;
  embedded?: boolean;
}) {
  const [load, setLoad] = useState<ContextLoadResult | { ok: null }>({ ok: null });
  const [selected, setSelected] = useState<string | null>(() => getLastSettingsSelection("context", cwd));
  // One unsaved draft per entry: selecting another card never discards typing.
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<ContextFailure | null>(null);
  const loadRunRef = useRef(0);
  const selectionRef = useRef(selected);
  selectionRef.current = selected;

  const refresh = useCallback(async (options?: { keepSaveError?: boolean }) => {
    const run = ++loadRunRef.current;
    const result = await loadContextFiles(cwd);
    // A load that started earlier must not put back the older folder's listing.
    if (run !== loadRunRef.current) return;
    setLoad(result);
    // A refresh a refused save started keeps its alert: the reloaded listing has
    // no trace of a too-large write or a transient failure, so wiping it would
    // read as a save that landed.
    if (!options?.keepSaveError) setSaveError(null);
    if (result.ok) setSelected(pickContextFile(result.data.files, selectionRef.current));
  }, [cwd]);

  useEffect(() => {
    setSelected(getLastSettingsSelection("context", cwd));
    setDrafts({});
    // A new project starts with no failed save of the old one's shown.
    setSaveError(null);
    void refresh();
  }, [cwd, refresh]);

  useEffect(() => {
    if (selected) setLastSettingsSelection("context", selected, cwd);
  }, [cwd, selected]);

  const select = (id: ContextFileId) => {
    setSaveError(null);
    setSelected(id);
  };

  const save = async (file: ContextFileInfo, remove: boolean) => {
    setSaving(file.id);
    setSaveError(null);
    const result = await saveContextFile(
      remove ? { id: file.id, remove: true } : { id: file.id, content: drafts[file.id] ?? file.content },
      cwd,
    );
    setSaving(null);
    if (!result.ok) {
      setSaveError(result.error);
      // The file may no longer say what the panel showed: load it again, keeping
      // the draft and the refusal's own alert.
      void refresh({ keepSaveError: true });
      return;
    }
    setDrafts((current) => {
      const next = { ...current };
      delete next[file.id];
      return next;
    });
    setLoad(result);
    setSelected(pickContextFile(result.data.files, file.id));
  };

  return (
    <ContextConfigView
      cwd={cwd}
      embedded={embedded}
      load={load}
      selected={selected}
      drafts={drafts}
      saving={saving}
      saveError={saveError}
      onSelect={select}
      onDraftChange={(id, value) => setDrafts((current) => ({ ...current, [id]: value }))}
      onSave={(file, remove) => void save(file, remove)}
      onRefresh={() => void refresh()}
      onClose={onClose}
    />
  );
}

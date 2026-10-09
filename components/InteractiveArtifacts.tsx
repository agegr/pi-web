"use client";

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { AgentMessage, AssistantContentBlock } from "@/lib/types";
import { mergeArtifactVersions, messageArtifactVersions, type ArtifactVersion } from "@/lib/interactive-artifacts";
import { useI18n } from "@/hooks/useI18n";
import { InteractivePreview } from "./InteractivePreview";
import { RefreshIcon } from "./SidebarIcons";

const EntryContext = createContext<string | undefined>(undefined);
export const InteractiveArtifactEntry = EntryContext.Provider;

const ArtifactsContext = createContext<{
  groups: Map<string, ArtifactVersion[]>;
  messages: Map<string, AgentMessage>;
  url?: string;
  error: boolean;
  loading: boolean;
  retry: () => void;
}>({ groups: new Map(), messages: new Map(), error: false, loading: false, retry() {} });

export function useInteractiveArtifactSource(block: AssistantContentBlock, fallbackIndex: number) {
  const entry = useContext(EntryContext);
  const context = useContext(ArtifactsContext);
  const message = entry ? context.messages.get(entry) : undefined;
  // Process/final-answer projection can change displayed block indices.
  const originalIndex = message?.role === "assistant" ? message.content.indexOf(block) : -1;
  return entry ? `${entry}:${originalIndex >= 0 ? originalIndex : fallbackIndex}` : undefined;
}

export function useOriginalAssistantBlocks() {
  const entry = useContext(EntryContext);
  const context = useContext(ArtifactsContext);
  const message = entry ? context.messages.get(entry) : undefined;
  return message?.role === "assistant" ? message.content : undefined;
}

export function InteractiveArtifactsProvider({ sessionId, leafId, messages, entryIds, children }: {
  sessionId?: string; leafId: string | null; messages: AgentMessage[]; entryIds: string[]; children: ReactNode;
}) {
  const scope = `${sessionId ?? ""}:${leafId ?? "null"}`;
  const local = useMemo(() => messages.flatMap((message, index) => message.role === "assistant"
    ? messageArtifactVersions(entryIds[index] ?? `pending-${index}`, message.content) : []), [messages, entryIds]);
  const hasArtifacts = local.length > 0;
  const sourceMessages = useMemo(() => new Map(messages.map((message, index) => [entryIds[index] ?? `pending-${index}`, message])), [messages, entryIds]);
  const [snapshot, setSnapshot] = useState<{ scope: string; versions: ArtifactVersion[]; error: boolean }>({ scope: "", versions: [], error: false });
  const [retry, setRetry] = useState(0);
  const url = sessionId ? `/api/sessions/${encodeURIComponent(sessionId)}/artifacts?leafId=${encodeURIComponent(leafId ?? "null")}` : undefined;
  useEffect(() => {
    if (!url || !hasArtifacts) return;
    const controller = new AbortController();
    fetch(url, { signal: controller.signal }).then(async (response) => {
      if (!response.ok) throw new Error("Artifact history unavailable");
      const data = await response.json() as { versions: ArtifactVersion[] };
      if (!Array.isArray(data.versions)) throw new Error("Invalid artifact history");
      if (!controller.signal.aborted) setSnapshot({ scope, versions: data.versions, error: false });
    }).catch(() => {
      if (!controller.signal.aborted) setSnapshot({ scope, versions: [], error: true });
    });
    return () => controller.abort();
  }, [url, scope, hasArtifacts, retry]);
  const groups = useMemo(() => mergeArtifactVersions(snapshot.scope === scope ? snapshot.versions : [], local), [snapshot, scope, local]);
  const value = useMemo(() => ({ groups, messages: sourceMessages, url, error: snapshot.scope === scope && snapshot.error,
    loading: Boolean(url && hasArtifacts && snapshot.scope !== scope), retry: () => setRetry((value) => value + 1),
  }), [groups, sourceMessages, url, snapshot, scope, hasArtifacts]);
  return <ArtifactsContext.Provider value={value}>{children}</ArtifactsContext.Provider>;
}

export function InteractiveArtifact({ id, sourceKey, code, complete, isStreaming }: {
  id?: string; sourceKey?: string; code: string; complete: boolean; isStreaming?: boolean;
}) {
  const { t } = useI18n();
  const context = useContext(ArtifactsContext);
  const versions = id ? context.groups.get(id) ?? [] : [];
  const owner = versions.find((version) => version.key === sourceKey);
  const latest = versions[versions.length - 1];
  const [open, setOpen] = useState(false);
  const [selection, setSelection] = useState<{ owner: string; key: string } | null>(null);
  const [loaded, setLoaded] = useState<{ url: string; version: ArtifactVersion } | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [loadRetry, setLoadRetry] = useState(0);
  const selected = versions.find((version) => version.key === (selection && selection.owner === sourceKey ? selection.key : sourceKey)) ?? owner;
  const requestUrl = selected && context.url ? `${context.url}&key=${encodeURIComponent(selected.key)}` : undefined;
  const selectedCode = selected?.code ?? (selected?.key === owner?.key && owner ? code : loaded && loaded.url === requestUrl ? loaded.version.code : undefined);
  useEffect(() => {
    if (!requestUrl || selectedCode !== undefined || (!open && owner?.key !== latest?.key)) return;
    const controller = new AbortController();
    fetch(requestUrl, { signal: controller.signal }).then(async (response) => {
      if (!response.ok) throw new Error("Artifact version unavailable");
      const data = await response.json() as { version: ArtifactVersion };
      if (data.version?.key !== selected?.key || typeof data.version.code !== "string") throw new Error("Invalid artifact version");
      if (!controller.signal.aborted) { setLoaded({ url: requestUrl, version: data.version }); setLoadError(false); }
    }).catch(() => { if (!controller.signal.aborted) setLoadError(true); });
    return () => controller.abort();
  }, [requestUrl, selectedCode, open, owner?.key, latest?.key, selected?.key, loadRetry]);

  if (!id || isStreaming || !complete || !owner) return <InteractivePreview code={code} complete={complete} isStreaming={isStreaming} />;
  const header = <>
    <span className="interactive-artifact-id" title={id}>{id}</span>
    <select aria-label={t("chat.artifactVersion")} title={t("chat.artifactVersionReset")}
      value={selected?.key ?? owner.key} disabled={context.loading}
      onChange={(event) => { setLoadError(false); setSelection({ owner: owner.key, key: event.target.value }); }}>
      {versions.map((version, index) => <option key={version.key} value={version.key}>{t("chat.artifactVersionNumber", { version: index + 1 })}</option>)}
    </select>
  </>;
  const preview = <>
    {context.error && <div className="interactive-artifact-status" role="status">
      {t("chat.artifactHistoryError")}
      <button type="button" className="interactive-preview-action" title={t("chat.artifactRetry")} aria-label={t("chat.artifactRetry")} onClick={context.retry}><RefreshIcon size={15} /></button>
    </div>}
    {selectedCode !== undefined ? <InteractivePreview key={selected?.key ?? owner.key} code={selectedCode} complete headerSlot={header}
      notice={versions.length > 1 ? t("chat.artifactVersionReset") : undefined} />
      : <div className="interactive-artifact-loading">
          <div className="markdown-code-header"><span className="interactive-preview-label">{header}</span></div>
          <div className="interactive-artifact-status" role="status">
            {loadError ? t("chat.artifactLoadError") : t("i18n.loading")}
            {loadError && <button type="button" className="interactive-preview-action" title={t("chat.artifactRetry")}
              aria-label={t("chat.artifactRetry")} onClick={() => { setLoadError(false); setLoadRetry((value) => value + 1); }}><RefreshIcon size={15} /></button>}
          </div>
        </div>}
  </>;
  if (owner.key === latest?.key) return preview;
  return <details className="interactive-artifact-history" onToggle={(event) => setOpen(event.currentTarget.open)}>
    <summary>{id} · {t("chat.artifactVersionNumber", { version: versions.indexOf(owner) + 1 })}</summary>
    {open && preview}
  </details>;
}

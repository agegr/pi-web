"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ChatWindow } from "./ChatWindow";
import type { ChatInputHandle } from "./ChatInput";
import { StatusIcon, statusColor } from "./AgentSessionPanel";
import { useI18n } from "@/hooks/useI18n";
import type { SessionInfo } from "@/lib/types";

interface Props {
  sessionId: string;
  running: boolean;
  /** `/side <prompt>`: the text that seeds the composer, once. */
  initialPrompt?: string;
  onInitialPromptConsumed?: () => void;
  modelsRefreshKey?: number;
  onOpenFile: (filePath: string, page?: number) => void;
  onOpenSubagent?: (sessionId: string, label: string) => void;
  onToolEnd?: (toolName: string) => void;
  onFilesUploaded?: () => void;
  soundEnabled?: boolean;
  onSoundToggle?: () => void;
  playDoneSound?: () => void;
  unlockAudio?: () => void;
  holdAudio?: () => () => void;
}

/**
 * A side chat's tab in the right panel (ADR 0007): the full interactive chat,
 * scoped to the forked session. The fork inherited the parent's history; the
 * panel never rewrites the URL, never promotes the session into the sidebar,
 * and stays quiet on completion (a side chat is an aside, not the task).
 *
 * The session info is fetched here, like SubagentViewer: the tab opens the
 * moment `/side` returns, before the session list refresh folds the new row
 * into its family.
 */
export function SideChatPanel({
  sessionId,
  running,
  initialPrompt,
  onInitialPromptConsumed,
  modelsRefreshKey,
  onOpenFile,
  onOpenSubagent,
  onToolEnd,
  onFilesUploaded,
  soundEnabled = true,
  onSoundToggle,
  playDoneSound = () => {},
  unlockAudio,
  holdAudio,
}: Props) {
  const { t, locale } = useI18n();
  const [info, setInfo] = useState<SessionInfo | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const chatInputRef = useRef<ChatInputHandle | null>(null);

  // The row the fork carries: relation, cwd, name. Re-read when a run ends
  // (the modified stamp moves) and on manual refresh.
  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      try {
        const res = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}`, {
          signal: controller.signal,
          cache: "no-store",
        });
        if (res.status === 404) {
          setNotFound(true);
          return;
        }
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json() as { info?: SessionInfo; error?: string };
        if (!data.info) throw new Error(data.error ?? `HTTP ${res.status}`);
        setNotFound(false);
        setError(null);
        setInfo(data.info);
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") return;
        setError(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => controller.abort();
  }, [sessionId, running, refreshKey]);

  const handleInitialPromptConsumed = useCallback(() => {
    onInitialPromptConsumed?.();
  }, [onInitialPromptConsumed]);

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", minWidth: 0 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "6px 12px",
          borderBottom: "1px solid var(--border)",
          background: "var(--bg-panel)",
          flexShrink: 0,
          minHeight: 36,
        }}
      >
        <span style={{ display: "flex", alignItems: "center", color: "var(--accent)", flexShrink: 0 }} aria-hidden="true">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 12a8 8 0 0 1-8 8H5.5a2 2 0 0 1-1.4-3.4A8 8 0 1 1 21 12z" />
          </svg>
        </span>
        <strong
          style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 12, fontWeight: 600 }}
          title={t("sideChat.title")}
        >
          {t("sideChat.title")}
        </strong>
        <span
          style={{ display: "flex", alignItems: "center", gap: 5, color: running ? statusColor("running") : "var(--text-dim)", fontSize: 11, whiteSpace: "nowrap", flexShrink: 0 }}
        >
          {running && <StatusIcon status="running" />}
          <span>{t(running ? "agentSwitcher.status.running" : "sideChat.readMostly")}</span>
        </span>
        <button
          type="button"
          onClick={() => setRefreshKey((key) => key + 1)}
          title={t("subagent.refresh")}
          aria-label={t("subagent.refresh")}
          style={{
            display: "grid", placeItems: "center", width: 24, height: 24, flexShrink: 0,
            background: "none", border: "none", borderRadius: 4, color: "var(--text-dim)", cursor: "pointer", padding: 0,
          }}
          onMouseEnter={(event) => { event.currentTarget.style.color = "var(--text)"; }}
          onMouseLeave={(event) => { event.currentTarget.style.color = "var(--text-dim)"; }}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M21 12a9 9 0 1 1-2.64-6.36" /><path d="M21 3v6h-6" />
          </svg>
        </button>
      </div>

      <div style={{ flex: 1, minHeight: 0 }} lang={locale}>
        {notFound ? (
          <div style={{ padding: "24px 16px", color: "var(--text-muted)", fontSize: 12, textAlign: "center" }}>
            {t("sideChat.deleted")}
          </div>
        ) : error && !info ? (
          <div role="alert" style={{ padding: "24px 16px", color: "#dc2626", fontSize: 12, textAlign: "center" }}>
            {t("subagent.viewer.error")}
            <div style={{ marginTop: 6, color: "var(--text-dim)", fontFamily: "var(--font-mono)", overflowWrap: "anywhere" }}>{error}</div>
          </div>
        ) : info ? (
          <ChatWindow
            session={info}
            sessionRunning={running}
            newSessionCwd={null}
            newSessionDraftKey={null}
            modelsRefreshKey={modelsRefreshKey}
            chatInputRef={chatInputRef}
            onOpenFile={onOpenFile}
            onOpenSubagent={onOpenSubagent}
            onToolEnd={onToolEnd}
            onFilesUploaded={onFilesUploaded}
            initialPrompt={initialPrompt}
            onInitialPromptConsumed={handleInitialPromptConsumed}
            soundEnabled={soundEnabled}
            onSoundToggle={onSoundToggle}
            playDoneSound={playDoneSound}
            unlockAudio={unlockAudio}
            holdAudio={holdAudio}
          />
        ) : (
          <div style={{ padding: "24px 16px", color: "var(--text-dim)", fontSize: 12, textAlign: "center" }}>
            {t("sideChat.loading")}
          </div>
        )}
      </div>
    </div>
  );
}

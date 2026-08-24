"use client";

import { useEffect, useMemo, useState, type ReactNode, type Ref } from "react";
import type { AgentMessage, AssistantMessage, BashExecutionMessage, ToolResultMessage } from "@/lib/types";
import type { AgentPhase } from "@/hooks/useAgentSession";
import type { DiscussionThreadDescriptor } from "@/lib/discussion-threads";
import { useI18n } from "@/hooks/useI18n";
import { MessageView } from "./MessageView";

interface ThreadContext {
  messages: AgentMessage[];
  entryIds: string[];
}

interface Props {
  sessionId: string;
  thread: DiscussionThreadDescriptor;
  active: boolean;
  activeContext?: ThreadContext;
  isRunning?: boolean;
  streamingMessage?: AssistantMessage | null;
  phase?: AgentPhase;
  bashRunning?: boolean;
  pendingBash?: { command: string; excludeFromContext: boolean } | null;
  modelNames?: Record<string, string>;
  cwd?: string;
  onOpenFile?: (filePath: string) => void;
  onOpenChangedFile?: (filePath: string) => void;
  onOpenUrl?: (url: string) => void;
  onContinue: () => void;
  onReturnToMain: () => void;
  endRef?: Ref<HTMLDivElement>;
}

function phaseText(phase: AgentPhase, t: (key: string, params?: Record<string, string | number>) => string): string | null {
  if (phase?.kind === "waiting_model") return t("chat.waitingModel");
  if (phase?.kind === "running_command") return t("chat.runningCommand");
  if (phase?.kind === "running_tools") {
    const latest = phase.tools[phase.tools.length - 1];
    return latest ? t("chat.runningNamedTool", { name: latest.name }) : t("chat.runningTool");
  }
  return null;
}

function ThreadProcessDetails({ count, children, t }: { count: number; children: ReactNode; t: (key: string, params?: Record<string, string | number>) => string }) {
  return (
    <details style={{ margin: "4px 0 10px", border: "1px solid var(--border)", borderRadius: 6, overflow: "hidden", background: "var(--bg)" }}>
      <summary style={{ padding: "6px 9px", color: "var(--text-muted)", cursor: "pointer", fontSize: 11 }}>
        {t("chat.processDetails")} · {count} {t(count === 1 ? "chat.message" : "chat.messages")}
      </summary>
      <div style={{ padding: "7px 9px", borderTop: "1px solid var(--border)" }}>{children}</div>
    </details>
  );
}

function threadDelta(context: ThreadContext | null, sourceEntryId: string): ThreadContext {
  if (!context) return { messages: [], entryIds: [] };
  const sourceIndex = context.entryIds.indexOf(sourceEntryId);
  if (sourceIndex === -1) return { messages: context.messages, entryIds: context.entryIds };
  return {
    messages: context.messages.slice(sourceIndex + 1),
    entryIds: context.entryIds.slice(sourceIndex + 1),
  };
}

export function DiscussionThreadPanel({
  sessionId,
  thread,
  active,
  activeContext,
  isRunning,
  streamingMessage,
  phase,
  bashRunning,
  pendingBash,
  modelNames,
  cwd,
  onOpenFile,
  onOpenChangedFile,
  onOpenUrl,
  onContinue,
  onReturnToMain,
  endRef,
}: Props) {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState(active);
  const [loadedContext, setLoadedContext] = useState<{ leafId: string; context: ThreadContext } | null>(null);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    if (active) setExpanded(true);
  }, [active]);

  useEffect(() => {
    setLoadError(false);
  }, [thread.latestLeafId]);

  useEffect(() => {
    if (!expanded || active || loadedContext?.leafId === thread.latestLeafId || loadError) return;
    const controller = new AbortController();
    const params = new URLSearchParams({ leafId: thread.latestLeafId, deferThinking: "1", deferMedia: "1" });
    void fetch(`/api/sessions/${encodeURIComponent(sessionId)}/context?${params}`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json() as Promise<{ context: ThreadContext }>;
      })
      .then((result) => setLoadedContext({ leafId: thread.latestLeafId, context: result.context }))
      .catch((error) => {
        if ((error as { name?: string }).name !== "AbortError") setLoadError(true);
      });
    return () => controller.abort();
  }, [active, expanded, loadError, loadedContext, sessionId, thread.latestLeafId]);

  const context = active ? activeContext ?? null : loadedContext?.context ?? null;
  const delta = useMemo(() => threadDelta(context, thread.sourceEntryId), [context, thread.sourceEntryId]);
  const toolResults = useMemo(() => {
    const results = new Map<string, ToolResultMessage>();
    for (const message of delta.messages) {
      if (message.role === "toolResult") results.set(message.toolCallId, message);
    }
    return results;
  }, [delta.messages]);
  const visibleCount = delta.messages.filter((message) => message.role === "user" || message.role === "assistant").length;
  const livePhase = active && isRunning ? phaseText(phase ?? null, t) : null;
  const liveUserIndex = active && isRunning
    ? delta.messages.findLastIndex((message) => message.role === "user")
    : -1;
  const settledMessages = liveUserIndex === -1
    ? delta.messages
    : delta.messages.slice(0, liveUserIndex + 1);
  const liveMessages = liveUserIndex === -1 ? [] : delta.messages.slice(liveUserIndex + 1);
  const settledEntryIds = liveUserIndex === -1
    ? delta.entryIds
    : delta.entryIds.slice(0, liveUserIndex + 1);

  return (
    <section style={{ margin: "8px 0 12px 18px", borderLeft: `2px solid ${active ? "var(--accent)" : "var(--border)"}`, paddingLeft: 10 }}>
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        aria-expanded={expanded}
        style={{
          display: "flex", alignItems: "center", width: "100%", gap: 6,
          padding: "5px 0", border: 0, background: "transparent", color: "var(--text-muted)",
          cursor: "pointer", textAlign: "left", fontSize: 11,
        }}
      >
        <span aria-hidden="true" style={{ transform: expanded ? "rotate(90deg)" : "none", transition: "transform 0.12s" }}>▸</span>
        <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: active ? "var(--text)" : "var(--text-muted)" }}>{thread.title}</span>
        {active && <span style={{ color: "var(--accent)", fontSize: 10 }}>· {t("chat.activeThread")}</span>}
        {!active && visibleCount > 0 && <span style={{ color: "var(--text-dim)", fontSize: 10 }}>· {visibleCount}</span>}
      </button>

      {expanded && (
        <div style={{ padding: "6px 10px 8px", border: "1px solid var(--border)", borderRadius: 7, background: "var(--bg)" }}>
          {loadError ? (
            <div style={{ color: "var(--text-muted)", fontSize: 12 }}>{t("chat.threadLoadFailed")}</div>
          ) : !context && !active ? (
            <div style={{ color: "var(--text-dim)", fontSize: 12 }}>{t("sidebar.loading")}</div>
          ) : delta.messages.length === 0 && !streamingMessage && !livePhase && !bashRunning ? (
            <div style={{ color: "var(--text-dim)", fontSize: 12, fontStyle: "italic" }}>{t("chat.threadEmpty")}</div>
          ) : (
            <>
              {(() => {
                const renderMessage = (message: AgentMessage, index: number, processingState?: "complete") => (
                  <MessageView
                    key={settledEntryIds[index] ?? `thread-message-${index}`}
                    message={message}
                    processingState={processingState}
                    toolResults={toolResults}
                    modelNames={modelNames}
                    cwd={cwd}
                    onOpenFile={onOpenFile}
                    onOpenChangedFile={onOpenChangedFile}
                    onOpenUrl={onOpenUrl}
                    entryId={settledEntryIds[index]}
                    showTimestamp={message.role === "assistant" && !processingState}
                    prevTimestamp={index > 0 ? (settledMessages[index - 1] as AgentMessage & { timestamp?: number }).timestamp : undefined}
                    sessionId={sessionId}
                  />
                );
                const rendered: ReactNode[] = [];
                for (let start = 0; start < settledMessages.length;) {
                  const message = settledMessages[start];
                  if (message.role !== "user") {
                    rendered.push(renderMessage(message, start));
                    start += 1;
                    continue;
                  }
                  let end = start + 1;
                  while (end < settledMessages.length && settledMessages[end].role !== "user") end += 1;
                  let finalAssistant = -1;
                  for (let candidate = end - 1; candidate > start; candidate -= 1) {
                    if (settledMessages[candidate].role === "assistant") {
                      finalAssistant = candidate;
                      break;
                    }
                  }
                  if (finalAssistant === -1) {
                    for (let index = start; index < end; index += 1) rendered.push(renderMessage(settledMessages[index], index));
                    start = end;
                    continue;
                  }
                  rendered.push(renderMessage(message, start));
                  const processIndexes = Array.from({ length: Math.max(0, finalAssistant - start - 1) }, (_, offset) => start + 1 + offset)
                    .filter((index) => settledMessages[index].role === "assistant" || settledMessages[index].role === "custom");
                  if (processIndexes.length > 0) {
                    rendered.push(
                      <ThreadProcessDetails key={`thread-process-${settledEntryIds[start] ?? start}`} count={processIndexes.length} t={t}>
                        {processIndexes.map((index) => renderMessage(settledMessages[index], index, "complete"))}
                      </ThreadProcessDetails>,
                    );
                  }
                  rendered.push(renderMessage(settledMessages[finalAssistant], finalAssistant));
                  for (let index = finalAssistant + 1; index < end; index += 1) rendered.push(renderMessage(settledMessages[index], index));
                  start = end;
                }
                return rendered;
              })()}
              {(liveMessages.length > 0 || streamingMessage || livePhase) && (
                <div style={{ marginBottom: 10, padding: "8px 10px", border: "1px solid var(--border)", borderRadius: 6, background: "var(--bg)" }}>
                  <div style={{ marginBottom: 6, color: "var(--text-muted)", fontSize: 11 }}>{t("chat.processDetails")}</div>
                  {liveMessages.map((message, index) => (
                    <MessageView
                      key={delta.entryIds[liveUserIndex + 1 + index] ?? `thread-live-${index}`}
                      message={message}
                      processingState="complete"
                      toolResults={toolResults}
                      modelNames={modelNames}
                      cwd={cwd}
                      onOpenFile={onOpenFile}
                      onOpenChangedFile={onOpenChangedFile}
                      onOpenUrl={onOpenUrl}
                      sessionId={sessionId}
                    />
                  ))}
                  {streamingMessage && (
                    <MessageView
                      message={streamingMessage}
                      isStreaming
                      processingState="active"
                      toolResults={toolResults}
                      modelNames={modelNames}
                      cwd={cwd}
                      onOpenFile={onOpenFile}
                      onOpenUrl={onOpenUrl}
                    />
                  )}
                  {livePhase && !streamingMessage && (
                    <div className="break-words py-2 text-[13px] text-text-muted">
                      <span className="animate-[pulse_1.5s_infinite]">{livePhase}</span>
                    </div>
                  )}
                </div>
              )}
              {active && bashRunning && !pendingBash && (
                <div className="py-2 text-[13px] text-text-muted">
                  <span className="animate-[pulse_1.5s_infinite]">{t("chat.runningCommand")}</span>
                </div>
              )}
              {active && pendingBash && (
                <MessageView
                  message={{
                    role: "bashExecution",
                    command: pendingBash.command,
                    output: "",
                    excludeFromContext: pendingBash.excludeFromContext,
                  } as BashExecutionMessage}
                  sessionId={sessionId}
                />
              )}
            </>
          )}

          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 4 }}>
            {active ? (
              <button type="button" onClick={onReturnToMain} disabled={Boolean(isRunning)} style={{ padding: "4px 8px", border: "1px solid var(--border)", borderRadius: 5, background: "var(--bg)", color: "var(--text-muted)", cursor: isRunning ? "not-allowed" : "pointer", fontSize: 11 }}>
                {t("chat.returnToMain")}
              </button>
            ) : (
              <button type="button" onClick={onContinue} style={{ padding: "4px 8px", border: "1px solid var(--border)", borderRadius: 5, background: "var(--bg)", color: "var(--accent)", cursor: "pointer", fontSize: 11 }}>
                {t("chat.continueThread")}
              </button>
            )}
          </div>
          {active && <div ref={endRef} />}
        </div>
      )}
    </section>
  );
}

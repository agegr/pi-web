"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { encodeFilePathForApi } from "@/lib/file-paths";
import { MarkdownSync, type MarkdownDraft, type MarkdownSyncState } from "@/lib/markdown-sync";

const memoryDrafts = new Map<string, MarkdownDraft>();
const emptySubscribe = () => () => {};

/** Shared synchronization hook for editable UTF-8 text files. */
export function useTextFile(filePath: string, initial: string, sourceSessionId?: string | null, watchEnabled = true) {
  const [sync, setSync] = useState<MarkdownSync | null>(null);
  const [fallback] = useState<MarkdownSyncState>({ content: initial, conflicts: [], error: null, saving: false });
  const state = useSyncExternalStore(sync?.subscribe ?? emptySubscribe, sync?.getSnapshot ?? (() => fallback), () => fallback);

  useEffect(() => {
    const key = `pi-web:markdown-draft:${filePath}`;
    const url = `/api/files/${encodeFilePathForApi(filePath)}`;
    const query = sourceSessionId ? `&sessionId=${encodeURIComponent(sourceSessionId)}` : "";
    let draft = memoryDrafts.get(key) ?? null;
    try {
      const stored = JSON.parse(localStorage.getItem(key) ?? "null");
      if (typeof stored?.base === "string" && typeof stored?.content === "string") draft = stored;
    } catch { /* In-memory recovery still works when storage is unavailable. */ }
    const session = new MarkdownSync(initial, {
      async read() {
        const response = await fetch(`${url}?type=read${query}`, { cache: "no-store", signal: AbortSignal.timeout(15000) });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error ?? `Read failed (${response.status})`);
        if (data.truncated || data.editable === false || typeof data.content !== "string") throw new Error("File is no longer editable; your draft is retained.");
        return data.content;
      },
      async write(content, baseContent) {
        const response = await fetch(url, { method: "PATCH", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content, baseContent }), signal: AbortSignal.timeout(15000) });
        const data = await response.json();
        if (response.status === 409 && typeof data.content === "string") return { conflict: true, content: data.content };
        if (!response.ok || data.success !== true) throw new Error(data.error ?? `Save failed (${response.status})`);
        return {};
      },
      persist(value) {
        if (value) memoryDrafts.set(key, value);
        else memoryDrafts.delete(key);
        try {
          if (value) localStorage.setItem(key, JSON.stringify(value));
          else localStorage.removeItem(key);
        } catch { /* Never discard the live draft on quota/storage failures. */ }
      },
    }, draft);
    setSync(session);
    let refreshTimer: ReturnType<typeof setTimeout>;
    const refresh = () => {
      clearTimeout(refreshTimer);
      refreshTimer = setTimeout(() => void session.refresh(), 200);
    };
    const stream = watchEnabled ? new EventSource(`${url}?type=watch${query}`) : null;
    stream?.addEventListener("connected", refresh);
    stream?.addEventListener("change", refresh);
    // Reconciliation also covers missed events and background-tab reconnects.
    const resume = () => { if (document.visibilityState === "visible") refresh(); };
    const poll = watchEnabled ? setInterval(resume, 5000) : undefined;
    window.addEventListener("online", resume);
    document.addEventListener("visibilitychange", resume);
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (session.dirty) { event.preventDefault(); event.returnValue = ""; }
    };
    window.addEventListener("beforeunload", beforeUnload);
    // Even when live watching is paused, verify the initial snapshot once.
    void session.refresh();
    return () => {
      clearTimeout(refreshTimer);
      clearInterval(poll);
      stream?.close();
      window.removeEventListener("online", resume);
      document.removeEventListener("visibilitychange", resume);
      window.removeEventListener("beforeunload", beforeUnload);
      session.dispose();
    };
    // initial is the mount snapshot. Live changes go through the serialized
    // synchronizer; a parent refresh must never recreate the editor or baseline.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filePath, sourceSessionId, watchEnabled]);
  return { sync, state };
}

// Keep the old name for the existing Markdown editor.
export const useMarkdownFile = useTextFile;

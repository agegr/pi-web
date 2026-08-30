"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  buildAncestorsForNode,
  buildAnkiCsv,
  buildChainHtmlMindmap,
  buildChainMarkdown,
  findExistingNode,
  newResearchNodeId,
  RESEARCH_DEPTH_ORDER,
  type ResearchAncestor,
  type ResearchDepth,
  type ResearchFollowup,
  type ResearchNode,
} from "@/lib/term-research";

const STORAGE_KEY_PREFIX = "pi-research-chain-v1";

function storageKeyFor(scopeKey: string | undefined): string | null {
  return scopeKey ? `${STORAGE_KEY_PREFIX}:${scopeKey}` : null;
}

export interface ExplainRequestInput {
  term: string;
  context?: string;
  /** Explanation card the selection happened inside, if any. */
  parentId?: string | null;
  provider?: string;
  modelId?: string;
  /** Session cwd, used to resolve npm-package providers server-side. */
  cwd?: string;
  /** Ask the server to ground the explanation in web search results. */
  web?: boolean;
}

interface PersistedChain {
  nodes: ResearchNode[];
}

function loadPersistedNodes(key: string): ResearchNode[] {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as PersistedChain;
    if (!Array.isArray(parsed.nodes)) return [];
    // A refresh interrupts "loading" runs; keep them as answerable errors
    // instead of permanently spinning rows.
    return parsed.nodes
      .filter((n) => n && typeof n.id === "string" && typeof n.term === "string")
      .map((n) => (n.status === "loading"
        ? { ...n, status: "error" as const, error: "Interrupted by page reload" }
        : n));
  } catch {
    return [];
  }
}

function persistNodes(key: string, nodes: ResearchNode[]): void {
  try {
    // Thinking traces are ephemeral — drop them so chains stay small.
    // `thinking: undefined` is skipped by JSON.stringify.
    const slim = nodes.map((n) => (n.thinking === undefined ? n : { ...n, thinking: undefined }));
    window.localStorage.setItem(key, JSON.stringify({ nodes: slim } satisfies PersistedChain));
  } catch {
    // Private mode / quota — the chain just lives in memory for this session.
  }
}

/** Remove the stored chain of a deleted session (called from the sidebar). */
export function forgetResearchChain(sessionId: string): void {
  try {
    window.localStorage.removeItem(`${STORAGE_KEY_PREFIX}:${sessionId}`);
  } catch {
    // ignore
  }
}

function stamp(): string {
  return new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
}

function downloadTextFile(content: string, mimeType: string, filename: string): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Scope and its chain live in ONE state on purpose: a session switch swaps
 * both atomically, so the persist effect can never write one session's
 * nodes under another session's key.
 */
interface ScopedChain {
  scope: string | undefined;
  nodes: ResearchNode[];
  openIds: string[];
}

const EMPTY_CHAIN: ScopedChain = { scope: undefined, nodes: [], openIds: [] };

/**
 * State machine for the Research Lens: a per-session forest of explanation
 * nodes with streaming AI answers, an open-card list for the overlay, and
 * localStorage persistence scoped to the session so switching or deleting
 * a session switches or drops its chain.
 */
export function useTermResearch(locale: string, scopeKey: string | undefined) {
  const [chain, setChain] = useState<ScopedChain>(EMPTY_CHAIN);
  const abortsRef = useRef(new Map<string, AbortController>());
  const nodesRef = useRef<ResearchNode[]>([]);
  nodesRef.current = chain.nodes;

  useEffect(() => {
    const key = storageKeyFor(scopeKey);
    // Drop in-flight explanations from the previous session.
    for (const ac of abortsRef.current.values()) ac.abort();
    abortsRef.current.clear();
    if (!key) {
      setChain(EMPTY_CHAIN);
      return;
    }
    setChain({ scope: scopeKey, nodes: loadPersistedNodes(key), openIds: [] });
  }, [scopeKey]);

  useEffect(() => {
    const key = storageKeyFor(chain.scope);
    if (!key) return;
    // Don't materialize empty entries for sessions that never had a chain.
    if (chain.nodes.length === 0 && !window.localStorage.getItem(key)) return;
    persistNodes(key, chain.nodes);
  }, [chain]);

  const byId = useMemo(() => new Map(chain.nodes.map((n) => [n.id, n])), [chain.nodes]);

  const patchNode = useCallback((id: string, patch: Partial<ResearchNode>) => {
    setChain((prev) => ({ ...prev, nodes: prev.nodes.map((n) => (n.id === id ? { ...n, ...patch } : n)) }));
  }, []);

  const openCard = useCallback((id: string) => {
    setChain((prev) => (prev.openIds.includes(id) ? prev : { ...prev, openIds: [...prev.openIds, id] }));
  }, []);

  const closeCard = useCallback((id: string) => {
    setChain((prev) => ({ ...prev, openIds: prev.openIds.filter((x) => x !== id) }));
  }, []);

  const runExplain = useCallback((node: ResearchNode) => {
    const controller = new AbortController();
    abortsRef.current.set(node.id, controller);
    const ancestors: ResearchAncestor[] = buildAncestorsForNode(nodesRef.current, node.parentId);

    (async () => {
      try {
        const response = await fetch("/api/research/define", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            term: node.term,
            context: node.context,
            ancestors,
            depth: node.depth,
            lang: node.lang,
            provider: node.provider,
            modelId: node.modelId,
            cwd: node.cwd,
            web: node.web === true,
          }),
          signal: controller.signal,
        });
        if (!response.ok || !response.body) {
          const detail = await response.json().catch(() => null) as { error?: string } | null;
          throw new Error(detail?.error ?? `HTTP ${response.status}`);
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let text = "";
        let thinking = "";
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let boundary = buffer.indexOf("\n\n");
          while (boundary !== -1) {
            const chunk = buffer.slice(0, boundary);
            buffer = buffer.slice(boundary + 2);
            boundary = buffer.indexOf("\n\n");
            const dataLine = chunk.split("\n").find((l) => l.startsWith("data: "));
            if (!dataLine) continue;
            let event: { type?: string; text?: string; error?: string; status?: string };
            try {
              event = JSON.parse(dataLine.slice(6));
            } catch {
              continue;
            }
            if (event.type === "delta" && typeof event.text === "string") {
              text += event.text;
              patchNode(node.id, { explanation: text });
            } else if (event.type === "thinking" && typeof event.text === "string") {
              thinking += event.text;
              patchNode(node.id, { thinking });
            } else if (event.type === "web" && (event.status === "ok" || event.status === "failed")) {
              patchNode(node.id, { webStatus: event.status });
            } else if (event.type === "done") {
              patchNode(node.id, { status: "done", explanation: text.trim(), thinking: undefined });
              return;
            } else if (event.type === "error") {
              patchNode(node.id, {
                status: "error",
                error: event.error ?? "Unknown error",
                explanation: text,
                thinking: undefined,
              });
              return;
            }
          }
        }
        // Stream ended without an explicit done/error frame.
        if (text.trim()) patchNode(node.id, { status: "done", explanation: text.trim(), thinking: undefined });
        else patchNode(node.id, { status: "error", error: "Empty response", thinking: undefined });
      } catch (error) {
        if (controller.signal.aborted) return;
        patchNode(node.id, {
          status: "error",
          error: error instanceof Error ? error.message : String(error),
        });
      } finally {
        abortsRef.current.delete(node.id);
      }
    })();
  }, [patchNode]);

  const explain = useCallback((input: ExplainRequestInput): string | null => {
    const term = input.term.trim();
    if (!term) return null;

    const parentId = input.parentId ?? null;
    const existing = findExistingNode(nodesRef.current, term, parentId, "standard");
    if (existing) {
      openCard(existing.id);
      return existing.id;
    }

    const id = newResearchNodeId();
    const node: ResearchNode = {
      id,
      parentId,
      term,
      context: input.context,
      depth: "standard",
      lang: locale,
      provider: input.provider,
      modelId: input.modelId,
      cwd: input.cwd,
      status: "loading",
      explanation: "",
      createdAt: Date.now(),
    };
    setChain((prev) => ({ ...prev, nodes: [...prev.nodes, node], openIds: [...prev.openIds, id] }));
    runExplain(node);
    return id;
  }, [locale, openCard, runExplain]);

  const setDepth = useCallback((id: string, depth: ResearchDepth) => {
    const node = nodesRef.current.find((n) => n.id === id);
    if (!node || node.status === "loading" || !RESEARCH_DEPTH_ORDER.includes(depth)) return;
    if (node.depth === depth) return;
    const updated: ResearchNode = { ...node, depth, status: "loading", explanation: "", thinking: undefined, error: undefined };
    setChain((prev) => ({ ...prev, nodes: prev.nodes.map((n) => (n.id === id ? updated : n)) }));
    runExplain(updated);
  }, [runExplain]);

  const retry = useCallback((id: string) => {
    const node = nodesRef.current.find((n) => n.id === id);
    if (!node || node.status === "loading") return;
    const updated: ResearchNode = { ...node, status: "loading", explanation: "", thinking: undefined, error: undefined };
    setChain((prev) => ({ ...prev, nodes: prev.nodes.map((n) => (n.id === id ? updated : n)) }));
    runExplain(updated);
  }, [runExplain]);

  const removeSubtree = useCallback((id: string) => {
    const doomed = new Set<string>([id]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const n of nodesRef.current) {
        if (n.parentId && doomed.has(n.parentId) && !doomed.has(n.id)) {
          doomed.add(n.id);
          grew = true;
        }
      }
    }
    for (const target of doomed) abortsRef.current.get(target)?.abort();
    setChain((prev) => ({
      ...prev,
      nodes: prev.nodes.filter((n) => !doomed.has(n.id)),
      openIds: prev.openIds.filter((x) => !doomed.has(x)),
    }));
  }, []);

  const askFollowup = useCallback((nodeId: string, question: string): boolean => {
    const trimmed = question.trim();
    const node = nodesRef.current.find((n) => n.id === nodeId);
    if (!node || !trimmed || node.status === "loading") return false;
    const activeFollowup = (node.followups ?? []).some((f) => f.status === "loading");
    if (activeFollowup) return false;

    const followup: ResearchFollowup = {
      id: newResearchNodeId(),
      question: trimmed,
      answer: "",
      status: "loading",
    };
    const updated: ResearchNode = { ...node, followups: [...(node.followups ?? []), followup] };
    setChain((prev) => ({ ...prev, nodes: prev.nodes.map((n) => (n.id === nodeId ? updated : n)) }));

    const controller = new AbortController();
    abortsRef.current.set(followup.id, controller);
    const ancestors: ResearchAncestor[] = buildAncestorsForNode(nodesRef.current, updated.parentId);

    (async () => {
      const patchFollowup = (patch: Partial<ResearchFollowup>) => {
        setChain((prev) => ({
          ...prev,
          nodes: prev.nodes.map((n) => (n.id === nodeId
            ? { ...n, followups: (n.followups ?? []).map((f) => (f.id === followup.id ? { ...f, ...patch } : f)) }
            : n)),
        }));
      };
      try {
        const response = await fetch("/api/research/define", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            term: node.term,
            mode: "followup",
            question: trimmed,
            parentExplanation: node.explanation,
            ancestors,
            depth: node.depth,
            lang: node.lang,
            provider: node.provider,
            modelId: node.modelId,
            cwd: node.cwd,
            web: node.web === true,
          }),
          signal: controller.signal,
        });
        if (!response.ok || !response.body) {
          const detail = await response.json().catch(() => null) as { error?: string } | null;
          throw new Error(detail?.error ?? `HTTP ${response.status}`);
        }
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let answer = "";
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let boundary = buffer.indexOf("\n\n");
          while (boundary !== -1) {
            const chunk = buffer.slice(0, boundary);
            buffer = buffer.slice(boundary + 2);
            boundary = buffer.indexOf("\n\n");
            const dataLine = chunk.split("\n").find((l) => l.startsWith("data: "));
            if (!dataLine) continue;
            let event: { type?: string; text?: string; error?: string };
            try {
              event = JSON.parse(dataLine.slice(6));
            } catch {
              continue;
            }
            if (event.type === "delta" && typeof event.text === "string") {
              answer += event.text;
              patchFollowup({ answer });
            } else if (event.type === "done") {
              patchFollowup({ status: "done", answer: answer.trim() });
              return;
            } else if (event.type === "error") {
              patchFollowup({ status: "error", error: event.error ?? "Unknown error", answer });
              return;
            }
          }
        }
        if (answer.trim()) patchFollowup({ status: "done", answer: answer.trim() });
        else patchFollowup({ status: "error", error: "Empty response" });
      } catch (error) {
        if (controller.signal.aborted) return;
        patchFollowup({ status: "error", error: error instanceof Error ? error.message : String(error) });
      } finally {
        abortsRef.current.delete(followup.id);
      }
    })();
    return true;
  }, []);

  /** Re-run a node's explanation with or without web grounding. */
  const setWeb = useCallback((id: string, web: boolean) => {
    const node = nodesRef.current.find((n) => n.id === id);
    if (!node || node.status === "loading" || node.web === web) return;
    const updated: ResearchNode = { ...node, web, status: "loading", explanation: "", thinking: undefined, error: undefined };
    setChain((prev) => ({ ...prev, nodes: prev.nodes.map((n) => (n.id === id ? updated : n)) }));
    runExplain(updated);
  }, [runExplain]);

  const clearAll = useCallback(() => {
    for (const ac of abortsRef.current.values()) ac.abort();
    setChain((prev) => ({ ...prev, nodes: [], openIds: [] }));
  }, []);

  const exportMarkdown = useCallback(() => {
    downloadTextFile(buildChainMarkdown(nodesRef.current), "text/markdown;charset=utf-8", `concept-chain-${stamp()}.md`);
  }, []);

  const exportMindmap = useCallback(() => {
    downloadTextFile(buildChainHtmlMindmap(nodesRef.current), "text/html;charset=utf-8", `concept-mindmap-${stamp()}.html`);
  }, []);

  const exportAnki = useCallback(() => {
    downloadTextFile(buildAnkiCsv(nodesRef.current), "text/csv;charset=utf-8", `anki-cards-${stamp()}.csv`);
  }, []);

  const topOpenId = chain.openIds.length > 0 ? chain.openIds[chain.openIds.length - 1] : null;

  const closeTopCard = useCallback(() => {
    if (topOpenId) closeCard(topOpenId);
  }, [closeCard, topOpenId]);

  return {
    nodes: chain.nodes,
    byId,
    openIds: chain.openIds,
    openCount: chain.openIds.length,
    explain,
    openCard,
    closeCard,
    closeTopCard,
    setDepth,
    retry,
    setWeb,
    askFollowup,
    removeSubtree,
    clearAll,
    exportMarkdown,
    exportMindmap,
    exportAnki,
  };
}

export type TermResearch = ReturnType<typeof useTermResearch>;

import { useCallback, useEffect, useRef, useState } from "react";

// Shared `/api/agent/running/events` SSE across same-origin tabs.
//
// Why: each open pi-web tab used to open its own SSE for the running-sessions
// list. Browsers cap HTTP/1.1 same-origin connections at 6, and SSE holds them
// open, so ~3 tabs starved the pool and new SSE (agent events, file watch)
// could no longer connect. Only ONE tab needs to hold this stream — the data
// is a global set, identical for every tab — so the leader relays frames over
// a BroadcastChannel and followers reuse them. Per-tab agent events SSE is
// unaffected (it is per-session, not shared).
//
// Lease-based leader election: the leader writes {id,ts} to localStorage every
// HEARTBEAT_MS. A follower that sees the lease stale past STALE_MS takes over.
// Worst case (race) two tabs briefly hold the stream — one extra SSE, not
// fatal; next tick one concedes. ponytail: O(1) localStorage lease; fine while
// tab count stays in the dozens — switch to a SharedWorker if we ever need
// hard mutual exclusion or cross-tab backpressure.

const CHANNEL = "pi-running-sessions";
const LS_LEASE = "pi-running-leader";
const HEARTBEAT_MS = 1500;
const STALE_MS = 4000;

type RunningMsg = { type: "running"; runningSessionIds: string[] };

export function useSharedRunningSessions() {
  const [runningSessionIds, setRunningSessionIds] = useState<Set<string>>(() => new Set());
  const authoritativeRef = useRef(false);

  // Initial fallback only: once any frame (SSE or broadcast) has arrived, the
  // stream is authoritative and late /api/sessions snapshots must not overwrite
  // it. Mirrors the old sseAuthoritativeRef behavior.
  const applyFallback = useCallback((ids: string[]) => {
    if (!authoritativeRef.current) setRunningSessionIds(new Set(ids));
  }, []);

  useEffect(() => {
    const tabId =
      typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : `t${Date.now()}-${Math.random().toString(36).slice(2)}`;

    const markAuth = () => { if (!authoritativeRef.current) authoritativeRef.current = true; };
    const apply = (ids: string[]) => { markAuth(); setRunningSessionIds(new Set(ids)); };

    // Fallback: no BroadcastChannel (old browsers) → degrade to per-tab SSE,
    // which is the original behavior. Still correct, just not shared.
    if (typeof BroadcastChannel === "undefined") {
      const es = new EventSource("/api/agent/running/events");
      es.onmessage = (e) => {
        try {
          const d = JSON.parse(e.data) as RunningMsg;
          if (d.type === "running") apply(d.runningSessionIds ?? []);
        } catch { /* ignore malformed */ }
      };
      return () => es.close();
    }

    const channel = new BroadcastChannel(CHANNEL);
    let es: EventSource | null = null;
    let isLeader = false;

    channel.onmessage = (e: MessageEvent) => {
      const msg = e.data;
      if (msg?.type === "running") apply(msg.runningSessionIds ?? []);
    };

    const connectSse = () => {
      if (es) return;
      const stream = new EventSource("/api/agent/running/events");
      stream.onmessage = (e) => {
        try {
          const d = JSON.parse(e.data) as RunningMsg;
          if (d.type === "running") {
            const ids = d.runningSessionIds ?? [];
            apply(ids);
            channel.postMessage({ type: "running", runningSessionIds: ids });
          }
        } catch { /* ignore malformed */ }
      };
      es = stream;
    };
    const disconnectSse = () => { es?.close(); es = null; };

    const readLease = (): { id: string; ts: number } | null => {
      try {
        const raw = localStorage.getItem(LS_LEASE);
        if (!raw) return null;
        const p = JSON.parse(raw);
        return typeof p?.id === "string" && typeof p?.ts === "number" ? p : null;
      } catch { return null; }
    };
    const writeLease = () => {
      try { localStorage.setItem(LS_LEASE, JSON.stringify({ id: tabId, ts: Date.now() })); } catch { /* ignore */ }
    };
    const clearLease = () => {
      try { if (readLease()?.id === tabId) localStorage.removeItem(LS_LEASE); } catch { /* ignore */ }
    };

    const tick = () => {
      const lease = readLease();
      const now = Date.now();
      if (lease && lease.id !== tabId && now - lease.ts < STALE_MS) {
        // Another live tab is leader — stand down.
        if (isLeader) { isLeader = false; disconnectSse(); }
        return;
      }
      if (!isLeader) { isLeader = true; connectSse(); }
      writeLease();
    };

    tick();
    const timer = setInterval(tick, HEARTBEAT_MS);
    window.addEventListener("beforeunload", clearLease);

    return () => {
      clearInterval(timer);
      window.removeEventListener("beforeunload", clearLease);
      disconnectSse();
      clearLease();
      channel.close();
    };
  }, []);

  return { runningSessionIds, applyFallback };
}

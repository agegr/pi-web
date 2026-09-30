"use client";

/**
 * Live refresh for the sub-agents settings panel. SettingsPanel keeps a visited
 * section mounted and hides it with `hidden`, so AgentsConfig cannot treat a
 * mount as "the user is looking at me": the panel reports its own visibility,
 * and this hook refetches on the hidden -> visible edge and then polls quietly
 * while the panel is on screen.
 */
import { useEffect, useRef } from "react";

/**
 * Quiet poll interval. The panel reads files that a terminal, another tab, or
 * the agent runtime can change while it stays open, and those lists are cheap to
 * re-read, so a slow poll beats a stale list.
 */
export const AGENTS_REFRESH_POLL_MS = 10_000;
/** Activation debounce: a section flip should land before its refetch does. */
export const AGENTS_REFRESH_ACTIVATION_MS = 250;

export interface AgentsRefreshGate {
  /** The agents section is the visible one in SettingsPanel. */
  active: boolean;
  /** The open draft differs from the profile it was loaded from. */
  draftDirty: boolean;
  /** A save / override / eject is in flight. */
  busy: boolean;
}

/**
 * A poll may only run when the panel could use the answer: it is the visible
 * section, the tab is visible, no draft would be disturbed by new lists, and no
 * write is in flight.
 */
export function shouldRefreshAgents(gate: AgentsRefreshGate, visibilityState: DocumentVisibilityState): boolean {
  return gate.active && !gate.draftDirty && !gate.busy && visibilityState === "visible";
}

/** The document surface the poll needs; injectable so tests can drive visibility. */
type PollDocument = Pick<Document, "visibilityState" | "addEventListener" | "removeEventListener">;

export interface AgentsRefreshController {
  /**
   * The panel's visibility. Polling runs only while active, and only a real
   * hidden -> visible transition refetches: the first call is the panel's mount,
   * whose own load already fetched.
   */
  sync(active: boolean): void;
  /** Stop polling and abort an in-flight refresh. */
  dispose(): void;
}

export function createAgentsRefreshController(options: {
  /** Read per poll, so the caller can keep the panel's state in a ref. */
  gate: () => AgentsRefreshGate;
  refresh: (signal: AbortSignal) => Promise<void>;
  pollDocument?: PollDocument;
  intervalMs?: number;
  activationMs?: number;
}): AgentsRefreshController {
  const { gate, refresh, intervalMs = AGENTS_REFRESH_POLL_MS, activationMs = AGENTS_REFRESH_ACTIVATION_MS } = options;
  // Resolved per call: the controller is created during render, which also runs
  // on the server, while only effects and timers ever poll.
  const target = (): PollDocument => options.pollDocument ?? document;
  let active = false;
  let everActivated = false;
  let interval: ReturnType<typeof setInterval> | null = null;
  let activation: ReturnType<typeof setTimeout> | null = null;
  let inFlight: AbortController | null = null;

  const run = (): void => {
    // One refresh at a time: a poll arriving while the previous answer is still
    // out would ask for the same state twice.
    if (inFlight) return;
    const controller = new AbortController();
    inFlight = controller;
    void refresh(controller.signal)
      // A quiet poll never surfaces a load failure; the next tick can retry.
      .catch(() => {})
      .finally(() => { if (inFlight === controller) inFlight = null; });
  };

  const poll = (): void => {
    if (!shouldRefreshAgents(gate(), target().visibilityState)) return;
    run();
  };

  const stopTimers = (): void => {
    if (interval) {
      clearInterval(interval);
      interval = null;
    }
    if (activation) {
      clearTimeout(activation);
      activation = null;
    }
    target().removeEventListener("visibilitychange", poll);
  };

  return {
    sync(next: boolean): void {
      if (next === active) return;
      active = next;
      stopTimers();
      if (!active) return;
      interval = setInterval(poll, intervalMs);
      // A background tab has no reason to poll; coming back to the tab is when
      // the panel is most likely stale, so it polls on that transition too.
      target().addEventListener("visibilitychange", poll);
      if (!everActivated) {
        everActivated = true;
        return;
      }
      activation = setTimeout(() => {
        activation = null;
        // One gate for both triggers: a hidden tab, a dirty draft, or an
        // in-flight write outranks the activation refetch, which the next poll
        // then picks up. The debounce is what makes a section flip land first.
        poll();
      }, activationMs);
    },
    dispose(): void {
      // Reset so both Strict Mode's dispose/re-run cycle and a remount start
      // from "just mounted" again: the panel's own load already refreshed it, and
      // a dead controller must not leave the panel unpolled.
      active = false;
      everActivated = false;
      stopTimers();
      inFlight?.abort();
      inFlight = null;
    },
  };
}

/**
 * Wiring only: AgentsConfig owns the load, the gate's state, and the draft. The
 * controller instance outlives effect re-runs, so Strict Mode's cleanup/re-run
 * cannot drop it.
 */
export function useAgentsRefresh({ active, draftDirty, busy, refresh }: {
  active: boolean;
  draftDirty: boolean;
  busy: boolean;
  refresh: (signal: AbortSignal) => Promise<void>;
}): void {
  const latest = useRef({ active, draftDirty, busy, refresh });
  latest.current = { active, draftDirty, busy, refresh };
  const controllerRef = useRef<AgentsRefreshController | null>(null);
  if (!controllerRef.current) {
    controllerRef.current = createAgentsRefreshController({
      gate: () => latest.current,
      refresh: (signal) => latest.current.refresh(signal),
    });
  }
  useEffect(() => {
    controllerRef.current?.sync(active);
  }, [active]);
  useEffect(() => () => {
    controllerRef.current?.dispose();
  }, []);
}

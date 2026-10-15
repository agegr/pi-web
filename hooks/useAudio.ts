"use client";

import { useState, useRef, useCallback, useEffect } from "react";

// How long the context keeps running after a chime, an unlock or a hold. The
// chime lasts 0.63 s; the rest leaves room for output latency.
export const AUDIO_IDLE_SUSPEND_MS = 1000;
// A chime whose resume() took longer than this is dropped: the browser held
// the context back (a page with no gesture yet, a locked phone), and a chime
// that plays once the user is back announces nothing.
export const AUDIO_STALE_CHIME_MS = 3000;

function playTone(ctx: AudioContext) {
  const now = ctx.currentTime;
  const freqs = [523.25, 659.25];
  freqs.forEach((freq, i) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = "sine";
    osc.frequency.value = freq;
    const t = now + i * 0.18;
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(0.18, t + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.45);
    osc.start(t);
    osc.stop(t + 0.45);
  });
}

export function useAudio() {
  const [enabled, setEnabled] = useState<boolean>(() => {
    if (typeof window === "undefined") return true;
    try {
      const stored = localStorage.getItem("pi-sound-enabled");
      return stored === null ? true : stored === "true";
    } catch {
      return true;
    }
  });

  const enabledRef = useRef(enabled);
  useEffect(() => { enabledRef.current = enabled; }, [enabled]);

  // Reuse a single AudioContext so it can be resumed if the browser
  // autoplay policy suspends it (contexts created outside user gestures
  // start in "suspended" state and produce no sound). It is suspended while
  // idle, never closed: a running context holds an audio output stream open
  // even when silent (an Android AudioMix wake lock, #1157), and WebKit lets
  // a context resume without a gesture only once it has started in one. Each
  // send's unlock resumes it briefly, so a gesture keeps re-establishing that,
  // and a hold keeps it running while the shown session's run is under way.
  const ctxRef = useRef<AudioContext | null>(null);
  const getCtx = useCallback((): AudioContext | null => {
    if (ctxRef.current && ctxRef.current.state !== "closed") return ctxRef.current;
    try {
      ctxRef.current = new AudioContext();
    } catch {
      return null;
    }
    return ctxRef.current;
  }, []);

  // resume() calls not settled yet; the idle suspend waits for them.
  const resumingRef = useRef(0);
  // Holds taken by holdAudio(); the idle suspend waits for them too.
  const holdsRef = useRef(0);
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const scheduleIdleSuspend = useCallback((ctx: AudioContext) => {
    clearTimeout(idleTimerRef.current);
    idleTimerRef.current = setTimeout(() => {
      if (resumingRef.current === 0 && holdsRef.current === 0) ctx.suspend().catch(() => {});
    }, AUDIO_IDLE_SUSPEND_MS);
  }, []);

  // Resume, run `onRunning`, and suspend AUDIO_IDLE_SUSPEND_MS after the last
  // run settled, unless a newer resume or a hold is still outstanding then.
  const runBriefly = useCallback((ctx: AudioContext, onRunning: () => void) => {
    resumingRef.current++;
    const settled = () => {
      resumingRef.current--;
      scheduleIdleSuspend(ctx);
    };
    ctx.resume().then(onRunning).catch(() => {}).then(settled);
  }, [scheduleIdleSuspend]);

  const unlockAudio = useCallback((force = false) => {
    if (!force && !enabledRef.current) return;
    const ctx = getCtx();
    if (!ctx || ctx.state === "running") return;
    runBriefly(ctx, () => {});
  }, [getCtx, runBriefly]);

  const toggle = useCallback(() => {
    const next = !enabledRef.current;
    if (next) unlockAudio(true);
    else ctxRef.current?.suspend().catch(() => {});
    enabledRef.current = next;
    try {
      localStorage.setItem("pi-sound-enabled", String(next));
    } catch {
      // Browser storage is best-effort.
    }
    setEnabled(next);
  }, [unlockAudio]);

  // Keep the context running until the returned release is called: while a
  // run is under way, so its chime still plays on a locked phone, where
  // Firefox for Android leaves the resume() of a suspended context pending.
  const holdAudio = useCallback(() => {
    holdsRef.current++;
    clearTimeout(idleTimerRef.current);
    if (enabledRef.current) {
      const ctx = getCtx();
      if (ctx && ctx.state !== "running") runBriefly(ctx, () => {});
    }
    let released = false;
    return () => {
      if (released) return;
      released = true;
      holdsRef.current--;
      if (ctxRef.current) scheduleIdleSuspend(ctxRef.current);
    };
  }, [getCtx, runBriefly, scheduleIdleSuspend]);

  const playDone = useCallback(() => {
    if (!enabledRef.current) return;
    const ctx = getCtx();
    if (!ctx) return;
    const requestedAt = Date.now();
    runBriefly(ctx, () => {
      // Sound was turned off while the context resumed.
      if (!enabledRef.current) return;
      if (Date.now() - requestedAt > AUDIO_STALE_CHIME_MS) return;
      try {
        playTone(ctx);
      } catch {
        // AudioContext not available
      }
    });
  }, [getCtx, runBriefly]);

  return { soundEnabled: enabled, onSoundToggle: toggle, playDoneSound: playDone, unlockAudio, holdAudio, soundEnabledRef: enabledRef };
}

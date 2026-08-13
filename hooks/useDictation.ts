"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  createWebSpeechDictationProvider,
  type DictationErrorCode,
  type DictationProvider,
  type DictationSession,
} from "@/lib/dictation";
import { createServerDictationProvider } from "@/lib/server-dictation";

export interface UseDictationResult {
  supported: boolean;
  isListening: boolean;
  interimText: string;
  error: DictationErrorCode | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
  providerId: string;
}

/**
 * Owns one dictation session and normalizes provider lifecycle for the UI.
 * Providers are injectable so browser Web Speech can later be replaced by a
 * MediaRecorder/server-STT implementation without changing ChatInput.
 */
export function useDictation(
  provider?: DictationProvider,
  onFinalText?: (text: string) => void,
): UseDictationResult {
  const defaultProviders = useMemo(() => [
    createWebSpeechDictationProvider(),
    createServerDictationProvider(),
  ], []);
  const activeProvider = provider ?? defaultProviders.find((candidate) => candidate.isSupported()) ?? defaultProviders[0];
  const [isListening, setIsListening] = useState(false);
  const [interimText, setInterimText] = useState("");
  const [error, setError] = useState<DictationErrorCode | null>(null);
  const sessionRef = useRef<DictationSession | null>(null);
  const onFinalTextRef = useRef(onFinalText);
  onFinalTextRef.current = onFinalText;

  const stopSession = useCallback((abort: boolean) => {
    const session = sessionRef.current;
    sessionRef.current = null;
    if (!session) return;
    try {
      if (abort) session.abort();
      else session.stop();
    } catch {
      // Providers may race a browser/device teardown; state still needs to settle.
    }
    setIsListening(false);
    setInterimText("");
  }, []);

  const start = useCallback(() => {
    if (sessionRef.current || !activeProvider.isSupported()) return;
    setError(null);
    setInterimText("");
    setIsListening(true);

    try {
      let session: DictationSession | null = null;
      let endedDuringStart = false;
      const startedSession = activeProvider.start(
        {
          onFinalText: (text) => onFinalTextRef.current?.(text),
          onInterimText: setInterimText,
          onError: (nextError) => {
            if (nextError !== "aborted") setError(nextError);
          },
          onEnd: () => {
            if (!session) {
              endedDuringStart = true;
              return;
            }
            if (sessionRef.current !== session) return;
            sessionRef.current = null;
            setIsListening(false);
            setInterimText("");
          },
        },
        { interimResults: true },
      );
      session = startedSession;
      if (endedDuringStart) {
        setIsListening(false);
        setInterimText("");
      } else {
        sessionRef.current = startedSession;
      }
    } catch {
      sessionRef.current = null;
      setIsListening(false);
      setInterimText("");
      setError("unknown");
    }
  }, [activeProvider]);

  const stop = useCallback(() => stopSession(false), [stopSession]);
  const abort = useCallback(() => stopSession(true), [stopSession]);

  useEffect(() => () => {
    sessionRef.current?.abort();
    sessionRef.current = null;
  }, []);

  return {
    supported: activeProvider.isSupported(),
    isListening,
    interimText,
    error,
    start,
    stop,
    abort,
    providerId: activeProvider.id,
  };
}

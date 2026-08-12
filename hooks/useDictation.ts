"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  createWebSpeechDictationProvider,
  type DictationErrorCode,
  type DictationProvider,
  type DictationSession,
} from "@/lib/dictation";

export interface UseDictationResult {
  supported: boolean;
  isListening: boolean;
  interimText: string;
  error: DictationErrorCode | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
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
  const defaultProvider = useMemo(() => createWebSpeechDictationProvider(), []);
  const activeProvider = provider ?? defaultProvider;
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
    if (abort) session.abort();
    else session.stop();
    setIsListening(false);
    setInterimText("");
  }, []);

  const start = useCallback(() => {
    if (sessionRef.current || !activeProvider.isSupported()) return;
    setError(null);
    setInterimText("");
    setIsListening(true);

    try {
      sessionRef.current = activeProvider.start(
        {
          onFinalText: (text) => onFinalTextRef.current?.(text),
          onInterimText: setInterimText,
          onError: (nextError) => {
            if (nextError !== "aborted") setError(nextError);
          },
          onEnd: () => {
            sessionRef.current = null;
            setIsListening(false);
            setInterimText("");
          },
        },
        { interimResults: true },
      );
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
  };
}

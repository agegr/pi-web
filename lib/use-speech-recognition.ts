"use client";

import { useState, useRef, useCallback, useEffect } from "react";

// Web Speech API types are not in default TS lib
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SpeechRecognitionInstance = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SpeechRecognitionEvent = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SpeechRecognitionErrorEvent = any;

declare global {
  interface Window {
    SpeechRecognition?: new () => SpeechRecognitionInstance;
    webkitSpeechRecognition?: new () => SpeechRecognitionInstance;
  }
}

/** Map common browser error codes to user-friendly Chinese messages. */
function friendlyError(err: string): string {
  const map: Record<string, string> = {
    "not-allowed": "麦克风权限被拒绝，请在浏览器设置中允许麦克风访问",
    "service-not-allowed": "当前页面不支持语音识别（需 HTTPS 或 localhost）",
    "audio-capture": "未检测到麦克风设备",
    "network": "语音识别网络请求失败",
    "language-not-supported": "不支持中文语音识别",
    "aborted": "",
    "no-speech": "",
  };
  return map[err] || `语音识别失败: ${err}`;
}

interface SpeechRecognitionResult {
  isListening: boolean;
  isSupported: boolean;
  error: string | null;
  /** Start listening. Resets any previous error. */
  startListening: () => void;
  /** Stop listening gracefully. */
  stopListening: () => void;
  /** Interim (partial) transcript — shows real-time text while speaking. */
  interimText: string;
}

/**
 * useSpeechRecognition — wraps the browser Web Speech API.
 *
 * @param onResult  Called with each final (committed) transcript fragment.
 * @param lang      BCP 47 language tag (default "zh-CN" works well for Chinese + English).
 */
export function useSpeechRecognition(
  onResult: (text: string) => void,
  lang = "zh-CN"
): SpeechRecognitionResult {
  const [isListening, setIsListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [interimText, setInterimText] = useState("");
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  const errorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isSupported =
    typeof window !== "undefined" &&
    (!!window.SpeechRecognition || !!window.webkitSpeechRecognition);

  // Auto-clear error after 6s
  const setErrorAutoClear = useCallback((msg: string | null) => {
    setError(msg);
    if (errorTimerRef.current) clearTimeout(errorTimerRef.current);
    if (msg) {
      errorTimerRef.current = setTimeout(() => setError(null), 6000);
    }
  }, []);

  const startListening = useCallback(() => {
    if (!isSupported) {
      setErrorAutoClear("当前浏览器不支持语音识别");
      return;
    }

    // Stop any existing instance first
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch {
        // ignore
      }
      recognitionRef.current = null;
    }

    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) {
      setErrorAutoClear("当前浏览器不支持语音识别");
      return;
    }

    let recognition: SpeechRecognitionInstance;
    try {
      recognition = new SR();
    } catch (e) {
      setErrorAutoClear(`无法创建语音识别实例: ${e instanceof Error ? e.message : String(e)}`);
      return;
    }

    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = lang;

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      let finalText = "";
      let interimText = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        const transcript = result[0].transcript;
        if (result.isFinal) {
          finalText += transcript;
        } else {
          interimText += transcript;
        }
      }
      if (finalText) {
        onResult(finalText);
      }
      setInterimText(interimText);
    };

    recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
      const msg = friendlyError(event.error);
      if (!msg) return; // no-speech / aborted — silently ignore
      setErrorAutoClear(msg);
      setIsListening(false);
    };

    recognition.onend = () => {
      setIsListening(false);
      setInterimText("");
    };

    recognitionRef.current = recognition;
    try {
      recognition.start();
    } catch (e) {
      setErrorAutoClear(`语音识别启动失败: ${e instanceof Error ? e.message : String(e)}`);
      setIsListening(false);
      recognitionRef.current = null;
      return;
    }
    setIsListening(true);
    setError(null);
    if (errorTimerRef.current) clearTimeout(errorTimerRef.current);
    setInterimText("");
  }, [isSupported, lang, onResult, setErrorAutoClear]);

  const stopListening = useCallback(() => {
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch {
        // already stopped
      }
      recognitionRef.current = null;
    }
    setIsListening(false);
    setInterimText("");
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (recognitionRef.current) {
        try {
          recognitionRef.current.stop();
        } catch {
          // ignore
        }
      }
      if (errorTimerRef.current) clearTimeout(errorTimerRef.current);
    };
  }, []);

  return { isListening, isSupported, error, startListening, stopListening, interimText };
}

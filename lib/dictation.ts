export type DictationErrorCode =
  | "aborted"
  | "audio-capture"
  | "network"
  | "no-speech"
  | "not-allowed"
  | "service-not-allowed"
  | "unknown";

export interface DictationOptions {
  language?: string;
  continuous?: boolean;
  interimResults?: boolean;
}

export interface DictationCallbacks {
  onFinalText: (text: string) => void;
  onInterimText: (text: string) => void;
  onError: (error: DictationErrorCode) => void;
  onEnd: () => void;
}

export interface DictationSession {
  stop: () => void;
  abort: () => void;
}

/**
 * Provider boundary for browser or server-backed speech-to-text implementations.
 * A provider owns capture/transcription mechanics; the composer only consumes
 * normalized text and lifecycle events.
 */
export interface DictationProvider {
  readonly id: string;
  isSupported: () => boolean;
  start: (callbacks: DictationCallbacks, options?: DictationOptions) => DictationSession;
}

interface WebSpeechRecognitionResult {
  readonly isFinal: boolean;
  readonly length?: number;
  readonly [index: number]: { readonly transcript: string } | undefined;
}

interface WebSpeechRecognitionEvent {
  readonly resultIndex?: number;
  readonly results: {
    readonly length: number;
    readonly [index: number]: WebSpeechRecognitionResult | undefined;
  };
}

interface WebSpeechRecognitionErrorEvent {
  readonly error?: string;
}

interface WebSpeechRecognition {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  maxAlternatives: number;
  onresult: ((event: WebSpeechRecognitionEvent) => void) | null;
  onerror: ((event: WebSpeechRecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
}

type WebSpeechRecognitionConstructor = new () => WebSpeechRecognition;

function getWebSpeechRecognitionConstructor(): WebSpeechRecognitionConstructor | null {
  if (typeof window === "undefined") return null;
  const browserWindow = window as typeof window & {
    SpeechRecognition?: WebSpeechRecognitionConstructor;
    webkitSpeechRecognition?: WebSpeechRecognitionConstructor;
  };
  return browserWindow.SpeechRecognition ?? browserWindow.webkitSpeechRecognition ?? null;
}

function normalizeError(error: string | undefined): DictationErrorCode {
  switch (error) {
    case "aborted":
    case "audio-capture":
    case "network":
    case "no-speech":
    case "not-allowed":
    case "service-not-allowed":
      return error;
    default:
      return "unknown";
  }
}

/**
 * Uses the browser's native Web Speech API. Keeping this behind DictationProvider
 * means a future MediaRecorder/server-STT provider can be added without coupling
 * ChatInput to a particular transcription service.
 */
export function createWebSpeechDictationProvider(): DictationProvider {
  return {
    id: "web-speech",
    isSupported: () => getWebSpeechRecognitionConstructor() !== null,
    start(callbacks, options = {}) {
      const Recognition = getWebSpeechRecognitionConstructor();
      if (!Recognition) throw new Error("Web Speech API is not supported");

      const recognition = new Recognition();
      let ended = false;
      recognition.continuous = options.continuous ?? false;
      recognition.interimResults = options.interimResults ?? true;
      recognition.lang = options.language ?? (typeof navigator !== "undefined" ? navigator.language : "en-US");
      recognition.maxAlternatives = 1;

      recognition.onresult = (event) => {
        const startIndex = event.resultIndex ?? 0;
        let finalText = "";
        let interimText = "";
        for (let index = startIndex; index < event.results.length; index += 1) {
          const result = event.results[index];
          const transcript = result?.[0]?.transcript ?? "";
          if (result?.isFinal) finalText += transcript;
          else interimText += transcript;
        }
        if (finalText.trim()) callbacks.onFinalText(finalText.trim());
        callbacks.onInterimText(interimText.trim());
      };

      recognition.onerror = (event) => {
        const error = normalizeError(event.error);
        if (error !== "aborted") callbacks.onError(error);
      };

      recognition.onend = () => {
        if (ended) {
          callbacks.onEnd();
          return;
        }
        ended = true;
        callbacks.onInterimText("");
        callbacks.onEnd();
      };

      recognition.start();

      const finish = (method: "stop" | "abort") => {
        if (ended) return;
        ended = true;
        try {
          recognition[method]();
        } catch {
          // The browser can throw when a recognition session has already ended.
        }
      };

      return {
        stop: () => finish("stop"),
        abort: () => finish("abort"),
      };
    },
  };
}

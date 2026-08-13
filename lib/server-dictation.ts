import type {
  DictationErrorCode,
  DictationOptions,
  DictationProvider,
  DictationSession,
} from "@/lib/dictation";

export interface ServerDictationOptions extends DictationOptions {
  endpoint?: string;
  maxAudioBytes?: number;
}

interface ServerTranscriptionResponse {
  transcript?: unknown;
  error?: unknown;
}

const DEFAULT_ENDPOINT = "/api/dictation";
const DEFAULT_MAX_AUDIO_BYTES = 20 * 1024 * 1024;

function errorCodeFromStatus(status: number): DictationErrorCode {
  if (status === 413) return "audio-capture";
  if (status === 401 || status === 403) return "not-allowed";
  if (status >= 500) return "service-not-allowed";
  return "network";
}

function errorCodeFromException(error: unknown): DictationErrorCode {
  if (error instanceof DOMException && error.name === "NotAllowedError") return "not-allowed";
  return "network";
}

function preferredMimeType(): string {
  if (typeof MediaRecorder === "undefined") return "";
  return [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/ogg;codecs=opus",
    "audio/ogg",
  ].find((type) => MediaRecorder.isTypeSupported?.(type)) ?? "";
}

function extensionForMimeType(type: string): string {
  return type.includes("ogg") ? "ogg" : "webm";
}

/**
 * Captures one browser audio segment and submits it to a same-origin STT API.
 * The endpoint receives a multipart `file` field and returns `{ transcript }`.
 */
export function createServerDictationProvider(
  defaults: ServerDictationOptions = {},
): DictationProvider {
  return {
    id: "server",
    isSupported: () => (
      typeof navigator !== "undefined"
      && Boolean(navigator.mediaDevices?.getUserMedia)
      && typeof MediaRecorder !== "undefined"
    ),
    start(callbacks, options = {}) {
      if (!this.isSupported()) throw new Error("Audio recording is not supported");

      const serverOptions = options as ServerDictationOptions;
      const endpoint = serverOptions.endpoint ?? defaults.endpoint ?? DEFAULT_ENDPOINT;
      const maxAudioBytes = defaults.maxAudioBytes ?? DEFAULT_MAX_AUDIO_BYTES;
      const controller = new AbortController();
      let stream: MediaStream | null = null;
      let recorder: MediaRecorder | null = null;
      let chunks: Blob[] = [];
      let ended = false;
      let stopRequested = false;

      const finish = () => {
        if (ended) return;
        ended = true;
        recorder = null;
        stream?.getTracks().forEach((track) => track.stop());
        stream = null;
        callbacks.onInterimText("");
        callbacks.onEnd();
      };

      const submit = async (blob: Blob) => {
        if (!blob.size || controller.signal.aborted) return;
        if (blob.size > maxAudioBytes) {
          callbacks.onError("audio-capture");
          return;
        }

        const form = new FormData();
        form.append(
          "file",
          new File([blob], `dictation.${extensionForMimeType(blob.type)}`, { type: blob.type || "audio/webm" }),
        );
        try {
          const response = await fetch(endpoint, {
            method: "POST",
            body: form,
            signal: controller.signal,
          });
          const data = await response.json() as ServerTranscriptionResponse;
          if (!response.ok) {
            callbacks.onError(errorCodeFromStatus(response.status));
            return;
          }
          if (typeof data.transcript === "string" && data.transcript.trim()) {
            callbacks.onFinalText(data.transcript.trim());
          }
        } catch (error) {
          if (!controller.signal.aborted) callbacks.onError(errorCodeFromException(error));
        }
      };

      const startRecorder = (captureStream: MediaStream) => {
        stream = captureStream;
        const type = preferredMimeType();
        recorder = new MediaRecorder(captureStream, type ? { mimeType: type } : undefined);
        chunks = [];
        recorder.ondataavailable = (event) => {
          if (event.data.size) chunks.push(event.data);
        };
        recorder.onerror = () => {
          callbacks.onError("audio-capture");
          finish();
        };
        recorder.onstop = () => {
          const blob = new Blob(chunks, { type: recorder?.mimeType || type || "audio/webm" });
          void submit(blob).finally(finish);
        };
        recorder.start();
      };

      void navigator.mediaDevices.getUserMedia({ audio: true }).then((captureStream) => {
        if (ended || stopRequested) {
          captureStream.getTracks().forEach((track) => track.stop());
          return;
        }
        try {
          startRecorder(captureStream);
        } catch {
          captureStream.getTracks().forEach((track) => track.stop());
          callbacks.onError("audio-capture");
          finish();
        }
      }).catch((error: unknown) => {
        if (ended) return;
        callbacks.onError(errorCodeFromException(error));
        finish();
      });

      return {
        stop: () => {
          stopRequested = true;
          if (recorder && recorder.state !== "inactive") recorder.stop();
          else if (!recorder) finish();
        },
        abort: () => {
          stopRequested = true;
          controller.abort();
          if (recorder && recorder.state !== "inactive") recorder.stop();
          else finish();
        },
      } satisfies DictationSession;
    },
  };
}

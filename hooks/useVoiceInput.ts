"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { downsample, encodeWavPcm16, type VoiceLang } from "@/lib/wav-pcm";

export type VoicePhase = "idle" | "preparing" | "recording" | "transcribing" | "error";

type VoiceStatusResponse = {
  ready?: boolean;
  downloading?: boolean;
  progress?: number;
  error?: string | null;
};

const LANG_KEY = "pi-voice-lang";
const TARGET_RATE = 16000;

export function useVoiceInput(onTranscript: (text: string) => void) {
  const [phase, setPhase] = useState<VoicePhase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [lang, setLang] = useState<VoiceLang>("auto");
  const phaseRef = useRef<VoicePhase>("idle");
  const chunksRef = useRef<Float32Array[]>([]);
  const inputRateRef = useRef(TARGET_RATE);
  const streamRef = useRef<MediaStream | null>(null);
  const contextRef = useRef<AudioContext | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(LANG_KEY);
      if (stored === "auto" || stored === "zh" || stored === "en") setLang(stored);
    } catch {
      // Ignore storage failures.
    }
  }, []);

  const setPhaseSafe = useCallback((next: VoicePhase) => {
    phaseRef.current = next;
    setPhase(next);
  }, []);

  const teardownMic = useCallback(() => {
    try { processorRef.current?.disconnect(); } catch { /* already closed */ }
    try { sourceRef.current?.disconnect(); } catch { /* already closed */ }
    processorRef.current = null;
    sourceRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    void contextRef.current?.close();
    contextRef.current = null;
  }, []);

  const cycleLang = useCallback(() => {
    setLang((prev) => {
      const next: VoiceLang = prev === "auto" ? "zh" : prev === "zh" ? "en" : "auto";
      try { window.localStorage.setItem(LANG_KEY, next); } catch { /* ignore */ }
      return next;
    });
  }, []);

  const ensureEngine = useCallback(async () => {
    const status = await fetch("/api/voice/status").then(async (r) => {
      const data = await r.json() as VoiceStatusResponse & { error?: string };
      if (!r.ok) throw new Error(data.error ?? `HTTP ${r.status}`);
      return data;
    });
    if (status.ready) return;
    setPhaseSafe("preparing");
    const prepare = fetch("/api/voice/prepare", { method: "POST" });
    for (let i = 0; i < 300; i++) {
      const next = await fetch("/api/voice/status").then((r) => r.json()) as VoiceStatusResponse;
      setProgress(next.progress ?? 0);
      if (next.ready) break;
      if (next.error) throw new Error(next.error);
      await new Promise((resolve) => setTimeout(resolve, 400));
    }
    const prepared = await prepare.then(async (r) => {
      const data = await r.json() as VoiceStatusResponse & { error?: string };
      if (!r.ok) throw new Error(data.error ?? `HTTP ${r.status}`);
      return data;
    });
    if (!prepared.ready) throw new Error(prepared.error ?? "Voice model is not ready");
  }, [setPhaseSafe]);

  const stopRecording = useCallback(async () => {
    if (phaseRef.current !== "recording") {
      teardownMic();
      return;
    }
    teardownMic();
    const pieces = chunksRef.current;
    chunksRef.current = [];
    const total = pieces.reduce((sum, chunk) => sum + chunk.length, 0);
    const merged = new Float32Array(total);
    let offset = 0;
    for (const chunk of pieces) {
      merged.set(chunk, offset);
      offset += chunk.length;
    }
    if (total < inputRateRef.current * 0.25) {
      setPhaseSafe("idle");
      return;
    }
    setPhaseSafe("transcribing");
    try {
      const samples = downsample(merged, inputRateRef.current, TARGET_RATE);
      const wav = encodeWavPcm16(samples, TARGET_RATE);
      const payload = wav.buffer.slice(wav.byteOffset, wav.byteOffset + wav.byteLength) as ArrayBuffer;
      const response = await fetch(`/api/voice/transcribe?lang=${encodeURIComponent(lang)}`, {
        method: "POST",
        headers: { "content-type": "audio/wav" },
        body: payload,
      });
      const data = await response.json() as { text?: string; error?: string };
      if (!response.ok) throw new Error(data.error ?? `HTTP ${response.status}`);
      if (data.text) onTranscript(data.text);
      setError(null);
      setPhaseSafe("idle");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPhaseSafe("error");
    }
  }, [lang, onTranscript, setPhaseSafe, teardownMic]);

  const startRecording = useCallback(async () => {
    setError(null);
    try {
      await ensureEngine();
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
      });
      const context = new AudioContext();
      const source = context.createMediaStreamSource(stream);
      if (context.state === "suspended") await context.resume();
      const processor = context.createScriptProcessor(4096, 1, 1);
      const mute = context.createGain();
      mute.gain.value = 0;
      chunksRef.current = [];
      inputRateRef.current = context.sampleRate || TARGET_RATE;
      processor.onaudioprocess = (event) => {
        chunksRef.current.push(new Float32Array(event.inputBuffer.getChannelData(0)));
      };
      source.connect(processor);
      processor.connect(mute);
      mute.connect(context.destination);
      streamRef.current = stream;
      contextRef.current = context;
      sourceRef.current = source;
      processorRef.current = processor;
      setPhaseSafe("recording");
    } catch (err) {
      teardownMic();
      setError(err instanceof Error ? err.message : String(err));
      setPhaseSafe("error");
    }
  }, [ensureEngine, setPhaseSafe, teardownMic]);

  const toggle = useCallback(() => {
    if (phaseRef.current === "recording") {
      void stopRecording();
      return;
    }
    if (phaseRef.current === "preparing" || phaseRef.current === "transcribing") return;
    void startRecording();
  }, [startRecording, stopRecording]);

  useEffect(() => () => { teardownMic(); }, [teardownMic]);

  return { phase, error, progress, lang, cycleLang, toggle };
}

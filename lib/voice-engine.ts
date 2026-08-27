import { createWriteStream } from "node:fs";
import { mkdir, rename, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { cleanTranscript, decodeWavPcm, downsample, type VoiceLang } from "./wav-pcm";

export const VOICE_ENGINE_ID = "sensevoice";
export const VOICE_MODEL_ID = "sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2025-09-09";

const HF_BASE = `https://huggingface.co/csukuangfj/${VOICE_MODEL_ID}/resolve/main`;
const HF_MIRROR = `https://hf-mirror.com/csukuangfj/${VOICE_MODEL_ID}/resolve/main`;

const MODEL_FILES = [
  { name: "model.int8.onnx", urls: [`${HF_BASE}/model.int8.onnx?download=true`, `${HF_MIRROR}/model.int8.onnx?download=true`] },
  { name: "tokens.txt", urls: [`${HF_BASE}/tokens.txt?download=true`, `${HF_MIRROR}/tokens.txt?download=true`] },
] as const;

type VoiceStatus = {
  engine: typeof VOICE_ENGINE_ID;
  model: string;
  ready: boolean;
  downloading: boolean;
  progress: number;
  error: string | null;
};

type SherpaModule = {
  OfflineRecognizer: new (config: unknown) => {
    createStream: () => {
      acceptWaveform: (wave: { sampleRate: number; samples: Float32Array }) => void;
    };
    decode: (stream: unknown) => void;
    getResult: (stream: unknown) => { text?: string };
  };
};

type VoiceGlobals = typeof globalThis & {
  __piVoiceStatus?: VoiceStatus;
  __piVoiceDownload?: Promise<void>;
  __piVoiceRecognizer?: InstanceType<SherpaModule["OfflineRecognizer"]>;
};

function globals(): VoiceGlobals {
  return globalThis as VoiceGlobals;
}

function modelDir(): string {
  return join(homedir(), ".pi", "voice", VOICE_MODEL_ID);
}

function modelPath(): string {
  return join(modelDir(), "model.int8.onnx");
}

function tokensPath(): string {
  return join(modelDir(), "tokens.txt");
}

function currentStatus(): VoiceStatus {
  const g = globals();
  if (!g.__piVoiceStatus) {
    g.__piVoiceStatus = {
      engine: VOICE_ENGINE_ID,
      model: VOICE_MODEL_ID,
      ready: false,
      downloading: false,
      progress: 0,
      error: null,
    };
  }
  return g.__piVoiceStatus;
}

export async function getVoiceStatus(): Promise<VoiceStatus> {
  const status = currentStatus();
  if (status.ready) return { ...status };
  try {
    const model = await stat(modelPath());
    const tokens = await stat(tokensPath());
    if (model.isFile() && model.size > 1_000_000 && tokens.isFile() && tokens.size > 100) {
      status.ready = true;
      status.downloading = false;
      status.progress = 1;
      status.error = null;
    }
  } catch {
    // Files are not on disk yet.
  }
  return { ...status };
}

export async function ensureVoiceModel(): Promise<VoiceStatus> {
  const already = await getVoiceStatus();
  if (already.ready) return already;
  const g = globals();
  if (!g.__piVoiceDownload) {
    g.__piVoiceDownload = downloadModelFiles().finally(() => {
      g.__piVoiceDownload = undefined;
    });
  }
  try {
    await g.__piVoiceDownload;
  } catch (error) {
    const status = currentStatus();
    status.downloading = false;
    status.error = error instanceof Error ? error.message : String(error);
    throw error;
  }
  return getVoiceStatus();
}

async function downloadModelFiles(): Promise<void> {
  const status = currentStatus();
  status.downloading = true;
  status.error = null;
  status.progress = 0;
  await mkdir(modelDir(), { recursive: true });
  const sizes: number[] = [];
  for (const file of MODEL_FILES) {
    const part = join(modelDir(), `${file.name}.part`);
    const dest = join(modelDir(), file.name);
    try {
      const existing = await stat(dest);
      if (existing.size > 0 && (file.name !== "model.int8.onnx" || existing.size > 1_000_000)) {
        sizes.push(existing.size);
        continue;
      }
    } catch {
      // Need to download.
    }
    let lastError: unknown;
    for (const url of file.urls) {
      try {
        await downloadToFile(url, part, (loaded, total) => {
          const previous = sizes.reduce((sum, n) => sum + n, 0);
          const known = previous + (total || loaded);
          status.progress = known > 0 ? Math.min(0.99, (previous + loaded) / Math.max(known, previous + loaded)) : status.progress;
        });
        await rename(part, dest);
        sizes.push((await stat(dest)).size);
        lastError = undefined;
        break;
      } catch (error) {
        lastError = error;
      }
    }
    if (lastError) throw lastError;
  }
  status.ready = true;
  status.downloading = false;
  status.progress = 1;
}

async function downloadToFile(
  url: string,
  dest: string,
  onProgress: (loaded: number, total: number) => void,
): Promise<void> {
  const response = await fetch(url, {
    headers: { "user-agent": "pi-web-voice/0.8.11" },
    redirect: "follow",
  });
  if (!response.ok || !response.body) {
    throw new Error(`Download failed ${response.status}: ${url}`);
  }
  const total = Number(response.headers.get("content-length") ?? "0");
  let loaded = 0;
  const reader = response.body.getReader();
  const nodeStream = Readable.from((async function* () {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        loaded += value.byteLength;
        onProgress(loaded, total);
        yield value;
      }
    }
  })());
  await pipeline(nodeStream, createWriteStream(dest));
}

function loadSherpa(): SherpaModule {
  const requireFromApp = createRequire(join(process.cwd(), "package.json"));
  return requireFromApp("sherpa-onnx-node") as SherpaModule;
}

function getRecognizer(): InstanceType<SherpaModule["OfflineRecognizer"]> {
  const g = globals();
  if (g.__piVoiceRecognizer) return g.__piVoiceRecognizer;
  const sherpa = loadSherpa();
  g.__piVoiceRecognizer = new sherpa.OfflineRecognizer({
    featConfig: { sampleRate: 16000, featureDim: 80 },
    modelConfig: {
      senseVoice: {
        model: modelPath(),
        language: "auto",
        useInverseTextNormalization: 1,
      },
      tokens: tokensPath(),
      numThreads: 2,
      provider: "cpu",
      debug: 0,
    },
  });
  return g.__piVoiceRecognizer;
}

export async function transcribeWav(bytes: Uint8Array, language: VoiceLang = "auto"): Promise<string> {
  await ensureVoiceModel();
  const decoded = decodeWavPcm(bytes);
  const samples = downsample(decoded.samples, decoded.sampleRate, 16000);
  if (samples.length < 1600) {
    throw new Error("Recording is too short");
  }
  const recognizer = getRecognizer();
  const stream = recognizer.createStream();
  stream.acceptWaveform({ sampleRate: 16000, samples });
  if (language !== "auto") {
    try {
      (stream as { setLanguage?: (lang: string) => void }).setLanguage?.(language);
    } catch {
      // Language hint is optional; SenseVoice still auto-detects.
    }
  }
  recognizer.decode(stream);
  const result = recognizer.getResult(stream);
  return cleanTranscript(result?.text ?? "");
}

export type VoiceLang = "auto" | "zh" | "en";

const SENSEVOICE_TAGS = /<\|[^|]*\|>/g;

export function cleanTranscript(text: string): string {
  return text.replace(SENSEVOICE_TAGS, " ").replace(/\s+/g, " ").trim();
}

export function joinTranscript(existing: string, chunk: string): string {
  const left = existing.replace(/\s+$/u, "");
  const right = chunk.replace(/^\s+/u, "").trim();
  if (!left) return right;
  if (!right) return left;
  const needSpace = /[A-Za-z0-9]$/.test(left) && /^[A-Za-z0-9]/.test(right);
  return needSpace ? `${left} ${right}` : `${left}${right}`;
}

export function downsample(input: Float32Array, inRate: number, outRate: number): Float32Array {
  if (inRate === outRate) return input;
  if (inRate <= 0 || outRate <= 0 || input.length === 0) return input;
  const ratio = inRate / outRate;
  const outLength = Math.max(1, Math.round(input.length / ratio));
  const output = new Float32Array(outLength);
  for (let i = 0; i < outLength; i++) {
    const src = i * ratio;
    const i0 = Math.floor(src);
    const i1 = Math.min(i0 + 1, input.length - 1);
    const frac = src - i0;
    output[i] = input[i0] * (1 - frac) + input[i1] * frac;
  }
  return output;
}

export function encodeWavPcm16(samples: Float32Array, sampleRate: number): Uint8Array {
  const dataSize = samples.length * 2;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);
  writeAscii(view, 0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeAscii(view, 8, "WAVE");
  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeAscii(view, 36, "data");
  view.setUint32(40, dataSize, true);
  let offset = 44;
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i] ?? 0));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    offset += 2;
  }
  return new Uint8Array(buffer);
}

export function decodeWavPcm(bytes: Uint8Array): { sampleRate: number; samples: Float32Array } {
  if (bytes.length < 44) throw new Error("Audio is too short");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (readAscii(view, 0, 4) !== "RIFF" || readAscii(view, 8, 4) !== "WAVE") {
    throw new Error("Only WAV audio is supported");
  }
  let offset = 12;
  let sampleRate = 16000;
  let channels = 1;
  let bits = 16;
  let format = 1;
  let dataOffset = -1;
  let dataSize = 0;
  while (offset + 8 <= bytes.length) {
    const id = readAscii(view, offset, 4);
    const size = view.getUint32(offset + 4, true);
    const start = offset + 8;
    if (id === "fmt ") {
      format = view.getUint16(start, true);
      channels = view.getUint16(start + 2, true);
      sampleRate = view.getUint32(start + 4, true);
      bits = view.getUint16(start + 14, true);
    } else if (id === "data") {
      dataOffset = start;
      dataSize = size;
      break;
    }
    offset = start + size + (size % 2);
  }
  if (dataOffset < 0) throw new Error("WAV data chunk missing");
  if (channels < 1) throw new Error("WAV channel count is invalid");
  const frameSize = channels * (bits / 8);
  const frames = Math.floor(Math.max(0, Math.min(dataSize, bytes.length - dataOffset)) / frameSize);
  const samples = new Float32Array(frames);
  let cursor = dataOffset;
  for (let i = 0; i < frames; i++) {
    let mixed = 0;
    for (let c = 0; c < channels; c++) {
      if (format === 3 && bits === 32) {
        mixed += view.getFloat32(cursor, true);
        cursor += 4;
      } else if (bits === 16) {
        mixed += view.getInt16(cursor, true) / 0x8000;
        cursor += 2;
      } else if (bits === 8) {
        mixed += (view.getUint8(cursor) - 128) / 128;
        cursor += 1;
      } else {
        throw new Error(`Unsupported WAV format: format=${format} bits=${bits}`);
      }
    }
    samples[i] = mixed / channels;
  }
  return { sampleRate, samples };
}

function writeAscii(view: DataView, offset: number, text: string): void {
  for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
}

function readAscii(view: DataView, offset: number, length: number): string {
  let out = "";
  for (let i = 0; i < length; i++) out += String.fromCharCode(view.getUint8(offset + i));
  return out;
}

import assert from "node:assert/strict";
import test from "node:test";
import { cleanTranscript, decodeWavPcm, downsample, encodeWavPcm16, joinTranscript } from "./wav-pcm.ts";

test("cleanTranscript strips SenseVoice control tags", () => {
  assert.equal(
    cleanTranscript("<|zh|><|NEUTRAL|><|Speech|><|withitn|>打开两个对话。"),
    "打开两个对话。",
  );
});

test("joinTranscript spaces English and concatenates Chinese", () => {
  assert.equal(joinTranscript("hello", "world"), "hello world");
  assert.equal(joinTranscript("打开", "两个对话"), "打开两个对话");
  assert.equal(joinTranscript("用 Pi ", "web"), "用 Pi web");
});

test("wav round-trip keeps 16 kHz mono pcm", () => {
  const samples = new Float32Array([0, 0.5, -0.5, 0.25]);
  const encoded = encodeWavPcm16(samples, 16000);
  const decoded = decodeWavPcm(encoded);
  assert.equal(decoded.sampleRate, 16000);
  assert.equal(decoded.samples.length, 4);
  assert.ok(Math.abs((decoded.samples[1] ?? 0) - 0.5) < 0.02);
});

test("downsample halves sample rate", () => {
  const input = new Float32Array(8).map((_, i) => i);
  const out = downsample(input, 16000, 8000);
  assert.equal(out.length, 4);
});

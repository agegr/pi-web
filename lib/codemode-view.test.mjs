import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const {
  codemodeCalls,
  codemodeScript,
  codemodeScriptPreview,
  codemodeTotalCost,
  formatCodemodeCost,
  formatCodemodeDuration,
  getCodemodeProgress,
  stripCodemodeHeader,
} = await jiti.import("./codemode-view.ts");

test("reads the script only from a string code argument", () => {
  assert.equal(codemodeScript({ code: "return 1" }), "return 1");
  assert.equal(codemodeScript({ code: "" }), "");
  assert.equal(codemodeScript({ code: 1 }), null);
  assert.equal(codemodeScript(undefined), null);
  assert.equal(codemodeScript(["return 1"]), null);
});

test("reads nested calls defensively and counts the ones a snapshot left out", () => {
  assert.deepEqual(codemodeCalls(undefined), { calls: [], omitted: 0 });
  assert.deepEqual(codemodeCalls({ calls: "x" }), { calls: [], omitted: 0 });
  assert.deepEqual(codemodeCalls({
    calls: [
      { id: "c/1", name: "read", args: "{\"path\":\"a\"}", status: "ok", durationMs: 12 },
      { id: "c/2", name: "bash", args: "{}", status: "error", error: "exit 1", durationMs: Number.NaN },
      { id: "c/3", name: "models.classify", args: "", status: "running", cost: 0.002 },
      { name: "grep", status: "weird", cost: 0 },
      { id: "c/5", status: "ok" },
      null,
    ],
    omittedCalls: 300,
  }), {
    calls: [
      { id: "c/1", name: "read", args: "{\"path\":\"a\"}", status: "ok", durationMs: 12 },
      { id: "c/2", name: "bash", args: "{}", status: "error", error: "exit 1" },
      { id: "c/3", name: "models.classify", args: "", status: "running", cost: 0.002 },
      { id: "", name: "grep", args: "", status: "ok" },
    ],
    omitted: 300,
  });
});

test("drops the script header and keeps rejected input whole", () => {
  const output = { type: "text", text: "42" };
  assert.deepEqual(
    stripCodemodeHeader([{ type: "text", text: "Script completed\nWall time 0.3 seconds\nOutput:\n" }, output]),
    [output],
  );
  assert.deepEqual(
    stripCodemodeHeader([{ type: "text", text: "Script failed\nWall time 12 seconds\nOutput:\n" }, output]),
    [output],
  );
  const rejected = [{ type: "text", text: "Invalid // @options: line" }];
  assert.deepEqual(stripCodemodeHeader(rejected), rejected);
  assert.deepEqual(stripCodemodeHeader([]), []);
});

test("formats durations and costs as pi's TUI does", () => {
  assert.equal(formatCodemodeDuration(undefined), "");
  assert.equal(formatCodemodeDuration(12.4), "12ms");
  assert.equal(formatCodemodeDuration(1530), "1.5s");
  assert.equal(formatCodemodeCost(0.25), "$0.25");
  assert.equal(formatCodemodeCost(0.000123), "$0.00012");
});

test("totals model costs only when more than one call reported one", () => {
  const call = (cost) => ({ id: "", name: "models.chat", args: "", status: "ok", ...(cost ? { cost } : {}) });
  assert.equal(codemodeTotalCost([call(0.01), call()]), null);
  assert.equal(codemodeTotalCost([call(0.01), call(0.02)]), 0.03);
});

test("previews the first line that is neither blank nor the options line", () => {
  assert.equal(codemodeScriptPreview("\n// @options: {\"timeoutMs\": 1000}\n  const files = await tools.ls({})\n"), "const files = await tools.ls({})");
  assert.equal(codemodeScriptPreview("   \n"), "");
});

test("reports the newest running call while a script runs", () => {
  const snapshot = (calls) => ({ content: [], details: { calls } });
  assert.equal(getCodemodeProgress(snapshot([])), null);
  assert.equal(getCodemodeProgress(undefined), null);
  assert.equal(getCodemodeProgress(snapshot([
    { id: "c/1", name: "read", args: "{\"path\":\"a\"}", status: "running" },
    { id: "c/2", name: "grep", args: "{\"pattern\":\"x\"}", status: "running" },
    { id: "c/3", name: "ls", args: "{}", status: "ok" },
  ])), "grep {\"pattern\":\"x\"}");
  assert.equal(getCodemodeProgress(snapshot([{ id: "c/1", name: "ls", args: "", status: "ok" }])), "ls");
  const long = "x".repeat(200);
  assert.equal(getCodemodeProgress(snapshot([{ id: "c/1", name: "read", args: long, status: "running" }])), `read ${"x".repeat(117)}...`);
});

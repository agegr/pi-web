import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const {
  TRAJECTORY_MAX_DETAIL_CHARS,
  fullPayload,
  redactRequestContext,
  summarizePayload,
} = await jiti.import("./trajectory-privacy.ts");

const raw = {
  apiKey: "secret",
  headers: {
    authorization: "Bearer secret",
    "x-api-key": "secret",
    "content-type": "application/json",
  },
  systemPrompt: "system details",
  input: "x".repeat(20_000),
  nested: { toolInput: { path: "/private/file" } },
};

test("summarizePayload never includes raw values or headers", () => {
  const safe = summarizePayload(raw);
  assert.equal("apiKey" in safe, false);
  assert.equal("headers" in safe, false);
  assert.equal("systemPrompt" in safe, false);
  assert.equal("input" in safe, false);
  assert.equal(safe.truncated, true);
  assert.equal(typeof safe.type, "string");
  assert.ok("preview" in safe);
});

test("summarizePayload keeps short strings untruncated", () => {
  const safe = summarizePayload({ text: "hello" });
  assert.equal(safe.truncated, false);
});

test("fullPayload keeps safe headers and drops auth headers", () => {
  const full = fullPayload(raw);
  assert.equal(full.headers["content-type"], "application/json");
  assert.equal("authorization" in full.headers, false);
  assert.equal("x-api-key" in full.headers, false);
  assert.equal("apiKey" in full, false);
});

test("redactRequestContext drops sensitive keys", () => {
  const safe = redactRequestContext({
    apiKey: "k",
    authorization: "Bearer x",
    cookie: "a=b",
    token: "t",
    password: "p",
    secret: "s",
    credential: "c",
    env: { PATH: "/usr/bin" },
    model: "gpt-5",
    systemPrompt: "sys",
  });
  assert.equal("apiKey" in safe, false);
  assert.equal("authorization" in safe, false);
  assert.equal("cookie" in safe, false);
  assert.equal("token" in safe, false);
  assert.equal("password" in safe, false);
  assert.equal("secret" in safe, false);
  assert.equal("credential" in safe, false);
  assert.equal("env" in safe, false);
  assert.equal(safe.model, "gpt-5");
  assert.equal(safe.systemPrompt, "sys");
});

test("redactRequestContext drops absolute session and log paths", () => {
  const safe = redactRequestContext({
    sessionPath: "/Users/kale/.pi/agent/sessions/2026/x.jsonl",
    logFile: "/tmp/agent/logs/pi.log",
    cwd: "/Users/kale/pi-web",
  });
  assert.equal("sessionPath" in safe, false);
  assert.equal("logFile" in safe, false);
  assert.equal(safe.cwd, "/Users/kale/pi-web");
});

test("fullPayload truncates long strings and marks truncation", () => {
  const full = fullPayload({ note: "y".repeat(100_000) });
  assert.equal(full.note.length, TRAJECTORY_MAX_DETAIL_CHARS + "...[truncated]".length);
  assert.equal(full.truncated, true);
});

test("fullPayload bounds arrays", () => {
  const full = fullPayload({ list: Array.from({ length: 5000 }, () => "a") });
  assert.ok(Array.isArray(full.list));
  assert.ok(full.list.length <= 2000);
  assert.equal(full.truncated, true);
});

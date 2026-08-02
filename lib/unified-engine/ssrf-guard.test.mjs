// ssrf-guard.test.mjs —— LLM base_url SSRF 防护单测（Q3）
import { test } from "node:test";
import assert from "node:assert/strict";
import { checkLlmBaseUrl, assertSafeLlmBaseUrl } from "./ssrf-guard";

test("checkLlmBaseUrl：云 metadata 地址被拒", () => {
  assert.equal(checkLlmBaseUrl("http://169.254.169.254/latest").ok, false);
  assert.equal(checkLlmBaseUrl("http://metadata.google.internal/").ok, false);
});

test("checkLlmBaseUrl：环回/私网被拒", () => {
  assert.equal(checkLlmBaseUrl("http://localhost:8080").ok, false);
  assert.equal(checkLlmBaseUrl("http://127.0.0.1/").ok, false);
  assert.equal(checkLlmBaseUrl("http://192.168.1.1/").ok, false);
});

test("checkLlmBaseUrl：非 http(s) 被拒", () => {
  assert.equal(checkLlmBaseUrl("ftp://example.com").ok, false);
  assert.equal(checkLlmBaseUrl("file:///etc").ok, false);
});

test("checkLlmBaseUrl：公网域名放行", () => {
  const r = checkLlmBaseUrl("https://api.openai.com/v1");
  assert.equal(r.ok, true);
  assert.equal(r.host, "api.openai.com");
});

test("assertSafeLlmBaseUrl：合法返回原值，非法抛错", () => {
  assert.equal(assertSafeLlmBaseUrl("https://api.example.com"), "https://api.example.com");
  assert.throws(() => assertSafeLlmBaseUrl("http://169.254.169.254/"), /SSRF/);
});

import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const { readJsonOrThrow } = await createJiti(import.meta.url).import("./fetch-json.ts");

const answer = (status, body) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => (typeof body === "string" ? JSON.parse(body) : body),
});

test("returns an OK answer's JSON", async () => {
  assert.deepEqual(await readJsonOrThrow(answer(200, { enabled: true })), { enabled: true });
});

test("throws the route's error, even on an OK status", async () => {
  await assert.rejects(readJsonOrThrow(answer(400, { error: "cwd is required" })), { message: "cwd is required" });
  await assert.rejects(readJsonOrThrow(answer(200, { error: "partly failed" })), { message: "partly failed" });
});

test("falls back to the status for an answer without an error or not JSON", async () => {
  await assert.rejects(readJsonOrThrow(answer(500, {})), { message: "HTTP 500" });
  await assert.rejects(readJsonOrThrow(answer(502, "<html>Bad Gateway</html>")), { message: "HTTP 502" });
});

test("an abort while the body is read reaches the caller as it is", async () => {
  const abort = new DOMException("This operation was aborted", "AbortError");
  const aborted = { ok: true, status: 200, json: async () => { throw abort; } };
  await assert.rejects(readJsonOrThrow(aborted), (error) => error === abort);
});

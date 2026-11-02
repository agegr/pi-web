import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const { createSideChat, deleteSideChat } = await createJiti(import.meta.url).import("./side-chat-client.ts");

function answer(t, status, body) {
  const calls = [];
  const previous = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body) });
    return new Response(typeof body === "string" ? body : JSON.stringify(body), { status });
  };
  t.after(() => { globalThis.fetch = previous; });
  return calls;
}
const translate = (key) => `t:${key}`;

test("a side chat is asked of the fork route, with a name only when there is one", async (t) => {
  const session = { id: "side" };
  const calls = answer(t, 200, { sessionId: "side", session });
  assert.deepEqual(await createSideChat("a/b", translate), { session });
  assert.deepEqual(await createSideChat("a", translate, "selected"), { session });
  assert.equal(calls[0].url, "/api/sessions/a%2Fb/fork");
  assert.deepEqual(calls[0].body, { side: true });
  assert.deepEqual(calls[1].body, { side: true, name: "selected" });
});

test("a refusal reads as its translated notice, anything else as what the server said", async (t) => {
  answer(t, 409, { code: "empty", error: "raw" });
  assert.deepEqual(await createSideChat("a", translate), { error: "t:sideChat.error.empty" });
  answer(t, 500, { code: "failed", error: "raw" });
  assert.deepEqual(await createSideChat("a", translate), { error: "raw" });
  answer(t, 502, "not json");
  assert.deepEqual(await createSideChat("a", translate), { error: "HTTP 502" });
});

test("a side chat is deleted through its session route, and a refusal is passed on", async (t) => {
  const calls = [];
  let response = new Response(null, { status: 204 });
  const previous = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    calls.push({ url, method: init.method, cache: init.cache });
    return response;
  };
  t.after(() => { globalThis.fetch = previous; });

  assert.equal(await deleteSideChat("a/b"), null);
  assert.deepEqual(calls[0], { url: "/api/sessions/a%2Fb", method: "DELETE", cache: "no-store" });

  response = new Response(JSON.stringify({ error: "raw" }), { status: 404 });
  assert.deepEqual(await deleteSideChat("a"), { error: "raw" });

  response = new Response("not json", { status: 502 });
  assert.deepEqual(await deleteSideChat("a"), { error: "HTTP 502" });
});

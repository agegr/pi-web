import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createJiti } from "jiti";

// "Edit from here" keeps its target in page memory only, so the composer's text
// must not be stored meanwhile (#1718): after a reload, sending it would join
// the branch instead of forking from the edited message.
const shimPath = fileURLToPath(new URL("./__fixtures__/react-hook-shim.mjs", import.meta.url));
const jiti = createJiti(import.meta.url, { tsconfigPaths: true, alias: { react: shimPath } });
const { renderHook } = await import(pathToFileURL(shimPath).href);
const { useAgentSession } = await jiti.import("./useAgentSession.ts");
const { flushStoredDrafts, setDraft } = await jiti.import("@/lib/draft-store");

const values = new Map();
const storage = {
  get length() { return values.size; },
  key: (index) => [...values.keys()][index] ?? null,
  getItem: (key) => values.get(key) ?? null,
  setItem: (key, value) => values.set(key, String(value)),
  removeItem: (key) => values.delete(key),
};
globalThis.document ??= Object.assign(new EventTarget(), { visibilityState: "visible" });
globalThis.window ??= new EventTarget();
Object.defineProperty(window, "localStorage", { configurable: true, get: () => storage });

const json = (body) => new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
const settle = async () => { for (let index = 0; index < 10; index++) await new Promise((resolve) => setImmediate(resolve)); };
const storedText = () => JSON.parse(values.get("pi-web:draft:E") ?? "null")?.text ?? null;

test("a pending history edit keeps the session's draft out of storage until it is cancelled", async () => {
  globalThis.EventSource = class {
    readyState = 0;
    close() { this.readyState = 2; }
  };
  globalThis.fetch = async (url) => {
    if (url.startsWith("/api/models")) return json({ models: {}, modelList: [] });
    if (url.startsWith("/api/sessions/E?")) {
      return json({ sessionId: "E", filePath: "/E.jsonl", leafId: "e1", tree: [], treeFormat: "summary", snapshotRevision: "r", context: { messages: [{ role: "user", content: "old", timestamp: 1 }], entryIds: ["e1"], oldestEntryId: null, hasMore: false } });
    }
    return json({ running: false, state: { isStreaming: false } });
  };

  setDraft("E", { value: "typed", images: [] });
  flushStoredDrafts();
  assert.equal(storedText(), "typed");

  const props = { session: { id: "E", cwd: "/project", path: "/E.jsonl", name: "E" }, newSessionCwd: null, newSessionDraftKey: null, t: (key) => key };
  const hook = renderHook(useAgentSession, props);
  await settle();
  hook.flush();

  hook.result.handleEditContent({ role: "user", content: "old", timestamp: 1 }, "e1");
  hook.flush();
  assert.equal(hook.result.editEntryId, "e1");
  assert.equal(storedText(), null, "the stored copy goes when the edit starts");

  setDraft("E", { value: "rewritten", images: [] });
  flushStoredDrafts();
  assert.equal(storedText(), null);

  // The edit outlives the composer's remount within the page, and so does the hold.
  hook.unmount();
  const again = renderHook(useAgentSession, props);
  await settle();
  again.flush();
  assert.equal(again.result.editEntryId, "e1");
  setDraft("E", { value: "rewritten again", images: [] });
  flushStoredDrafts();
  assert.equal(storedText(), null);

  again.result.cancelEdit();
  again.flush();
  flushStoredDrafts();
  assert.equal(storedText(), "rewritten again", "a cancelled edit leaves an ordinary draft");
  again.unmount();
});

import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const { GET } = await createJiti(import.meta.url, { alias: { "@": process.cwd() } }).import("./route.ts");

test("the existing running poll exposes committed main completions, not children or closing wrappers", async (t) => {
  const previous = globalThis.__piSessions;
  t.after(() => { globalThis.__piSessions = previous; });
  const session = (id, overrides = {}) => ({
    sessionId: id,
    isAlive: () => true,
    isRunning: () => false,
    isAwaitingInput: () => false,
    hasSuppressedCompletionNotifications: () => false,
    ...overrides,
  });
  globalThis.__piSessions = new Map([
    ["root", session("root", { completionId: "100" })],
    ["waiting-root", session("waiting-root")],
    ["child", session("child", { completionId: "101", hasSuppressedCompletionNotifications: () => true })],
    ["closing-root", session("closing-root", { completionId: "102", isAlive: () => false })],
  ]);
  const first = await (await GET()).json();
  assert.deepEqual(first.completionIds, { root: "100" });
  assert.deepEqual(first.runningSessionIds, []);
  globalThis.__piSessions.get("waiting-root").completionId = "103";
  const second = await (await GET()).json();
  assert.deepEqual(second.completionIds, { root: "100", "waiting-root": "103" });
  assert.equal(second.sessionListVersion, first.sessionListVersion, "reading completions must not invalidate the catalogue");
});

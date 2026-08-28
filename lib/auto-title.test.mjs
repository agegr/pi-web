import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";
import { readFile } from "node:fs/promises";

const jiti = createJiti(import.meta.url);
const {
  acquireTitleGenerationLock,
  isTitleGenerationInFlight,
  maybeAutoTitleSession,
} = await jiti.import("./auto-title.ts");

const enabled = () => true;

function createWrapper({ alive = true, name } = {}) {
  const calls = { setName: [], named: [] };
  return {
    wrapper: {
      sessionId: "session-a",
      isAlive: () => alive,
      emitSessionNamed: (title) => calls.named.push(title),
      inner: {
        sessionManager: { getSessionName: () => name },
        setSessionName: (value) => calls.setName.push(value),
      },
    },
    calls,
  };
}

test("title generation lock is exclusive per session", () => {
  const release = acquireTitleGenerationLock("lock-test");
  assert.ok(release);
  assert.equal(isTitleGenerationInFlight("lock-test"), true);
  assert.equal(acquireTitleGenerationLock("lock-test"), null);
  release();
  assert.equal(isTitleGenerationInFlight("lock-test"), false);
});

test("maybeAutoTitleSession skips named sessions without generating", async () => {
  const { wrapper, calls } = createWrapper({ name: "User named it" });
  let generateCalls = 0;
  const result = await maybeAutoTitleSession(wrapper, async () => {
    generateCalls++;
    return { title: "Should not run" };
  }, enabled);
  assert.equal(result, null);
  assert.equal(generateCalls, 0);
  assert.equal(calls.setName.length, 0);
});

test("maybeAutoTitleSession skips dead wrappers", async () => {
  const { wrapper } = createWrapper({ alive: false });
  let generateCalls = 0;
  const result = await maybeAutoTitleSession(wrapper, async () => {
    generateCalls++;
    return { title: "Should not run" };
  }, enabled);
  assert.equal(result, null);
  assert.equal(generateCalls, 0);
});

test("maybeAutoTitleSession respects the enabled setting", async () => {
  const { wrapper, calls } = createWrapper({});
  let generateCalls = 0;
  const result = await maybeAutoTitleSession(wrapper, async () => {
    generateCalls++;
    return { title: "Should not run" };
  }, () => false);
  assert.equal(result, null);
  assert.equal(generateCalls, 0);
  assert.equal(calls.setName.length, 0);
});

test("maybeAutoTitleSession names an unnamed live session exactly once", async () => {
  const { wrapper, calls } = createWrapper({});
  const seen = [];
  const result = await maybeAutoTitleSession(wrapper, async (inner) => {
    seen.push(inner);
    return { title: "Auto Title" };
  }, enabled);
  assert.equal(result, "Auto Title");
  assert.deepEqual(seen, [wrapper.inner]);
  assert.deepEqual(calls.setName, ["Auto Title"]);
  assert.deepEqual(calls.named, ["Auto Title"]);
});

test("a second run end does not regenerate once the session is named", async () => {
  const { wrapper, calls } = createWrapper({});
  await maybeAutoTitleSession(wrapper, async () => ({ title: "First" }), enabled);
  // The persisted name is now visible through getSessionName.
  wrapper.inner.sessionManager.getSessionName = () => "First";
  let generateCalls = 0;
  const result = await maybeAutoTitleSession(wrapper, async () => {
    generateCalls++;
    return { title: "Second" };
  }, enabled);
  assert.equal(result, null);
  assert.equal(generateCalls, 0);
  assert.deepEqual(calls.setName, ["First"]);
});

test("a failed generation releases the lock for the next run end", async () => {
  const { wrapper } = createWrapper({});
  await assert.rejects(
    maybeAutoTitleSession(wrapper, async () => {
      throw new Error("provider unavailable");
    }, enabled),
    /provider unavailable/,
  );
  assert.equal(isTitleGenerationInFlight(wrapper.sessionId), false);
  const result = await maybeAutoTitleSession(wrapper, async () => ({ title: "Retry works" }), enabled);
  assert.equal(result, "Retry works");
});

test("auto-title emits session_named after persisting the title", async () => {
  const { wrapper, calls } = createWrapper({});
  await maybeAutoTitleSession(wrapper, async () => ({ title: "Emitted" }), enabled);
  assert.deepEqual(calls.named, ["Emitted"]);
});

test("rpc-manager wires automatic titling into onAgentRunComplete", async () => {
  const source = await readFile(new URL("./rpc-manager.ts", import.meta.url), "utf8");
  assert.match(source, /import \{ maybeAutoTitleSession \} from "\.\/auto-title"/);
  assert.match(source, /maybeAutoTitleSession\(completedSession\)/);
});

test("auto-name route shares the title generation lock", async () => {
  const source = await readFile(new URL("../app/api/sessions/[id]/auto-name/route.ts", import.meta.url), "utf8");
  assert.match(source, /acquireTitleGenerationLock\(session\.sessionId\)/);
  assert.match(source, /status: 409/);
});

test("session_named event flows from the wrapper to the AppShell handler", async () => {
  const rpcSource = await readFile(new URL("./rpc-manager.ts", import.meta.url), "utf8");
  const hookSource = await readFile(new URL("../hooks/useAgentSession.ts", import.meta.url), "utf8");
  const appShellSource = await readFile(new URL("../components/AppShell.tsx", import.meta.url), "utf8");
  const chatWindowSource = await readFile(new URL("../components/ChatWindow.tsx", import.meta.url), "utf8");

  assert.match(rpcSource, /emitSessionNamed\(title: string\)[\s\S]*?type: "session_named"/);
  assert.match(hookSource, /case "session_named"[\s\S]*?onSessionNamed\?\.\(namedSessionId, title\)/);
  assert.match(hookSource, /onSessionNamed\?: \(sessionId: string, title: string\) => void/);
  assert.match(chatWindowSource, /onSessionNamed,/);
  assert.match(appShellSource, /onSessionNamed=\{handleSessionNamed\}/);
  assert.match(appShellSource, /const handleSessionNamed = useCallback\(\(sessionId: string, title: string\)/);
});

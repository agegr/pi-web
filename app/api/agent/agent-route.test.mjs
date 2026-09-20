import assert from "node:assert/strict";
import { appendFile, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

// Disable the session idle shutdown timer before rpc-manager is imported so
// live wrappers created by the real-wrapper regression tests below cannot keep
// the test process alive with a pending timer.
process.env.PI_WEB_IDLE_TIMEOUT_MS = "0";

const routeSource = await readFile(new URL("./[id]/route.ts", import.meta.url), "utf8");
const hookSource = await readFile(new URL("../../../hooks/useAgentSession.ts", import.meta.url), "utf8");
const rpcSource = await readFile(new URL("../../../lib/rpc-manager.ts", import.meta.url), "utf8");

const jiti = createJiti(import.meta.url, {
  alias: { "@": process.cwd() },
  interopDefault: true,
  moduleCache: false,
});
const { POST: postAgentCommand } = await jiti.import("./[id]/route.ts");
const { AgentSessionWrapper } = await jiti.import("../../../lib/rpc-manager.ts");
const {
  invalidateSessionListCache,
  invalidateSessionPathCache,
} = await jiti.import("../../../lib/session-reader.ts");

// The registry lives on globalThis so it survives Next.js hot reload; tests
// swap in a fake wrapper and restore the real map afterwards.
function installFakeRegistry(wrapper) {
  const previous = globalThis.__piSessions;
  const registry = new Map();
  if (wrapper !== undefined) registry.set("fake-session", wrapper);
  globalThis.__piSessions = registry;
  return previous;
}

function restoreRegistry(previous) {
  globalThis.__piSessions = previous;
}

function makeFakeWrapper(overrides = {}) {
  const calls = { sent: [] };
  const wrapper = {
    isAlive: () => true,
    async send(command) {
      calls.sent.push(command);
      return "fast-path-result";
    },
    calls,
    ...overrides,
  };
  return wrapper;
}

function reloadError() {
  // A name-tagged error stands in for the real class across the duplicate
  // module instances jiti creates (moduleCache: false); the route recognizes
  // the reload error by name as well as by instanceof.
  const error = new Error("Session was updated by another Pi process; reloaded from disk before the prompt was submitted");
  error.name = "SessionReloadedFromDiskError";
  return error;
}

async function post(body) {
  const response = await postAgentCommand(new Request("http://localhost/api/agent/fake-session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }), { params: Promise.resolve({ id: "fake-session" }) });
  return { status: response.status, body: await response.json() };
}

test("the disk-ahead probe lives inside send() after prompt admission", () => {
  // The route must not probe before send(): that left an await window where
  // another pi process could append between the probe and the submission.
  // The probe now runs inside AgentSessionWrapper.send() after admission is
  // acquired, making probe + submission one synchronous section.
  assert.doesNotMatch(routeSource, /evictIfDiskAhead/);
  assert.match(routeSource, /if \(!isSessionReloadedFromDiskError\(error\)\) throw error/);
  // A prompt whose data is otherwise always null reports the reload so the
  // client can show its notice.
  assert.match(routeSource, /reloadedFromDisk && body\.type === "prompt" \? \{ reloadedFromDisk: true \} : result/);

  const admissionIdx = rpcSource.indexOf("const releaseAdmission = await this.acquirePromptAdmission();");
  assert.ok(admissionIdx >= 0, "prompt case acquires admission");
  const probeIdx = rpcSource.indexOf("this.evictIfDiskAhead()", admissionIdx);
  assert.ok(probeIdx > admissionIdx, "disk-ahead probe runs after admission is acquired");
  const submitIdx = rpcSource.indexOf("this.inner.prompt(", probeIdx);
  assert.ok(submitIdx > probeIdx, "prompt submission follows the probe with no intervening await window");
  assert.match(rpcSource, /if \(this\.evictIfDiskAhead\(\)\) \{\s*\n\s*throw new SessionReloadedFromDiskError\(\)/);

  // The client surfaces the fixed notice text from the wi acceptance criteria.
  assert.match(hookSource, /This session was updated by another Pi process\. Reloaded from disk\./);
  assert.match(hookSource, /reloadedFromDisk === true/);
});

test("an idle prompt goes through the live wrapper when disk is current", async (t) => {
  const wrapper = makeFakeWrapper();
  const previous = installFakeRegistry(wrapper);
  t.after(() => restoreRegistry(previous));

  const { status, body } = await post({ type: "prompt", message: "hello" });
  assert.equal(status, 200);
  assert.equal(body.data, "fast-path-result");
  assert.equal(wrapper.calls.sent.length, 1);
  assert.equal(wrapper.calls.sent[0].type, "prompt");
});

test("non-prompt commands go straight through the wrapper", async (t) => {
  const wrapper = makeFakeWrapper();
  const previous = installFakeRegistry(wrapper);
  t.after(() => restoreRegistry(previous));

  const { status, body } = await post({ type: "get_state" });
  assert.equal(status, 200);
  assert.equal(body.data, "fast-path-result");
  assert.equal(wrapper.calls.sent.length, 1);
  assert.equal(wrapper.calls.sent[0].type, "get_state");
});

test("a prompt that reloads mid-send falls back to the cold-start path", async (t) => {
  // The fake wrapper throws the reload error from inside send(), i.e. the
  // external append landed after any pre-send check the route could have made
  // — exactly the window the old route-level probe missed. The route must not
  // return the stale wrapper's result or a 500; it falls through to reload.
  const wrapper = makeFakeWrapper({
    async send(command) {
      wrapper.calls.sent.push(command);
      throw reloadError();
    },
  });
  const previous = installFakeRegistry(wrapper);
  t.after(() => restoreRegistry(previous));

  // Point the session catalogue at an empty dir so the reload path cannot
  // resolve a session file and startRpcSession is never invoked in-test.
  const dir = await mkdtemp(join(tmpdir(), "pi-web-agent-reload-"));
  const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = dir;
  invalidateSessionListCache();
  invalidateSessionPathCache("fake-session");
  t.after(async () => {
    if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
    invalidateSessionListCache();
    invalidateSessionPathCache("fake-session");
    await rm(dir, { recursive: true, force: true });
  });

  const { status, body } = await post({ type: "prompt", message: "hello" });
  assert.equal(status, 404);
  assert.equal(body.error, "Session not found");
  assert.equal(body.code, "prompt_rejected");
  // The stale wrapper was entered once (its own probe evicted it mid-send)
  // and never returned a result for the prompt.
  assert.equal(wrapper.calls.sent.length, 1);
});

test("a real wrapper prompt against a disk-ahead file evicts itself and never submits", async (t) => {
  // Regression for the reviewed race: the wrapper's own head must never
  // append behind the disk head. The in-memory index knows no entry, so the
  // probe inside send() must destroy the wrapper and reject the prompt before
  // inner.prompt() is ever called.
  const dir = await mkdtemp(join(tmpdir(), "pi-web-wrapper-evict-"));
  const file = join(dir, "session.jsonl");
  await writeFile(file, [
    JSON.stringify({ type: "session", id: "sid", version: 3, cwd: dir }),
    JSON.stringify({ type: "message", id: "external-entry", message: { role: "user", content: "from tui" } }),
    "",
  ].join("\n"));

  const promptCalls = [];
  const inner = {
    sessionId: "fake-session",
    sessionFile: file,
    isStreaming: false,
    isCompacting: false,
    isBashRunning: false,
    sessionManager: {
      getCwd: () => dir,
      getEntry: () => undefined, // the in-memory index never saw the append
    },
    subscribe: () => () => {},
    dispose: () => {},
    async prompt(message) {
      promptCalls.push(message);
    },
  };
  const wrapper = new AgentSessionWrapper(inner);
  t.after(() => {
    wrapper.destroy();
    return rm(dir, { recursive: true, force: true });
  });

  await assert.rejects(
    () => wrapper.send({ type: "prompt", message: "hello" }),
    (error) => {
      assert.equal(error.name, "SessionReloadedFromDiskError");
      return true;
    },
  );
  assert.equal(promptCalls.length, 0, "the stale wrapper never submitted the prompt");
  assert.equal(wrapper.isAlive(), false);
});

test("an external append between two prompts reloads on the next submission", async (t) => {
  // The other half of the reviewed race: the probe is part of the submission
  // path itself, so an append that lands while the wrapper sits idle (after a
  // previous prompt completed, during the admission wait, or between the
  // route's checks and send) is caught at submission time.
  const dir = await mkdtemp(join(tmpdir(), "pi-web-wrapper-interval-"));
  const file = join(dir, "session.jsonl");
  const writeLines = (ids) => writeFile(file, [
    JSON.stringify({ type: "session", id: "sid", version: 3, cwd: dir }),
    ...ids.map((id) => JSON.stringify({ type: "message", id, message: { role: "user", content: id } })),
    "",
  ].join("\n"));
  await writeLines(["e1"]);

  const promptCalls = [];
  const knownIds = new Set(["e1"]);
  const inner = {
    sessionId: "fake-session",
    sessionFile: file,
    isStreaming: false,
    isCompacting: false,
    isBashRunning: false,
    sessionManager: {
      getCwd: () => dir,
      getEntry: (id) => (knownIds.has(id) ? { id } : undefined),
    },
    subscribe: () => () => {},
    dispose: () => {},
    async prompt(message) {
      promptCalls.push(message);
    },
  };
  const wrapper = new AgentSessionWrapper(inner);
  t.after(() => {
    wrapper.destroy();
    return rm(dir, { recursive: true, force: true });
  });

  // Disk is current: the first prompt submits normally through the live head.
  const first = await wrapper.send({ type: "prompt", message: "one" });
  assert.equal(first, null);
  assert.equal(promptCalls.length, 1);

  // Another pi process (the TUI) appends while the wrapper sits idle.
  await appendFile(file, JSON.stringify({ type: "message", id: "e2", message: { role: "assistant", content: "tui reply" } }) + "\n");

  // The next submission must reload from disk instead of chaining onto the
  // stale in-memory head, which would fork the session tree.
  await assert.rejects(
    () => wrapper.send({ type: "prompt", message: "two" }),
    (error) => {
      assert.equal(error.name, "SessionReloadedFromDiskError");
      return true;
    },
  );
  assert.equal(promptCalls.length, 1, "only the first prompt was ever submitted");
  assert.equal(wrapper.isAlive(), false);
});

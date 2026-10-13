import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { GET } = await jiti.import("./[id]/route.ts");
const { GET: getContext } = await jiti.import("./[id]/context/route.ts");
const { SessionManager } = await jiti.import("@earendil-works/pi-coding-agent");
const { collectSessionWrittenFiles } = await jiti.import("../../../lib/session-written-files.ts");

function record(manager, id, name, input, isError = false, details) {
  manager.appendMessage({
    role: "assistant", model: "test", provider: "test", timestamp: 1_000,
    content: [{ type: "toolCall", id, name, arguments: input }],
  });
  return manager.appendMessage({
    role: "toolResult", toolCallId: id, toolName: name, isError, timestamp: 1_100,
    content: [{ type: "text", text: "synthetic result body" }],
    ...(details ? { details } : {}),
  });
}

async function read(get, id, query) {
  const response = await get(new Request(`http://localhost/api/sessions/${id}?${query}`), {
    params: Promise.resolve({ id }),
  });
  const data = await response.json();
  assert.equal(response.status, 200, JSON.stringify(data));
  return data;
}

function files(messages, writes) {
  const results = new Map(messages.filter((message) => message.role === "toolResult")
    .map((message) => [message.toolCallId, message]));
  return collectSessionWrittenFiles(messages, results, "/synthetic/repo", null, writes);
}

function counts(entries) {
  return Object.fromEntries(entries.map((file) => [file.filePath, file.writeCount]));
}

test("GET preserves complete successful-write evidence across compaction, last50 pages and selected-leaf reads", async (t) => {
  t.mock.method(globalThis, "fetch", () => { throw new Error("network is forbidden in this regression"); });
  const previous = globalThis.__piSessions;
  globalThis.__piSessions = new Map();
  t.after(() => { globalThis.__piSessions = previous; });
  const manager = SessionManager.inMemory("/synthetic/repo");
  const id = manager.getSessionId();
  globalThis.__piSessions.set(id, {
    isAlive: () => true,
    isRunning: () => false,
    evictIfDiskAhead: () => { throw new Error("manifest-only reads must not evict a live session"); },
    inner: { sessionManager: manager, sessionId: id },
    sessionFile: "",
  });

  record(manager, "early-write", "write", { path: "early.html" });
  record(manager, "early-edit", "edit", { path: "early.html" });
  const patch = "*** Begin Patch\n*** Add File: patched.ts\n+ok\n*** End Patch";
  record(manager, "early-patch", "apply_patch", { input: patch }, false,
    { result: { appliedFiles: ["patched.ts"], failures: [] } });
  record(manager, "failed-write", "write", { path: "failed.html" }, true);
  record(manager, "failed-edit", "edit", { path: "failed-edit.html" }, true);
  record(manager, "failed-patch", "apply_patch", { input: patch }, true);
  record(manager, "read-only", "read", { path: "read-only.html" });
  const branchPoint = manager.appendMessage({ role: "user", content: "kept anchor", timestamp: 2_000 });
  manager.appendCompaction("body-free synthetic summary", branchPoint, 100);
  for (let index = 0; index < 55; index++) {
    manager.appendMessage({ role: "user", content: `anchor ${index}`, timestamp: 3_000 + index });
  }
  const selectedLeaf = record(manager, "late-edit", "edit", { path: "early.html" });

  const detail = await read(GET, id, "tree=summary&deferThinking=1&deferMedia=1");
  assert.equal(detail.context.messages.filter((message) => message.role === "user" || message.role === "assistant").length, 50);
  assert.equal(detail.context.hasMore, true);
  assert.equal(detail.writtenFileManifest?.leafId, selectedLeaf, "the paged GET must include its full branch manifest");
  assert.deepEqual(counts(files(detail.context.messages, detail.writtenFileManifest.writes)), {
    "/synthetic/repo/early.html": 3, "/synthetic/repo/patched.ts": 1,
  });
  assert.deepEqual(detail.writtenFileManifest.writes.map((write) => write.toolCallId),
    ["early-write", "early-edit", "early-patch", "late-edit"]);
  for (const write of detail.writtenFileManifest.writes) {
    assert.deepEqual(Object.keys(write).sort(), ["filePath", "sessionWrittenAtMs", "toolCallId"]);
    assert.equal(write.sessionWrittenAtMs, 1_100);
  }

  const older = await read(getContext, id, `leafId=${selectedLeaf}&before=${detail.context.oldestEntryId}&deferThinking=1&deferMedia=1`);
  assert.deepEqual(counts(files([...older.context.messages, ...detail.context.messages], detail.writtenFileManifest.writes)), {
    "/synthetic/repo/early.html": 3, "/synthetic/repo/patched.ts": 1,
  }, "paging old tool results into the loaded history must not count them twice");

  manager.branch(branchPoint);
  const siblingLeaf = record(manager, "sibling-write", "write", { path: "sibling.html" });
  t.mock.method(manager, "getTree", () => { throw new Error("manifest-only GET must not build the transcript tree"); });
  const selected = await read(GET, id, `writtenFiles=1&leafId=${selectedLeaf}&force=1`);
  assert.deepEqual(Object.keys(selected).sort(), ["sessionId", "writtenFileManifest"]);
  assert.equal(selected.sessionId, id);
  assert.deepEqual(selected.writtenFileManifest, detail.writtenFileManifest);
  assert.equal(manager.getLeafId(), siblingLeaf, "previewing the selected leaf must not navigate the live session");
  const root = await read(GET, id, "writtenFiles=1&leafId=");
  assert.deepEqual(root.writtenFileManifest, { leafId: null, writes: [] });
  assert.equal(manager.getLeafId(), siblingLeaf);
});

import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

// No lookup below may reach the real agent dir.
const agentDir = mkdtempSync(join(tmpdir(), "pi-web-entry-agent-"));
const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
process.env.PI_CODING_AGENT_DIR = agentDir;
test.after(() => {
  if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
  rmSync(agentDir, { recursive: true, force: true });
});

const jiti = createJiti(import.meta.url);
const { readSessionEntryById } = await jiti.import("./session-entry-read.ts");
const { invalidateSessionManagerCache } = await jiti.import("./session-reader.ts");

function swapRegistry(t, wrappers) {
  const previous = globalThis.__piSessions;
  globalThis.__piSessions = new Map(Object.entries(wrappers));
  t.after(() => { globalThis.__piSessions = previous; });
}

function wrapper({ alive = true, entries = {}, sessionFile = "" }) {
  return {
    isAlive: () => alive,
    sessionFile,
    inner: { sessionManager: { getEntry: (id) => entries[id] } },
  };
}

test("an open session's entry comes from its wrapper's SessionManager, not the file (#1812)", async (t) => {
  const entry = { type: "message", id: "e1", parentId: null, message: { role: "assistant", content: [] } };
  // No file anywhere: a disk read would find no session.
  swapRegistry(t, { s1: wrapper({ entries: { e1: entry } }) });
  assert.deepEqual(await readSessionEntryById("s1", "e1"), { entry });
});

test("an entry the wrapper does not hold is read from its file", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "pi-web-entry-file-"));
  const sessionFile = join(dir, "session.jsonl");
  const onDisk = { type: "message", id: "e2", parentId: null, timestamp: "2026-01-01T00:00:00.000Z", message: { role: "user", content: "from the TUI", timestamp: 0 } };
  writeFileSync(sessionFile, [
    { type: "session", version: 3, id: "s1", timestamp: "2026-01-01T00:00:00.000Z", cwd: dir },
    onDisk,
  ].map((line) => JSON.stringify(line)).join("\n") + "\n");
  t.after(() => {
    invalidateSessionManagerCache(sessionFile);
    rmSync(dir, { recursive: true, force: true });
  });
  swapRegistry(t, { s1: wrapper({ sessionFile }) });

  assert.deepEqual(await readSessionEntryById("s1", "e2"), { entry: onDisk });
  assert.deepEqual(await readSessionEntryById("s1", "missing"), { entry: undefined });
});

test("a closing wrapper is not read, and an unknown session is null", async (t) => {
  swapRegistry(t, {
    s1: wrapper({ alive: false, entries: { e1: { type: "message", id: "e1" } } }),
  });
  assert.equal(await readSessionEntryById("s1", "e1"), null);
  assert.equal(await readSessionEntryById("nope", "e1"), null);
});

// Unit tests for lib/session-watcher.ts: external writes to the sessions
// root must bump the session list version exactly once per debounce window,
// new session files must be detected, a missing root must degrade without
// throwing (logging once), and ensureSessionWatcher() must stay idempotent.
import assert from "node:assert/strict";
import test from "node:test";
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  alias: { "@": process.cwd() },
  interopDefault: true,
});
const {
  ensureSessionWatcher,
  disposeSessionWatcher,
  getRecentSessionWrites,
  getSessionWriteGeneration,
  getSessionWatcherStatus,
} = await jiti.import("./session-watcher.ts");
const { getSessionListVersion } = await jiti.import("./session-reader.ts");

const SESSION_ID = "22222222-2222-4222-8222-222222222222";

function sessionHeader(id = SESSION_ID) {
  return JSON.stringify({
    type: "session",
    version: 3,
    id,
    cwd: "/tmp",
    timestamp: "2026-01-01T00:00:00.000Z",
  });
}

function messageEntry(id, text) {
  return JSON.stringify({
    id,
    parentId: null,
    type: "message",
    timestamp: "2026-01-01T00:00:01.000Z",
    message: { role: "user", content: [{ type: "text", text }] },
  });
}

function fixtureDir(t, subdir = "encoded-cwd") {
  const dir = mkdtempSync(join(tmpdir(), "pi-web-watcher-"));
  t.after(() => {
    disposeSessionWatcher();
    rmSync(dir, { recursive: true, force: true });
  });
  const projectDir = join(dir, subdir);
  mkdirSync(projectDir, { recursive: true });
  return { dir, projectDir };
}

async function waitFor(predicate, { timeoutMs = 4000, intervalMs = 25 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await sleep(intervalMs);
  }
  return predicate();
}

test("an external append bumps the list version exactly once per debounce window", async (t) => {
  const { dir, projectDir } = fixtureDir(t);
  const file = join(projectDir, `2026-01-01T00-00-00-000Z_${SESSION_ID}.jsonl`);
  // Created before the watcher starts so its creation is not observed.
  writeFileSync(file, `${sessionHeader()}\n${messageEntry("aaaa0001", "first")}\n`);

  ensureSessionWatcher({ root: dir, debounceMs: 30 });
  const versionBefore = getSessionListVersion();

  // Burst of external appends (as the TUI would make) inside one window.
  appendFileSync(file, `${messageEntry("bbbb0002", "external one")}\n`);
  appendFileSync(file, `${messageEntry("cccc0003", "external two")}\n`);

  const bumped = await waitFor(() => getSessionListVersion() > versionBefore);
  assert.ok(bumped, "external appends must bump the session list version");
  // Let any second (buggy) flush fire and prove it never does.
  await sleep(200);
  assert.equal(
    getSessionListVersion(),
    versionBefore + 1,
    "one burst must coalesce into exactly one version bump",
  );
  assert.equal(getSessionWriteGeneration(file), 1);
});

test("a newly created session file is detected and reported in the write ring", async (t) => {
  const { dir, projectDir } = fixtureDir(t);
  ensureSessionWatcher({ root: dir, debounceMs: 30 });
  assert.equal(getSessionListVersion() >= 0, true);

  const newId = "33333333-3333-4333-8333-333333333333";
  const newFile = join(projectDir, `2026-01-02T00-00-00-000Z_${newId}.jsonl`);
  const versionBefore = getSessionListVersion();
  writeFileSync(newFile, `${sessionHeader(newId)}\n${messageEntry("dddd0004", "new session")}\n`);

  const detected = await waitFor(() => getSessionWriteGeneration(newFile) >= 1);
  assert.ok(detected, "a new <timestamp>_<uuid>.jsonl must be detected");
  assert.ok(
    getSessionListVersion() > versionBefore,
    "creating a session externally must bump the list version",
  );
  const writes = getRecentSessionWrites();
  const match = writes.find((write) => write.path === newFile);
  assert.ok(match, "the write ring must contain the new session file");
  assert.equal(typeof match.generation, "number");
  assert.ok(match.generation >= 1);
});

test("a missing root does not throw and logs the degradation exactly once", async (t) => {
  const { dir } = fixtureDir(t);
  const missingRoot = join(dir, "does-not-exist");
  const originalWarn = console.warn;
  let warnings = 0;
  console.warn = (...args) => {
    if (String(args[0]).includes("session watcher unavailable")) warnings += 1;
    else originalWarn(...args);
  };
  t.after(() => {
    console.warn = originalWarn;
  });

  assert.doesNotThrow(() => ensureSessionWatcher({ root: missingRoot, debounceMs: 30 }));
  const status = getSessionWatcherStatus();
  assert.equal(status.degraded, true);
  assert.equal(status.watcherCount, 0);

  // A repeat ensure on the same dead root retries but never logs again.
  assert.doesNotThrow(() => ensureSessionWatcher({ root: missingRoot, debounceMs: 30 }));
  await sleep(80);
  assert.equal(warnings, 1, "degradation must be logged exactly once");
});

test("calling ensureSessionWatcher() twice leaves exactly one root watcher", async (t) => {
  const { dir, projectDir } = fixtureDir(t);
  writeFileSync(
    join(projectDir, `2026-01-01T00-00-00-000Z_${SESSION_ID}.jsonl`),
    `${sessionHeader()}\n${messageEntry("aaaa0001", "first")}\n`,
  );

  ensureSessionWatcher({ root: dir, debounceMs: 30 });
  const first = getSessionWatcherStatus();
  ensureSessionWatcher({ root: dir, debounceMs: 30 });
  const second = getSessionWatcherStatus();

  assert.equal(second.recursive, first.recursive);
  assert.equal(second.watcherCount, first.watcherCount);
  assert.equal(second.degraded, false);
  if (first.recursive) {
    // Recursive watch is available on every supported platform (Node >= 20),
    // so the idempotent ensure must leave exactly the single root watcher.
    assert.equal(first.watcherCount, 1);
    assert.equal(second.watcherCount, 1);
  }
});

test("reads never bump the session list version", async (t) => {
  const { dir, projectDir } = fixtureDir(t);
  const file = join(projectDir, `2026-01-01T00-00-00-000Z_${SESSION_ID}.jsonl`);
  writeFileSync(file, `${sessionHeader()}\n${messageEntry("aaaa0001", "first")}\n`);
  ensureSessionWatcher({ root: dir, debounceMs: 30 });
  await sleep(80); // settle any watcher startup noise

  const version = getSessionListVersion();
  getRecentSessionWrites();
  getSessionWriteGeneration(file);
  getSessionWatcherStatus();
  ensureSessionWatcher({ root: dir, debounceMs: 30 }); // already live: reuse
  await sleep(120);
  assert.equal(
    getSessionListVersion(),
    version,
    "pure reads must not invalidate the session list",
  );
});

test("on platforms where recursive watch's unref is broken, the per-subdirectory layout is used", async (t) => {
  const { dir, projectDir } = fixtureDir(t);
  ensureSessionWatcher({ root: dir, debounceMs: 30 });
  const status = getSessionWatcherStatus();
  if (process.platform === "linux") {
    // Node's Linux "recursive" fs.watch emulation ignores unref() (one
    // internal watcher per subdirectory), which would hang every process
    // that lazily starts the watcher. The module must use the non-recursive
    // layout there: root-rescan watcher + one watcher per subdirectory.
    assert.equal(status.recursive, false);
    assert.ok(status.watcherCount >= 2, "root watcher + at least one subdirectory watcher");
  } else {
    assert.equal(status.recursive, true);
    assert.equal(status.watcherCount, 1);
  }
});

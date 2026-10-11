import assert from "node:assert/strict";
import fs from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const {
  checkSessionMembership,
  listSessionsIncremental,
  resetSessionScanIndexForTests,
  SESSION_MEMBERSHIP_CHECK_MS,
} = await jiti.import("./session-list-scanner.ts");

const header = (id) => JSON.stringify({ type: "session", version: 3, id, cwd: "/tmp", timestamp: "2026-01-01T00:00:00.000Z" }) + "\n";

function fixture(t, { sessionsDir = true } = {}) {
  const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
  const root = fs.mkdtempSync(join(tmpdir(), "pi-web-membership-"));
  const sessions = join(root, "sessions");
  if (sessionsDir) fs.mkdirSync(join(sessions, "project"), { recursive: true });
  process.env.PI_CODING_AGENT_DIR = root;
  resetSessionScanIndexForTests();
  t.after(() => {
    resetSessionScanIndexForTests();
    if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
    fs.rmSync(root, { recursive: true, force: true });
  });
  let changes = 0;
  let now = 1_000_000;
  return {
    sessions,
    get changes() { return changes; },
    write(project, id) {
      fs.mkdirSync(join(sessions, project), { recursive: true });
      const path = join(sessions, project, `${id}.jsonl`);
      fs.writeFileSync(path, header(id));
      return path;
    },
    // Each call is a poll far enough from the previous one to pass the throttle.
    async check() {
      now += SESSION_MEMBERSHIP_CHECK_MS;
      const run = checkSessionMembership(sessions, () => changes++, now);
      assert.ok(run, "a check should start");
      await run;
    },
    start(at) { return checkSessionMembership(sessions, () => changes++, at); },
  };
}

test("no check runs before the first scan", (t) => {
  const f = fixture(t);
  assert.equal(f.start(1_000_000), undefined);
});

test("appends to an existing session never report a change", async (t) => {
  const f = fixture(t);
  const path = f.write("project", "a");
  await listSessionsIncremental({ deferDetails: true });
  for (let i = 0; i < 5; i++) {
    fs.appendFileSync(path, JSON.stringify({ type: "message", id: String(i) }) + "\n");
    await f.check();
  }
  assert.equal(f.changes, 0);
});

test("a created, deleted or new-folder session reports one change each", async (t) => {
  const f = fixture(t);
  f.write("project", "a");
  await listSessionsIncremental({ deferDetails: true });

  const created = f.write("project", "b");
  await f.check();
  assert.equal(f.changes, 1);
  await f.check();
  assert.equal(f.changes, 1, "one change is reported once, not on every poll until a rescan");

  f.write("new-cwd", "c");
  await f.check();
  assert.equal(f.changes, 2);

  fs.rmSync(created);
  await f.check();
  assert.equal(f.changes, 3);

  fs.mkdirSync(join(f.sessions, "empty-cwd"));
  fs.writeFileSync(join(f.sessions, "project", "notes.txt"), "x");
  fs.writeFileSync(join(f.sessions, "project", "b.jsonl.tmp"), "x");
  await f.check();
  assert.equal(f.changes, 3, "folders without sessions and other files are not sessions");
});

test("a missing sessions directory is an empty catalogue, then its first session is found", async (t) => {
  const f = fixture(t, { sessionsDir: false });
  assert.deepEqual(await listSessionsIncremental({ deferDetails: true }), []);
  await f.check();
  assert.equal(f.changes, 0);
  f.write("project", "a");
  await f.check();
  assert.equal(f.changes, 1);
});

test("checks are throttled and never run in parallel", async (t) => {
  const f = fixture(t);
  await listSessionsIncremental({ deferDetails: true });
  const first = f.start(5_000_000);
  assert.ok(first);
  assert.equal(f.start(9_000_000), undefined, "a second check waits for the first");
  await first;
  assert.equal(f.start(5_000_000 + SESSION_MEMBERSHIP_CHECK_MS - 1), undefined, "at most one check per interval");
  const next = f.start(5_000_000 + SESSION_MEMBERSHIP_CHECK_MS);
  assert.ok(next);
  await next;
});

test("a scan recorded while a check reads wins over that check", async (t) => {
  const f = fixture(t);
  f.write("project", "a");
  await listSessionsIncremental({ deferDetails: true });
  const b = f.write("project", "b");
  const check = f.start(1_000_000);
  assert.ok(check);
  // What a listSessionsIncremental() finishing its read now records (deterministic
  // stand-in for a scan racing the check): it already lists b.
  globalThis.__piSessionMembership = { files: new Set([...globalThis.__piSessionMembership.files, b]) };
  await check;
  assert.equal(f.changes, 0, "the scan already lists b; the stale check must not bump");
  await f.check();
  assert.equal(f.changes, 0);
});

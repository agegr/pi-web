import assert from "node:assert/strict";
import { after, test } from "node:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createJiti } from "jiti";

const {
  SESSION_TRASH_RETENTION_MS,
  SessionTrashConflictError,
  collectSessionsForTrash,
  listTrashedSessions,
  moveSessionsToTrash,
  permanentlyDeleteTrashedSessions,
  purgeExpiredTrashedSessions,
  restoreTrashedSession,
} = await createJiti(import.meta.url).import("./session-trash.ts");

const root = mkdtempSync(join(tmpdir(), "pi-web-session-trash-test-"));
after(() => rmSync(root, { recursive: true, force: true }));

function fixture(name) {
  const base = join(root, name);
  const sessionsRoot = join(base, "sessions");
  const trashRoot = join(base, "trash");
  const projectDir = join(sessionsRoot, "project");
  mkdirSync(projectDir, { recursive: true });
  return { sessionsRoot, trashRoot, projectDir };
}

function session(projectDir, id, overrides = {}) {
  const path = join(projectDir, `${id}.jsonl`);
  const content = `${JSON.stringify({ type: "session", id, cwd: "/repo", timestamp: "2026-01-01T00:00:00.000Z" })}\n`;
  writeFileSync(path, content, "utf8");
  return {
    path,
    id,
    cwd: "/repo",
    name: undefined,
    created: "2026-01-01T00:00:00.000Z",
    modified: "2026-01-02T00:00:00.000Z",
    messageCount: 2,
    firstMessage: `${id} first message`,
    projectRoot: "/repo",
    projectKey: "/repo",
    ...overrides,
  };
}

test("collects the selected session and nested subagents without independent forks", () => {
  const sessions = [
    { id: "root" },
    { id: "child", relation: { kind: "subagent", parentSessionId: "root" } },
    { id: "nested", relation: { kind: "subagent", parentSessionId: "child" } },
    { id: "fork", relation: { kind: "fork", originSessionId: "root" } },
    { id: "other" },
  ];
  assert.deepEqual(
    collectSessionsForTrash(sessions, "root").map((item) => item.id),
    ["root", "child", "nested"],
  );
  assert.deepEqual(
    collectSessionsForTrash(sessions, "child").map((item) => item.id),
    ["child", "nested"],
  );
});

test("moves a session family to project-scoped trash and restores the original files", () => {
  const { sessionsRoot, trashRoot, projectDir } = fixture("restore");
  const main = session(projectDir, "main", { name: "Release plan" });
  const child = session(projectDir, "child", {
    relation: { kind: "subagent", parentSessionId: "main", profile: "worker", description: "check", status: "completed" },
  });
  const mainContent = readFileSync(main.path, "utf8");
  const childContent = readFileSync(child.path, "utf8");

  const trashed = moveSessionsToTrash(main, [main, child], {
    sessionsRoot,
    trashRoot,
    now: Date.parse("2026-02-01T00:00:00.000Z"),
  });

  assert.equal(existsSync(main.path), false);
  assert.equal(existsSync(child.path), false);
  assert.equal(trashed.title, "Release plan");
  assert.equal(trashed.sessionCount, 2);
  assert.equal(trashed.expiresAt, "2026-03-03T00:00:00.000Z");
  assert.deepEqual(listTrashedSessions("/other", { sessionsRoot, trashRoot }), []);
  assert.deepEqual(listTrashedSessions("/repo", { sessionsRoot, trashRoot }).map((item) => item.id), ["main"]);

  assert.deepEqual(restoreTrashedSession("main", { sessionsRoot, trashRoot }), ["main", "child"]);
  assert.equal(readFileSync(main.path, "utf8"), mainContent);
  assert.equal(readFileSync(child.path, "utf8"), childContent);
  assert.deepEqual(listTrashedSessions("/repo", { sessionsRoot, trashRoot }), []);
});

test("recovers interrupted trash and restore moves on the next access", () => {
  const trashFixture = fixture("recover-trash");
  const trashMain = session(trashFixture.projectDir, "main");
  const trashChild = session(trashFixture.projectDir, "child");
  moveSessionsToTrash(trashMain, [trashMain, trashChild], {
    sessionsRoot: trashFixture.sessionsRoot,
    trashRoot: trashFixture.trashRoot,
    now: 1,
  });
  const completedTrashDirectory = readdirSync(trashFixture.trashRoot)[0];
  renameSync(
    join(trashFixture.trashRoot, completedTrashDirectory),
    join(trashFixture.trashRoot, ".tmp-interrupted"),
  );
  assert.deepEqual(listTrashedSessions("/repo", { ...trashFixture, now: 30_000 }), []);
  assert.equal(existsSync(trashMain.path), false);
  assert.equal(existsSync(trashChild.path), false);
  assert.deepEqual(listTrashedSessions("/repo", { ...trashFixture, now: 60_001 }), []);
  assert.equal(existsSync(trashMain.path), true);
  assert.equal(existsSync(trashChild.path), true);

  const restoreFixture = fixture("recover-restore");
  const restoreMain = session(restoreFixture.projectDir, "main");
  const restoreChild = session(restoreFixture.projectDir, "child");
  moveSessionsToTrash(restoreMain, [restoreMain, restoreChild], {
    sessionsRoot: restoreFixture.sessionsRoot,
    trashRoot: restoreFixture.trashRoot,
    now: 1,
  });
  const restoreDirectory = join(restoreFixture.trashRoot, readdirSync(restoreFixture.trashRoot)[0]);
  const metadata = JSON.parse(readFileSync(join(restoreDirectory, "metadata.json"), "utf8"));
  renameSync(join(restoreDirectory, metadata.members[0].trashName), metadata.members[0].originalPath);
  assert.deepEqual(listTrashedSessions("/repo", restoreFixture), []);
  assert.equal(existsSync(restoreMain.path), true);
  assert.equal(existsSync(restoreChild.path), true);
});

test("does not overwrite a session file that appeared before restore", () => {
  const { sessionsRoot, trashRoot, projectDir } = fixture("conflict");
  const main = session(projectDir, "main");
  moveSessionsToTrash(main, [main], { sessionsRoot, trashRoot, now: 1 });
  writeFileSync(main.path, "replacement", "utf8");

  assert.throws(
    () => restoreTrashedSession("main", { sessionsRoot, trashRoot }),
    SessionTrashConflictError,
  );
  assert.equal(readFileSync(main.path, "utf8"), "replacement");
});

test("permanently deletes only the selected trash entries", () => {
  const { sessionsRoot, trashRoot, projectDir } = fixture("permanent");
  const first = session(projectDir, "first");
  const second = session(projectDir, "second");
  moveSessionsToTrash(first, [first], { sessionsRoot, trashRoot, now: 1 });
  moveSessionsToTrash(second, [second], { sessionsRoot, trashRoot, now: 2 });

  assert.deepEqual(
    permanentlyDeleteTrashedSessions(["first", "first"], { sessionsRoot, trashRoot }),
    ["first"],
  );
  assert.deepEqual(listTrashedSessions("/repo", { sessionsRoot, trashRoot }).map((item) => item.id), ["second"]);
  assert.equal(existsSync(first.path), false);
  assert.equal(existsSync(second.path), false);
});

test("permanent deletion re-parents active forks to the nearest surviving ancestor", () => {
  const { sessionsRoot, trashRoot, projectDir } = fixture("reparent");
  const parent = session(projectDir, "parent");
  const main = session(projectDir, "main");
  const fork = session(projectDir, "fork");
  writeFileSync(main.path, `${JSON.stringify({ type: "session", id: "main", cwd: "/repo", timestamp: "2026-01-01T00:00:00.000Z", parentSession: parent.path })}\n`, "utf8");
  writeFileSync(fork.path, `${JSON.stringify({ type: "session", id: "fork", cwd: "/repo", timestamp: "2026-01-01T00:00:00.000Z", parentSession: main.path })}\n`, "utf8");

  moveSessionsToTrash(main, [main], { sessionsRoot, trashRoot, now: 1 });
  permanentlyDeleteTrashedSessions(["main"], { sessionsRoot, trashRoot });

  const forkHeader = JSON.parse(readFileSync(fork.path, "utf8").split("\n")[0]);
  assert.equal(forkHeader.parentSession, parent.path);
});

test("automatic purge re-parents newer forks that are still in trash", () => {
  const { sessionsRoot, trashRoot, projectDir } = fixture("reparent-trashed-fork");
  const parent = session(projectDir, "parent");
  const main = session(projectDir, "main");
  const fork = session(projectDir, "fork", { relation: { kind: "fork", originSessionId: "main" } });
  writeFileSync(main.path, `${JSON.stringify({ type: "session", id: "main", cwd: "/repo", timestamp: "2026-01-01T00:00:00.000Z", parentSession: parent.path })}\n`, "utf8");
  writeFileSync(fork.path, `${JSON.stringify({ type: "session", id: "fork", cwd: "/repo", timestamp: "2026-01-01T00:00:00.000Z", parentSession: main.path })}\n`, "utf8");

  moveSessionsToTrash(fork, [fork], { sessionsRoot, trashRoot, now: SESSION_TRASH_RETENTION_MS - 1 });
  moveSessionsToTrash(main, [main], { sessionsRoot, trashRoot, now: 0 });
  assert.deepEqual(
    purgeExpiredTrashedSessions({ sessionsRoot, trashRoot, now: SESSION_TRASH_RETENTION_MS }),
    ["main"],
  );
  restoreTrashedSession("fork", { sessionsRoot, trashRoot });

  const forkHeader = JSON.parse(readFileSync(fork.path, "utf8").split("\n")[0]);
  assert.equal(forkHeader.parentSession, parent.path);
});

test("purges sessions at the 30-day boundary and not before", () => {
  const { sessionsRoot, trashRoot, projectDir } = fixture("expiry");
  const expired = session(projectDir, "expired");
  moveSessionsToTrash(expired, [expired], { sessionsRoot, trashRoot, now: 0 });

  assert.deepEqual(
    purgeExpiredTrashedSessions({ sessionsRoot, trashRoot, now: SESSION_TRASH_RETENTION_MS - 1 }),
    [],
  );
  assert.deepEqual(
    purgeExpiredTrashedSessions({ sessionsRoot, trashRoot, now: SESSION_TRASH_RETENTION_MS }),
    ["expired"],
  );
  assert.deepEqual(listTrashedSessions("/repo", { sessionsRoot, trashRoot }), []);
});

import assert from "node:assert/strict";
import { appendFileSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { SessionManager } from "@earendil-works/pi-coding-agent";

function header(id, cwd, parentSession) {
  return {
    type: "session",
    version: 3,
    id,
    timestamp: "2026-01-01T00:00:00.000Z",
    cwd,
    ...(parentSession ? { parentSession } : {}),
  };
}

function message(id, parentId, role, content, second = 1) {
  return {
    type: "message",
    id,
    parentId,
    timestamp: new Date(Date.UTC(2026, 0, 1, 0, 0, second)).toISOString(),
    message: {
      role,
      ...(role === "assistant" ? { provider: "fixture", model: "fixture" } : {}),
      content,
    },
  };
}

function writeSession(filePath, entries) {
  writeFileSync(filePath, `${entries.map((entry) => JSON.stringify(entry)).join("\n")}\n`, { mode: 0o600 });
}

test("SDK fixture discovery reflects external add, modify, delete, parent, and damaged-file changes", async (t) => {
  const directory = mkdtempSync(join(tmpdir(), "pi-web-session-sdk-fixture-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));

  const parentPath = join(directory, "parent.jsonl");
  const childPath = join(directory, "child.jsonl");
  const invalidPath = join(directory, "invalid.jsonl");
  writeSession(parentPath, [
    header("parent", "/tmp/pi-web-fixture/project-a"),
    message("parent-user", null, "user", "parent request"),
  ]);
  writeSession(childPath, [
    header("child", "/tmp/pi-web-fixture/project-b", parentPath),
    message("child-user", null, "user", [
      { type: "text", text: "child image request" },
      { type: "image", source: { type: "base64", media_type: "image/png", data: "QUJDRA==" } },
    ]),
  ]);
  writeSession(invalidPath, [message("invalid-user", null, "user", "missing header")]);

  let sessions = await SessionManager.listAll(directory);
  assert.deepEqual(sessions.map((session) => session.id).sort(), ["child", "parent"]);
  assert.equal(sessions.find((session) => session.id === "child")?.parentSessionPath, parentPath);
  assert.equal(sessions.find((session) => session.id === "child")?.firstMessage, "child image request");

  appendFileSync(parentPath, `${JSON.stringify(message("parent-answer", "parent-user", "assistant", "external answer", 2))}\n`);
  sessions = await SessionManager.listAll(directory);
  assert.equal(sessions.find((session) => session.id === "parent")?.messageCount, 2);

  const addedPath = join(directory, "added.jsonl");
  writeSession(addedPath, [
    header("added", "/tmp/pi-web-fixture/project-c"),
    message("added-user", null, "user", "externally added"),
  ]);
  sessions = await SessionManager.listAll(directory);
  assert.deepEqual(sessions.map((session) => session.id).sort(), ["added", "child", "parent"]);

  unlinkSync(childPath);
  sessions = await SessionManager.listAll(directory);
  assert.deepEqual(sessions.map((session) => session.id).sort(), ["added", "parent"]);
});

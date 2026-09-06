import assert from "node:assert/strict";
import {
  appendFileSync,
  mkdirSync,
  mkdtempSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";
import { SessionManager } from "@earendil-works/pi-coding-agent";

const jiti = createJiti(import.meta.url, { alias: { "@": process.cwd() } });
const {
  enumerateSessionFiles,
  equalSessionFingerprint,
  indexedSessionMetadata,
  parseIndexedSessionMetadata,
  reconcileSessionFiles,
  reconcileSessionPaths,
} = await jiti.import("./session-index-core.mts");

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

function message(id, parentId, role, content, second) {
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

function writeEntries(filePath, entries) {
  writeFileSync(filePath, `${entries.map((entry) => JSON.stringify(entry)).join("\n")}\n`, { mode: 0o600 });
}

function comparableSdkInfo(info) {
  return {
    path: info.path,
    id: info.id,
    cwd: info.cwd,
    name: info.name,
    created: info.created.toISOString(),
    modified: info.modified.toISOString(),
    messageCount: info.messageCount,
    firstMessage: info.firstMessage,
    parentSessionPath: info.parentSessionPath,
  };
}

test("global discovery matches SDK top-level directory and symlink scope", async (t) => {
  const directory = mkdtempSync(join(tmpdir(), "pi-web-index-core-discovery-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const projectDirectory = join(directory, "project-a");
  const externalDirectory = mkdtempSync(join(tmpdir(), "pi-web-index-core-linked-"));
  t.after(() => rmSync(externalDirectory, { recursive: true, force: true }));
  mkdirSync(projectDirectory);
  writeFileSync(join(projectDirectory, "a.jsonl"), "");
  writeFileSync(join(projectDirectory, "ignore.txt"), "");
  writeFileSync(join(externalDirectory, "linked.jsonl"), "");
  try {
    symlinkSync(externalDirectory, join(directory, "linked-project"), "dir");
  } catch (error) {
    if (process.platform === "win32") return;
    throw error;
  }

  assert.deepEqual(
    (await enumerateSessionFiles(directory)).sort(),
    [join(projectDirectory, "a.jsonl"), join(directory, "linked-project", "linked.jsonl")].sort(),
  );
});

test("single-file metadata projection matches the SDK list semantics", async (t) => {
  const directory = mkdtempSync(join(tmpdir(), "pi-web-index-core-sdk-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const parentPath = join(directory, "parent.jsonl");
  const filePath = join(directory, "child.jsonl");
  writeEntries(filePath, [
    header("child", "/tmp/project", parentPath),
    message("u1", null, "user", [
      { type: "image", source: { type: "base64", data: "AAAA" } },
      { type: "text", text: "first" },
      { type: "text", text: "request" },
    ], 2),
    message("tool", "u1", "toolResult", [{ type: "text", text: "tool output" }], 3),
    message("a1", "tool", "assistant", "answer", 4),
    { type: "session_info", id: "n1", parentId: "a1", timestamp: "2026-01-01T00:00:05.000Z", name: " old " },
    { type: "session_info", id: "n2", parentId: "n1", timestamp: "2026-01-01T00:00:06.000Z", name: " final " },
  ]);

  const sdk = (await SessionManager.listAll(directory)).map(comparableSdkInfo);
  const indexed = await parseIndexedSessionMetadata(filePath);
  assert.deepEqual(indexed, sdk[0]);
  assert.equal(indexed.messageCount, 3);
  assert.equal(indexed.firstMessage, "first request");
  assert.equal(indexed.modified, "2026-01-01T00:00:04.000Z");
});

test("子会话关系随文件指纹更新，热读取复用且不缓存任务正文", async (t) => {
  const directory = mkdtempSync(join(tmpdir(), "pi-web-index-subagent-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const filePath = join(directory, "child.jsonl");
  const entries = [
    header("child", "/tmp/project", join(directory, "missing-parent.jsonl")),
    { type: "custom", customType: "pi-web:subagent", data: {
      version: 1, parentSessionId: "parent", parentSessionPath: "/sessions/parent.jsonl",
      profile: "explore", description: "检查输入", task: "不得进入索引的任务正文",
      resourceSnapshot: { tools: ["read"] },
    } },
    message("u1", null, "user", "hello", 1),
  ];
  writeEntries(filePath, entries);
  const cold = await reconcileSessionFiles([filePath]);
  const relation = { parentSessionId: "parent", profile: "explore", description: "检查输入", status: "interrupted" };
  assert.deepEqual(cold.entries.get(filePath).metadata.subagent, relation);
  assert.doesNotMatch(JSON.stringify(cold.entries.get(filePath).metadata), /任务正文|resourceSnapshot/);
  const warm = await reconcileSessionFiles([filePath], cold.entries);
  assert.equal(warm.parsed, 0);
  assert.equal(warm.reused, 1);
  assert.equal(warm.entries.get(filePath), cold.entries.get(filePath));
  appendFileSync(filePath, JSON.stringify({ type: "custom", customType: "pi-web:subagent-result", data: {
    version: 1, status: "completed", result: "不得进入索引的结果正文",
  } }) + "\n");
  const updated = await reconcileSessionFiles([filePath], warm.entries);
  assert.equal(updated.parsed, 1);
  assert.deepEqual(updated.entries.get(filePath).metadata.subagent, { ...relation, status: "completed" });
  assert.equal(updated.entries.get(filePath).metadata.modified, "2026-01-01T00:00:01.000Z");
  assert.doesNotMatch(JSON.stringify(updated.entries.get(filePath).metadata), /结果正文/);
});

test("子会话索引遵循首个元数据和最后结果语义，不把未知状态当成完成", async (t) => {
  const directory = mkdtempSync(join(tmpdir(), "pi-web-index-subagent-invalid-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const filePath = join(directory, "child.jsonl");
  const meta = (data) => ({ type: "custom", customType: "pi-web:subagent", data });
  const result = (status) => ({ type: "custom", customType: "pi-web:subagent-result", data: { status } });
  const valid = { version: 1, parentSessionId: "parent", parentSessionPath: "/sessions/parent.jsonl" };
  for (const invalid of [null, { ...valid, version: 2 }, { ...valid, parentSessionId: 123 }, { ...valid, parentSessionPath: null }]) {
    writeEntries(filePath, [header("child", "/tmp/project"), meta(invalid), meta(valid), result("completed")]);
    assert.equal((await parseIndexedSessionMetadata(filePath)).subagent, undefined);
  }
  for (const status of ["failed", "aborted", "running", "future-status", null]) {
    writeEntries(filePath, [header("child", "/tmp/project"), meta(valid), meta({ ...valid, parentSessionId: "wrong" }), result("completed"), result(status)]);
    assert.deepEqual((await parseIndexedSessionMetadata(filePath)).subagent, {
      parentSessionId: "parent", profile: "general-purpose", description: "Subagent",
      status: status === "failed" || status === "aborted" ? status : "interrupted",
    });
  }
});

test("reconciliation reuses unchanged fingerprints and reparses only changed files", async (t) => {
  const directory = mkdtempSync(join(tmpdir(), "pi-web-index-core-reconcile-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const firstPath = join(directory, "first.jsonl");
  const secondPath = join(directory, "second.jsonl");
  writeEntries(firstPath, [header("first", "/tmp/a"), message("u1", null, "user", "one", 1)]);
  writeEntries(secondPath, [header("second", "/tmp/b"), message("u2", null, "user", "two", 1)]);

  const cold = await reconcileSessionFiles([firstPath, secondPath]);
  assert.deepEqual(
    { parsed: cold.parsed, reused: cold.reused, removed: cold.removed, unstable: cold.unstable },
    { parsed: 2, reused: 0, removed: 0, unstable: 0 },
  );

  const warm = await reconcileSessionFiles([firstPath, secondPath], cold.entries);
  assert.deepEqual(
    { parsed: warm.parsed, reused: warm.reused, removed: warm.removed, unstable: warm.unstable },
    { parsed: 0, reused: 2, removed: 0, unstable: 0 },
  );
  assert.equal(warm.entries.get(firstPath), cold.entries.get(firstPath));

  appendFileSync(firstPath, `${JSON.stringify(message("a1", "u1", "assistant", "done", 2))}\n`);
  const changed = await reconcileSessionFiles([firstPath, secondPath], warm.entries);
  assert.deepEqual(
    { parsed: changed.parsed, reused: changed.reused, removed: changed.removed, unstable: changed.unstable },
    { parsed: 1, reused: 1, removed: 0, unstable: 0 },
  );
  assert.equal(changed.entries.get(firstPath)?.metadata?.messageCount, 2);
  assert.equal(changed.entries.get(secondPath), warm.entries.get(secondPath));

  const removed = await reconcileSessionFiles([firstPath], changed.entries);
  assert.equal(removed.removed, 1);
  assert.equal(removed.entries.has(secondPath), false);
});

test("targeted reconciliation patches only requested paths and preserves the rest", async (t) => {
  const directory = mkdtempSync(join(tmpdir(), "pi-web-index-core-targeted-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const firstPath = join(directory, "first.jsonl");
  const secondPath = join(directory, "second.jsonl");
  writeEntries(firstPath, [header("first", "/tmp/a"), message("u1", null, "user", "one", 1)]);
  writeEntries(secondPath, [header("second", "/tmp/b"), message("u2", null, "user", "two", 1)]);
  const cold = await reconcileSessionFiles([firstPath, secondPath]);

  appendFileSync(firstPath, `${JSON.stringify(message("a1", "u1", "assistant", "done", 2))}\n`);
  const changed = await reconcileSessionPaths([firstPath], cold.entries);
  assert.equal(changed.parsed, 1);
  assert.equal(changed.entries.get(firstPath)?.metadata?.messageCount, 2);
  assert.equal(changed.entries.get(secondPath), cold.entries.get(secondPath));

  rmSync(firstPath);
  const removed = await reconcileSessionPaths([firstPath], changed.entries);
  assert.equal(removed.removed, 1);
  assert.equal(removed.entries.has(firstPath), false);
  assert.equal(removed.entries.get(secondPath), cold.entries.get(secondPath));
});

test("atomic replacement changes file identity even when the path remains stable", async (t) => {
  const directory = mkdtempSync(join(tmpdir(), "pi-web-index-core-replace-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const filePath = join(directory, "session.jsonl");
  const replacementPath = join(directory, "replacement.tmp");
  writeEntries(filePath, [header("session", "/tmp/a"), message("u1", null, "user", "before", 1)]);
  const first = await reconcileSessionFiles([filePath]);

  writeEntries(replacementPath, [header("session", "/tmp/a"), message("u1", null, "user", "after replacement", 1)]);
  renameSync(replacementPath, filePath);
  const replaced = await reconcileSessionFiles([filePath], first.entries);
  assert.equal(replaced.parsed, 1);
  assert.equal(replaced.entries.get(filePath)?.metadata?.firstMessage, "after replacement");
  assert.equal(
    equalSessionFingerprint(
      first.entries.get(filePath).fingerprint,
      replaced.entries.get(filePath).fingerprint,
    ),
    false,
  );
});

test("invalid sessions are negatively cached until their fingerprint changes", async (t) => {
  const directory = mkdtempSync(join(tmpdir(), "pi-web-index-core-invalid-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const filePath = join(directory, "invalid.jsonl");
  writeFileSync(filePath, "{broken}\n" + JSON.stringify(message("u1", null, "user", "missing header", 1)) + "\n");

  const cold = await reconcileSessionFiles([filePath]);
  assert.equal(cold.parsed, 1);
  assert.equal(cold.entries.get(filePath)?.metadata, null);
  assert.deepEqual(indexedSessionMetadata(cold.entries), []);

  const warm = await reconcileSessionFiles([filePath], cold.entries);
  assert.equal(warm.parsed, 0);
  assert.equal(warm.reused, 1);

  writeEntries(filePath, [header("valid", "/tmp/project"), message("u1", null, "user", "recovered", 1)]);
  const recovered = await reconcileSessionFiles([filePath], warm.entries);
  assert.equal(recovered.parsed, 1);
  assert.equal(recovered.entries.get(filePath)?.metadata?.id, "valid");
});

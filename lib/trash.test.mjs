// 回收站逻辑测试：通过 PI_CODING_AGENT_DIR 将 agent 目录隔离到临时目录，不污染真实数据。
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
async function loadSubject() {
  return jiti.import("./trash.ts");
}

// 每个测试用例独立的临时 agent 目录，返回清理函数
function makeAgentDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-web-trash-test-"));
  process.env.PI_CODING_AGENT_DIR = dir;
  t.after(() => {
    fs.rmSync(dir, { recursive: true, force: true });
    delete process.env.PI_CODING_AGENT_DIR;
  });
  return dir;
}

// 构造一个真实结构的会话文件（sessions/--编码cwd--/ 下）
function makeSession(agentDir, cwd, id, title) {
  const safePath = `--${cwd.replace(/^[/\\]/, "").replace(/[/\\:]/g, "-")}--`;
  const sessionDir = path.join(agentDir, "sessions", safePath);
  fs.mkdirSync(sessionDir, { recursive: true });
  const fileName = `2025-07-01T00-00-00-000Z_${id}.jsonl`;
  const filePath = path.join(sessionDir, fileName);
  fs.writeFileSync(filePath, [
    JSON.stringify({ type: "session", version: 3, id, timestamp: "2025-07-01T00:00:00Z", cwd, parentSession: null }),
    JSON.stringify({ type: "message", id: "m1", parentId: null, timestamp: "2025-07-01T00:00:00Z", message: { role: "user", content: title } }),
    JSON.stringify({ type: "message", id: "m2", parentId: "m1", timestamp: "2025-07-01T00:00:01Z", message: { role: "assistant", content: "reply" } }),
    "",
  ].join("\n"));
  return filePath;
}

test("删除进回收站：文件移入 trash，标题/目录/时间可读", async (t) => {
  const { trashSessionFile, listTrashedSessions, getTrashDir } = await loadSubject();
  const agentDir = makeAgentDir(t);
  const filePath = makeSession(agentDir, "/tmp/proj-a", "id-1", "标题甲");

  trashSessionFile(filePath);
  assert.equal(fs.existsSync(filePath), false);
  const files = fs.readdirSync(getTrashDir());
  assert.equal(files.length, 1);
  assert.match(files[0], /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z_2025-07-01T00-00-00-000Z_id-1\.jsonl$/);

  const list = listTrashedSessions();
  assert.equal(list.length, 1);
  assert.equal(list[0].sessionId, "id-1");
  assert.equal(list[0].title, "标题甲");
  assert.equal(list[0].cwd, "/tmp/proj-a");
  assert.equal(list[0].originalName, "2025-07-01T00-00-00-000Z_id-1.jsonl");
  // modified 来自文件 mtime（真实时间，非 2025-07-01）
  assert.ok(list[0].modified > Date.now() - 60_000);
});

test("恢复：回到原会话目录并还原文件名", async (t) => {
  const { trashSessionFile, listTrashedSessions, restoreTrashedSession } = await loadSubject();
  const agentDir = makeAgentDir(t);
  const filePath = makeSession(agentDir, "/tmp/proj-b", "id-2", "标题乙");

  trashSessionFile(filePath);
  const { restoredPath, sessionId } = restoreTrashedSession(listTrashedSessions()[0].fileName);
  assert.equal(sessionId, "id-2");
  assert.equal(restoredPath, filePath);
  assert.equal(fs.existsSync(restoredPath), true);
  assert.equal(fs.readdirSync(path.join(agentDir, "sessions", "--tmp-proj-b--")).length, 1);
});

test("恢复冲突：原位置已有同名文件时拒绝恢复", async (t) => {
  const { trashSessionFile, listTrashedSessions, restoreTrashedSession } = await loadSubject();
  const agentDir = makeAgentDir(t);
  const filePath = makeSession(agentDir, "/tmp/proj-c", "id-3", "标题丙");

  trashSessionFile(filePath);
  // 在原位置放回一个同名文件，模拟冲突
  fs.mkdirSync(path.join(agentDir, "sessions", "--tmp-proj-c--"), { recursive: true });
  fs.writeFileSync(filePath, "conflict");
  assert.throws(() => restoreTrashedSession(listTrashedSessions()[0].fileName), /已存在同名会话/);
  // 回收站中的原文件未被破坏
  assert.equal(listTrashedSessions().length, 1);
});

test("彻底删除：文件被删除且列表为空", async (t) => {
  const { trashSessionFile, listTrashedSessions, purgeTrashedSession, getTrashDir } = await loadSubject();
  const agentDir = makeAgentDir(t);
  const filePath = makeSession(agentDir, "/tmp/proj-d", "id-4", "标题丁");

  trashSessionFile(filePath);
  purgeTrashedSession(listTrashedSessions()[0].fileName);
  assert.equal(fs.readdirSync(getTrashDir()).length, 0);
});
test("彻底删除：文件被删除且列表为空", async (t) => {
  const { trashSessionFile, listTrashedSessions, purgeTrashedSession, getTrashDir } = await loadSubject();
  const agentDir = makeAgentDir(t);
  const filePath = makeSession(agentDir, "/tmp/proj-d", "id-4", "标题丁");

  trashSessionFile(filePath);
  purgeTrashedSession(listTrashedSessions()[0].fileName);
  assert.equal(fs.readdirSync(getTrashDir()).length, 0);
});

test("清空回收站：全部会话被删除，非 jsonl 文件保留", async (t) => {
  const { trashSessionFile, clearTrashedSessions, getTrashDir } = await loadSubject();
  const agentDir = makeAgentDir(t);
  // 3 个会话 + 1 个手动放入的非 jsonl 文件
  for (let i = 0; i < 3; i++) trashSessionFile(makeSession(agentDir, `/tmp/proj-d${i}`, `id-c${i}`, `标题${i}`));
  fs.mkdirSync(getTrashDir(), { recursive: true });
  fs.writeFileSync(path.join(getTrashDir(), "keep.txt"), "keep");

  const removed = clearTrashedSessions();
  assert.equal(removed, 3);
  const remaining = fs.readdirSync(getTrashDir());
  assert.deepEqual(remaining, ["keep.txt"]);
});

test("路径穿越防护：非法文件名被拒绝", async (t) => {
  const { purgeTrashedSession, restoreTrashedSession } = await loadSubject();
  makeAgentDir(t);
  assert.throws(() => purgeTrashedSession("../escape.jsonl"), /Invalid trash file name/);
  assert.throws(() => purgeTrashedSession("a/b.jsonl"), /Invalid trash file name/);
  assert.throws(() => purgeTrashedSession("not-jsonl.txt"), /Invalid trash file name/);
  assert.throws(() => restoreTrashedSession("../escape.jsonl"), /Invalid trash file name/);
});
test("相对路径 cwd：恢复被拒绝", async (t) => {
  const { restoreTrashedSession, getTrashDir } = await loadSubject();
  makeAgentDir(t);
  fs.mkdirSync(getTrashDir(), { recursive: true });
  fs.writeFileSync(path.join(getTrashDir(), "2025-07-01T00-00-00-000Z_rel.jsonl"), [
    JSON.stringify({ type: "session", version: 3, id: "id-rel", timestamp: "2025-07-01T00:00:00Z", cwd: "relative/path", parentSession: null }),
    "",
  ].join("\n"));
  assert.throws(() => restoreTrashedSession("2025-07-01T00-00-00-000Z_rel.jsonl"), /非绝对路径/);
});

test("损坏文件：无 header 的文件被列表跳过，恢复报错", async (t) => {
  const { listTrashedSessions, getTrashDir, restoreTrashedSession } = await loadSubject();
  makeAgentDir(t);
  fs.mkdirSync(getTrashDir(), { recursive: true });
  fs.writeFileSync(path.join(getTrashDir(), "2025-07-01T00-00-00-000Z_broken.jsonl"), "not json at all\n");
  assert.equal(listTrashedSessions().length, 0);
  assert.throws(() => restoreTrashedSession("2025-07-01T00-00-00-000Z_broken.jsonl"), /无法读取会话信息/);
});

test("无前缀手动文件：也能列出并恢复", async (t) => {
  const { listTrashedSessions, restoreTrashedSession, getTrashDir } = await loadSubject();
  const agentDir = makeAgentDir(t);
  fs.mkdirSync(getTrashDir(), { recursive: true });
  // 手动放入回收站、无时间戳前缀的文件
  const sessionDir = path.join(agentDir, "sessions", "--tmp-proj-e--");
  fs.mkdirSync(sessionDir, { recursive: true });
  fs.writeFileSync(path.join(getTrashDir(), "manual-2025-07-02T00-00-00-000Z_id-5.jsonl"), [
    JSON.stringify({ type: "session", version: 3, id: "id-5", timestamp: "2025-07-02T00:00:00Z", cwd: "/tmp/proj-e", parentSession: null }),
    JSON.stringify({ type: "message", id: "m1", parentId: null, timestamp: "2025-07-02T00:00:00Z", message: { role: "user", content: "手动放入" } }),
    "",
  ].join("\n"));

  const list = listTrashedSessions();
  assert.equal(list.length, 1);
  assert.equal(list[0].originalName, "manual-2025-07-02T00-00-00-000Z_id-5.jsonl");
  const { restoredPath } = restoreTrashedSession(list[0].fileName);
  assert.equal(restoredPath, path.join(sessionDir, "manual-2025-07-02T00-00-00-000Z_id-5.jsonl"));
});

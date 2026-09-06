import assert from "node:assert/strict";
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";
import packageJson from "../package.json" with { type: "json" };

const jiti = createJiti(import.meta.url, { alias: { "@": process.cwd() } });
const {
  SESSION_INDEX_PROJECTION_VERSION,
  createSessionIndexCoordinator,
} = await jiti.import("./session-index.ts");

function writeSession(filePath) {
  writeFileSync(filePath, [
    JSON.stringify({
      type: "session",
      version: 3,
      id: "session",
      timestamp: "2026-01-01T00:00:00.000Z",
      cwd: "/tmp/project",
    }),
    JSON.stringify({
      type: "message",
      id: "user",
      parentId: null,
      timestamp: "2026-01-01T00:00:01.000Z",
      message: { role: "user", content: "request" },
    }),
    "",
  ].join("\n"), { mode: 0o600 });
}

test("列表和轻量元数据从同一索引恢复子会话关系及孤立 fork", async (t) => {
  const agentDirectory = mkdtempSync(join(tmpdir(), "pi-web-session-index-relations-"));
  const originalAgentDir = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = agentDirectory;
  t.after(async () => {
    await globalThis.__piSessionIndexState?.coordinator.waitForPersistence();
    delete globalThis.__piSessionIndexState;
    delete globalThis.__piSessionListCache;
    delete globalThis.__piSessionPathCache;
    delete globalThis.__piPathToSessionIdCache;
    if (originalAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = originalAgentDir;
    rmSync(agentDirectory, { recursive: true, force: true });
  });
  const directory = join(agentDirectory, "sessions", "project");
  mkdirSync(directory, { recursive: true });
  for (const id of ["child", "fork"]) {
    const entries = [{ type: "session", version: 3, id, timestamp: "2026-01-01T00:00:00.000Z", cwd: agentDirectory, parentSession: join(directory, "missing.jsonl") }];
    if (id === "child") entries.push({ type: "custom", customType: "pi-web:subagent", data: { version: 1, parentSessionId: "missing", parentSessionPath: join(directory, "missing.jsonl"), profile: "explore", description: "检查" } });
    entries.push({ type: "message", id: "u1", parentId: null, timestamp: "2026-01-01T00:00:01.000Z", message: { role: "user", content: "hello" } });
    writeFileSync(join(directory, `${id}.jsonl`), entries.map(x => JSON.stringify(x)).join("\n") + "\n");
  }
  const reader = await jiti.import("./session-reader.ts");
  const sessions = await reader.listAllSessions();
  assert.equal(sessions.length, 2);
  const expected = { kind: "subagent", parentSessionId: "missing", profile: "explore", description: "检查", status: "interrupted" };
  const child = sessions.find(x => x.id === "child");
  assert.deepEqual(child.relation, expected);
  assert.equal(child.parentSessionId, "missing");
  const meta = await reader.getIndexedSessionInfoById("child");
  assert.deepEqual(meta.relation, expected);
  assert.equal(meta.parentSessionId, "missing");
  assert.deepEqual(sessions.find(x => x.id === "fork").relation, { kind: "fork" });
  assert.deepEqual((await reader.getIndexedSessionInfoById("fork")).relation, { kind: "fork" });
  assert.equal(await reader.getIndexedSessionInfoById("absent"), null);
  const source = readFileSync(new URL("./session-reader.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /listSessionsIncremental|readSessionRelationEntries/);
  assert.equal(source.match(/async function loadAllSessions\(/g)?.length, 1);
});

test("后台校验合并重复请求，并在外部文件变化后失效列表缓存", async (t) => {
  const agentDirectory = mkdtempSync(join(tmpdir(), "pi-web-session-index-background-"));
  const originalAgentDir = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = agentDirectory;
  t.after(async () => {
    await globalThis.__piSessionIndexState?.backgroundValidation;
    await globalThis.__piSessionIndexState?.coordinator.waitForPersistence();
    delete globalThis.__piSessionIndexState;
    delete globalThis.__piSessionListCache;
    delete globalThis.__piSessionPathCache;
    delete globalThis.__piPathToSessionIdCache;
    if (originalAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = originalAgentDir;
    rmSync(agentDirectory, { recursive: true, force: true });
  });
  const directory = join(agentDirectory, "sessions", "project");
  mkdirSync(directory, { recursive: true });
  const filePath = join(directory, "session.jsonl");
  writeSession(filePath);
  const reader = await jiti.import("./session-reader.ts");
  const index = await jiti.import("./session-index.ts");
  const first = await reader.listAllSessions();
  assert.equal(first[0].messageCount, 1);
  const version = reader.getSessionListVersion();
  const state = globalThis.__piSessionIndexState;
  // Advance only the scheduling clock; never invalidate the file manually.
  appendFileSync(filePath, JSON.stringify({ type: "message", id: "a1", parentId: "user", timestamp: "2026-01-01T00:00:02.000Z", message: { role: "assistant", content: "external answer" } }) + "\n");
  const originalNow = Date.now;
  try {
    Date.now = () => originalNow() + 31_000;
    index.refreshSessionIndexInBackground();
    const pending = state.backgroundValidation;
    assert.ok(pending);
    index.refreshSessionIndexInBackground();
    assert.equal(state.backgroundValidation, pending);
    await pending;
    assert.ok(reader.getSessionListVersion() > version);
    assert.equal(globalThis.__piSessionListCache, undefined);
    const second = await reader.listAllSessions();
    assert.equal(second[0].messageCount, 2);
    const refreshedVersion = reader.getSessionListVersion();
    index.refreshSessionIndexInBackground();
    assert.equal(state.backgroundValidation, undefined, "周期内不能重复校验");
    assert.equal(reader.getSessionListVersion(), refreshedVersion);
  } finally {
    Date.now = originalNow;
  }
});

test("运行态只覆盖同一归属的子会话状态，磁盘身份和名称仍权威", async () => {
  const { mergeSessionLists } = await jiti.import("./session-reader.ts");
  const disk = {
    path: "/sessions/child.jsonl", id: "child", cwd: "/project", name: "磁盘名称",
    created: "2026-01-01T00:00:00.000Z", modified: "2026-01-01T00:00:01.000Z",
    messageCount: 1, firstMessage: "hello", transient: false,
    relation: { kind: "subagent", parentSessionId: "parent", profile: "explore", description: "检查", status: "interrupted" },
  };
  const live = { ...disk, path: "", name: "旧名称", transient: true,
    relation: { ...disk.relation, status: "running", description: "旧描述" } };
  assert.deepEqual(mergeSessionLists([disk], [live]), [{ ...disk, relation: { ...disk.relation, status: "running" } }]);
  assert.equal(disk.relation.status, "interrupted", "不能修改索引缓存中的关系对象");
  assert.deepEqual(mergeSessionLists([disk], [{ ...live, relation: { ...live.relation, parentSessionId: "other" } }]), [disk]);
  assert.deepEqual(mergeSessionLists([disk], [{ ...live, relation: { kind: "fork" } }]), [disk]);
});

test("projection version is pinned to the installed SDK dependency", () => {
  assert.match(
    SESSION_INDEX_PROJECTION_VERSION,
    new RegExp(`sdk-${packageJson.dependencies["@earendil-works/pi-coding-agent"].replaceAll(".", "\\.")}$`),
  );
});

test("session index coordinator persists a reusable worker snapshot and refreshes changes", async (t) => {
  const agentDirectory = mkdtempSync(join(tmpdir(), "pi-web-session-index-"));
  t.after(() => rmSync(agentDirectory, { recursive: true, force: true }));
  const projectDirectory = join(agentDirectory, "sessions", "project");
  mkdirSync(projectDirectory, { recursive: true });
  const filePath = join(projectDirectory, "session.jsonl");
  writeSession(filePath);

  const originalSessionContent = readFileSync(filePath, "utf8");
  const firstCoordinator = createSessionIndexCoordinator(agentDirectory);
  const first = await firstCoordinator.getSnapshot();
  assert.equal(first.get(filePath)?.metadata?.messageCount, 1);
  await firstCoordinator.waitForPersistence();

  const restartedCoordinator = createSessionIndexCoordinator(agentDirectory);
  const restarted = await restartedCoordinator.getSnapshot();
  assert.equal(restarted.get(filePath)?.metadata?.firstMessage, "request");

  appendFileSync(filePath, `${JSON.stringify({
    type: "message",
    id: "assistant",
    parentId: "user",
    timestamp: "2026-01-01T00:00:02.000Z",
    message: { role: "assistant", provider: "test", model: "test", content: "answer" },
  })}\n`);
  const refreshed = await restartedCoordinator.forceRefresh();
  assert.equal(refreshed.get(filePath)?.metadata?.messageCount, 2);
  await restartedCoordinator.waitForPersistence();
  assert.equal(readFileSync(filePath, "utf8").startsWith(originalSessionContent), true);

  const indexPath = join(agentDirectory, "cache", "pi-web", "session-index-v1.json");
  writeFileSync(indexPath, "{truncated", { mode: 0o600 });
  const rebuiltCoordinator = createSessionIndexCoordinator(agentDirectory);
  const rebuilt = await rebuiltCoordinator.getSnapshot();
  assert.equal(rebuilt.get(filePath)?.metadata?.messageCount, 2);
  await rebuiltCoordinator.waitForPersistence();
  assert.doesNotThrow(() => JSON.parse(readFileSync(indexPath, "utf8")));
});

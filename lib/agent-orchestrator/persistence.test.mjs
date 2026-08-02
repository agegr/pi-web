// agent-orchestrator 持久化单测：node --test --experimental-strip-types
// 验证快照 upsert / 读取 / 排序 / 清空；使用独立临时目录隔离。
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.PI_CODING_AGENT_DIR = mkdtempSync(join(tmpdir(), "pi-persist-"));
process.once("exit", () => {
  try {
    rmSync(process.env.PI_CODING_AGENT_DIR, { recursive: true, force: true });
  } catch {
    // ignore
  }
});

const {
  saveOrchestratorSnapshot,
  loadAllOrchestratorSnapshots,
  clearOrchestratorSnapshots,
  removeOrchestratorSnapshot,
} = await import("./persistence.ts");

test("save 后 load 可还原（含快照内容）", () => {
  const snap = {
    id: "orch_a",
    updatedAt: 100,
    status: "awaiting_confirm",
    messages: [{ id: "m1" }],
  };
  saveOrchestratorSnapshot(snap);
  const all = loadAllOrchestratorSnapshots();
  assert.equal(all.length, 1);
  assert.equal(all[0].id, "orch_a");
  assert.deepEqual(all[0].snapshot, snap);
});

test("upsert 按 id 原地更新，不新增记录", () => {
  const v1 = { id: "orch_b", updatedAt: 200, status: "discussing" };
  const v2 = { id: "orch_b", updatedAt: 300, status: "awaiting_confirm" };
  saveOrchestratorSnapshot(v1);
  saveOrchestratorSnapshot(v2);
  const all = loadAllOrchestratorSnapshots();
  const b = all.find((r) => r.id === "orch_b");
  assert.equal(all.filter((r) => r.id === "orch_b").length, 1);
  assert.equal(b.snapshot.status, "awaiting_confirm");
  assert.equal(b.updatedAt, 300);
});

test("按 updatedAt 升序返回", () => {
  clearOrchestratorSnapshots();
  saveOrchestratorSnapshot({ id: "x", updatedAt: 500 });
  saveOrchestratorSnapshot({ id: "y", updatedAt: 400 });
  saveOrchestratorSnapshot({ id: "z", updatedAt: 600 });
  const order = loadAllOrchestratorSnapshots().map((r) => r.id);
  assert.deepEqual(order, ["y", "x", "z"]);
});

test("clear 后返回空", () => {
  saveOrchestratorSnapshot({ id: "w", updatedAt: 700 });
  assert.ok(loadAllOrchestratorSnapshots().length >= 1);
  clearOrchestratorSnapshots();
  assert.deepEqual(loadAllOrchestratorSnapshots(), []);
});

test("removeOrchestratorSnapshot 删指定 id，其他记录保留", () => {
  clearOrchestratorSnapshots();
  saveOrchestratorSnapshot({ id: "keep-1", updatedAt: 1, status: "done" });
  saveOrchestratorSnapshot({ id: "delete-me", updatedAt: 2, status: "cancelled" });
  saveOrchestratorSnapshot({ id: "keep-2", updatedAt: 3, status: "awaiting_confirm" });
  const before = loadAllOrchestratorSnapshots();
  assert.equal(before.length, 3);

  const r = removeOrchestratorSnapshot("delete-me");
  assert.equal(r.removedCount, 1);
  assert.equal(r.remaining, 2);

  const after = loadAllOrchestratorSnapshots();
  assert.equal(after.length, 2);
  assert.deepEqual(after.map((x) => x.id).sort(), ["keep-1", "keep-2"]);
  // 完整快照内容保留（确保重写未损坏其他条目）
  assert.equal(after.find((x) => x.id === "keep-1").snapshot.status, "done");
  assert.equal(after.find((x) => x.id === "keep-2").snapshot.status, "awaiting_confirm");
});

test("removeOrchestratorSnapshot 幂等：不存在 id 返回 removedCount=0 不抛错", () => {
  clearOrchestratorSnapshots();
  saveOrchestratorSnapshot({ id: "only-one", updatedAt: 1 });
  // 不存在的 id
  const r = removeOrchestratorSnapshot("never-existed");
  assert.equal(r.removedCount, 0);
  assert.equal(r.remaining, 1);
  // 空字符串也走幂等路径
  const r2 = removeOrchestratorSnapshot("");
  assert.equal(r2.removedCount, 0);
  assert.equal(r2.remaining, 0);
  // 原记录仍在
  assert.equal(loadAllOrchestratorSnapshots().length, 1);
});

test("removeOrchestratorSnapshot 文件缺失时也返回零进度（best-effort）", () => {
  clearOrchestratorSnapshots();
  // 全部清空后 storeFilePath 已不存在
  const r = removeOrchestratorSnapshot("any-id");
  assert.equal(r.removedCount, 0);
  assert.equal(r.remaining, 0);
});

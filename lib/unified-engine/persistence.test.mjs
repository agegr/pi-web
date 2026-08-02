// 引擎运行态持久化单测：node --test --experimental-strip-types
// 验证 upsert / 读取 / 清空；使用独立临时目录隔离。
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.PI_CODING_AGENT_DIR = mkdtempSync(join(tmpdir(), "pi-engine-persist-"));
process.once("exit", () => {
  try {
    rmSync(process.env.PI_CODING_AGENT_DIR, { recursive: true, force: true });
  } catch {
    // ignore
  }
});

const { saveEngineRun, loadAllEngineRuns, clearEngineRuns } = await import("./persistence.ts");

const makeRun = (id, stage, status, updatedAt) => ({
  runId: id,
  changeName: `change-${id}`,
  requirementId: "req",
  title: `运行 ${id}`,
  stage,
  status,
  tasks: [],
  cwd: "/tmp",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt,
});

test("save 后 load 可还原运行态", () => {
  const run = makeRun("r1", "build", "running", "2026-01-01T01:00:00.000Z");
  saveEngineRun(run);
  const all = loadAllEngineRuns();
  assert.equal(all.length, 1);
  assert.equal(all[0].id, "r1");
  assert.deepEqual(all[0].run, run);
});

test("upsert 按 runId 原地更新", () => {
  saveEngineRun(makeRun("r2", "design", "running", "2026-01-01T02:00:00.000Z"));
  saveEngineRun(makeRun("r2", "archive", "completed", "2026-01-01T03:00:00.000Z"));
  const all = loadAllEngineRuns();
  assert.equal(all.filter((r) => r.id === "r2").length, 1);
  assert.equal(all.find((r) => r.id === "r2").run.status, "completed");
});

test("loadAll 按 updatedAt 升序", () => {
  clearEngineRuns();
  saveEngineRun(makeRun("a", "open", "idle", "2026-01-01T05:00:00.000Z"));
  saveEngineRun(makeRun("b", "open", "idle", "2026-01-01T04:00:00.000Z"));
  saveEngineRun(makeRun("c", "open", "idle", "2026-01-01T06:00:00.000Z"));
  const order = loadAllEngineRuns().map((r) => r.id);
  assert.deepEqual(order, ["b", "a", "c"]);
});

test("clear 后返回空", () => {
  saveEngineRun(makeRun("z", "open", "idle", "2026-01-01T07:00:00.000Z"));
  assert.ok(loadAllEngineRuns().length >= 1);
  clearEngineRuns();
  assert.deepEqual(loadAllEngineRuns(), []);
});

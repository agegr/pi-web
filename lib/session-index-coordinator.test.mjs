import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { alias: { "@": process.cwd() } });
const { SessionIndexCoordinator } = await jiti.import("./session-index-coordinator.ts");

function entries(id) {
  return new Map([[`/${id}.jsonl`, {
    fingerprint: { size: "1", mtimeNs: "1", ctimeNs: "1", dev: "1", ino: "1" },
    metadata: {
      path: `/${id}.jsonl`,
      id,
      cwd: "/tmp",
      created: "2026-01-01T00:00:00.000Z",
      modified: "2026-01-01T00:00:00.000Z",
      messageCount: 0,
      firstMessage: "(no messages)",
    },
  }]]);
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
}

test("startup may return an unverified persisted snapshot before reconciliation", async () => {
  const reconciliation = deferred();
  const persisted = [];
  const coordinator = new SessionIndexCoordinator(
    async (onSnapshot) => {
      onSnapshot(entries("persisted"));
      return reconciliation.promise;
    },
    async (value) => { persisted.push([...value.keys()]); },
  );

  const startup = await coordinator.getSnapshot();
  assert.deepEqual([...startup.keys()], ["/persisted.jsonl"]);
  assert.equal(coordinator.getVerifiedSnapshot(), null);
  let securitySnapshotResolved = false;
  const securitySnapshot = coordinator.getVerifiedSnapshotOrRefresh().then((value) => {
    securitySnapshotResolved = true;
    return value;
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(securitySnapshotResolved, false);

  reconciliation.resolve({ entries: entries("verified") });
  assert.deepEqual([...(await securitySnapshot).keys()], ["/verified.jsonl"]);
  await reconciliation.promise;
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual([...coordinator.getVerifiedSnapshot().keys()], ["/verified.jsonl"]);
  await coordinator.waitForPersistence();
  assert.deepEqual(persisted, [["/verified.jsonl"]]);
});

test("a stale refresh cannot publish or persist after invalidation", async () => {
  const runs = [deferred(), deferred()];
  let refreshCount = 0;
  const persisted = [];
  const coordinator = new SessionIndexCoordinator(
    async () => runs[refreshCount++].promise,
    async (value) => { persisted.push([...value.keys()]); },
  );

  const requested = coordinator.getSnapshot();
  coordinator.invalidate();
  runs[0].resolve({ entries: entries("stale") });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(refreshCount, 2);
  runs[1].resolve({ entries: entries("current") });

  const snapshot = await requested;
  assert.deepEqual([...snapshot.keys()], ["/current.jsonl"]);
  assert.deepEqual([...coordinator.getVerifiedSnapshot().keys()], ["/current.jsonl"]);
  await coordinator.waitForPersistence();
  assert.deepEqual(persisted, [["/current.jsonl"]]);
});

test("仅已接纳且指纹变化的快照发出通知，重复快照和旧代次不通知", async () => {
  let current = entries("one");
  let notifications = 0;
  const coordinator = new SessionIndexCoordinator(
    async () => ({ entries: current }), async () => {}, 0, () => { notifications += 1; },
  );
  await coordinator.getVerifiedSnapshotOrRefresh();
  assert.equal(notifications, 1);
  current = entries("one");
  await coordinator.getVerifiedSnapshotOrRefresh();
  assert.equal(notifications, 1, "同指纹的新 Map 不代表数据变化");
  current = entries("one");
  current.get("/one.jsonl").fingerprint.mtimeNs = "2";
  await coordinator.getVerifiedSnapshotOrRefresh();
  assert.equal(notifications, 2, "元数据相同但文件变化仍应通知搜索等消费者");
  current = new Map();
  await coordinator.getVerifiedSnapshotOrRefresh();
  assert.equal(notifications, 3, "删除必须推进版本");
  await coordinator.waitForPersistence();

  const runs = [deferred(), deferred()];
  let refreshes = 0;
  let accepted = 0;
  const raced = new SessionIndexCoordinator(
    async () => runs[refreshes++].promise, async () => {}, 0, () => { accepted += 1; },
  );
  const initial = raced.getSnapshot();
  raced.invalidate();
  runs[0].resolve({ entries: entries("stale") });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(accepted, 0);
  runs[1].resolve({ entries: entries("current") });
  await initial;
  assert.equal(accepted, 1);
  await raced.waitForPersistence();
});

test("已发布版本的定向失效只更新快照，不重复发出通知", async () => {
  let current = entries("one");
  let notifications = 0;
  const coordinator = new SessionIndexCoordinator(
    async () => ({ entries: current }), async () => {}, 30_000, () => { notifications += 1; },
  );
  await coordinator.getSnapshot();
  assert.equal(notifications, 1);

  current = entries("one");
  current.get("/one.jsonl").fingerprint.mtimeNs = "2";
  coordinator.invalidate(["/one.jsonl"], true);
  await coordinator.getSnapshot();
  assert.equal(notifications, 1);
  assert.equal(coordinator.getVerifiedSnapshot().get("/one.jsonl").fingerprint.mtimeNs, "2");

  current = entries("one");
  current.get("/one.jsonl").fingerprint.mtimeNs = "3";
  await coordinator.forceRefresh();
  assert.equal(notifications, 2, "手动 force 发现的变化仍需发布");
});

test("持久启动提示不发出变更通知，校验失败也不制造删除通知", async () => {
  const pending = deferred();
  let notifications = 0;
  const coordinator = new SessionIndexCoordinator(
    async (onSnapshot) => { onSnapshot(entries("hint")); return pending.promise; },
    async () => {}, 0, () => { notifications += 1; },
  );
  await coordinator.getSnapshot();
  assert.equal(notifications, 0);
  const verified = coordinator.getVerifiedSnapshotOrRefresh();
  pending.reject(new Error("fixture failure"));
  await assert.rejects(verified, /fixture failure/);
  assert.equal(notifications, 0);
  assert.equal(coordinator.getVerifiedSnapshot(), null);
});

test("known-path invalidation requests a targeted refresh from the accepted snapshot", async () => {
  const requests = [];
  let refreshCount = 0;
  const coordinator = new SessionIndexCoordinator(
    async (_onSnapshot, request) => {
      requests.push(request);
      refreshCount += 1;
      return { entries: refreshCount === 1 ? entries("one") : entries("two") };
    },
    async () => {},
  );

  await coordinator.getSnapshot();
  coordinator.invalidate(["/one.jsonl"]);
  const refreshed = await coordinator.getSnapshot();
  assert.deepEqual([...refreshed.keys()], ["/two.jsonl"]);
  assert.deepEqual(requests[0], {});
  assert.deepEqual(requests[1].paths, ["/one.jsonl"]);
  assert.equal(requests[1].previousEntries.get("/one.jsonl")?.metadata?.id, "one");
});

test("authorization snapshots perform periodic full verification without list traffic", async () => {
  let refreshCount = 0;
  const coordinator = new SessionIndexCoordinator(
    async () => {
      refreshCount += 1;
      return { entries: entries(refreshCount === 1 ? "authorized" : "revoked") };
    },
    async () => {},
    0,
  );

  assert.deepEqual([...(await coordinator.getVerifiedSnapshotOrRefresh()).keys()], ["/authorized.jsonl"]);
  assert.deepEqual([...(await coordinator.getVerifiedSnapshotOrRefresh()).keys()], ["/revoked.jsonl"]);
  assert.equal(refreshCount, 2);
});

test("concurrent force refresh callers share one generation", async () => {
  const refresh = deferred();
  let refreshCount = 0;
  const coordinator = new SessionIndexCoordinator(
    async () => {
      refreshCount += 1;
      return refresh.promise;
    },
    async () => {},
  );

  const first = coordinator.forceRefresh();
  const second = coordinator.forceRefresh();
  assert.equal(first, second);
  assert.equal(refreshCount, 1);
  refresh.resolve({ entries: entries("forced") });
  assert.deepEqual([...(await first).keys()], ["/forced.jsonl"]);
});

test("accepted snapshots persist serially in generation order", async () => {
  const refreshes = [deferred(), deferred()];
  const firstPersist = deferred();
  const persistence = [];
  let refreshCount = 0;
  let persistCount = 0;
  const coordinator = new SessionIndexCoordinator(
    async () => refreshes[refreshCount++].promise,
    async (value) => {
      persistence.push(`start:${[...value.keys()][0]}`);
      persistCount += 1;
      if (persistCount === 1) await firstPersist.promise;
      persistence.push(`end:${[...value.keys()][0]}`);
    },
  );

  const initial = coordinator.getSnapshot();
  refreshes[0].resolve({ entries: entries("one") });
  await initial;
  const forced = coordinator.forceRefresh();
  refreshes[1].resolve({ entries: entries("two") });
  await forced;
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(persistence, ["start:/one.jsonl"]);
  firstPersist.resolve();
  await coordinator.waitForPersistence();
  assert.deepEqual(persistence, [
    "start:/one.jsonl",
    "end:/one.jsonl",
    "start:/two.jsonl",
    "end:/two.jsonl",
  ]);
});

import assert from "node:assert/strict";
import test from "node:test";

import {
  GIT_STATUS_CACHE_TTL_MS,
  invalidateGitStatusCache,
  loadGitStatusWithCache,
} from "./git-status-cache.ts";

function status(marker) {
  return {
    isGitRepository: true,
    repositoryRoot: `/repo/${marker}`,
    files: [{ filePath: `${marker}.ts`, status: "modified", code: "M", indexStatus: " ", worktreeStatus: "M" }],
    additions: marker.length,
    deletions: 0,
  };
}

test.after(() => invalidateGitStatusCache());

test("reuses one scan for a cwd inside the TTL and keeps cwds apart", async () => {
  invalidateGitStatusCache();
  let firstLoads = 0;
  let secondLoads = 0;

  const first = await loadGitStatusWithCache("/first-cwd", async () => {
    firstLoads += 1;
    return status("first");
  });
  const second = await loadGitStatusWithCache("/second-cwd", async () => {
    secondLoads += 1;
    return status("second");
  });
  const firstAgain = await loadGitStatusWithCache("/first-cwd", async () => {
    firstLoads += 1;
    return status("replacement");
  });

  assert.deepEqual(firstAgain, first);
  assert.notDeepEqual(second, first);
  assert.equal(firstLoads, 1);
  assert.equal(secondLoads, 1);
});

test("shares one scan between concurrent requests for the same cwd", async () => {
  invalidateGitStatusCache();
  let loads = 0;
  let finishScan;
  const scan = () => {
    loads += 1;
    return new Promise((resolve) => { finishScan = resolve; });
  };

  const first = loadGitStatusWithCache("/shared-cwd", scan);
  const second = loadGitStatusWithCache("/shared-cwd", scan);
  await Promise.resolve();

  assert.equal(loads, 1);
  finishScan(status("shared"));
  assert.deepEqual(await second, await first);
});

test("rescans once the TTL has passed", { timeout: 10_000 }, async () => {
  invalidateGitStatusCache();
  let loads = 0;
  const scan = async () => {
    loads += 1;
    return status(`scan-${loads}`);
  };

  await loadGitStatusWithCache("/expiring-cwd", scan);
  await new Promise((resolve) => setTimeout(resolve, GIT_STATUS_CACHE_TTL_MS + 150));
  const refreshed = await loadGitStatusWithCache("/expiring-cwd", scan);

  assert.equal(loads, 2);
  assert.deepEqual(refreshed, status("scan-2"));
});

test("does not cache a scan that finishes after invalidation", async () => {
  invalidateGitStatusCache();
  let finishOldScan;
  const oldScan = loadGitStatusWithCache("/stale-cwd", () => new Promise((resolve) => { finishOldScan = resolve; }));
  await Promise.resolve();

  invalidateGitStatusCache();
  let freshLoads = 0;
  const fresh = await loadGitStatusWithCache("/stale-cwd", async () => {
    freshLoads += 1;
    return status("fresh");
  });
  finishOldScan(status("stale"));
  await oldScan;

  const cached = await loadGitStatusWithCache("/stale-cwd", async () => {
    freshLoads += 1;
    return status("unexpected");
  });
  assert.deepEqual(cached, fresh);
  assert.equal(freshLoads, 1);
});

test("retries after a failed scan", async () => {
  invalidateGitStatusCache();
  await assert.rejects(
    loadGitStatusWithCache("/failed-cwd", async () => { throw new Error("scan failed"); }),
    /scan failed/,
  );

  let retries = 0;
  const fresh = await loadGitStatusWithCache("/failed-cwd", async () => {
    retries += 1;
    return status("fresh");
  });
  assert.deepEqual(fresh, status("fresh"));
  assert.equal(retries, 1);
});

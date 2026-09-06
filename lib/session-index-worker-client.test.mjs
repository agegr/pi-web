import assert from "node:assert/strict";
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const {
  moduleAssetPath,
  persistSessionIndexInWorker,
  runSessionIndexWorker,
} = await import("./session-index-worker-client.ts");

test("webpack public worker assets resolve inside the production output", () => {
  assert.equal(
    moduleAssetPath("/_next/static/media/session-index-worker.test.mts"),
    join(
      process.cwd(),
      ".next",
      "server/chunks/static/media/session-index-worker.test.mts",
    ),
  );
});

function writeSession(filePath, id, content) {
  writeFileSync(filePath, [
    JSON.stringify({
      type: "session",
      version: 3,
      id,
      timestamp: "2026-01-01T00:00:00.000Z",
      cwd: `/tmp/${id}`,
    }),
    JSON.stringify({
      type: "message",
      id: `${id}-user`,
      parentId: null,
      timestamp: "2026-01-01T00:00:01.000Z",
      message: { role: "user", content },
    }),
    "",
  ].join("\n"), { mode: 0o600 });
}

test("worker builds, persists, reloads, and incrementally refreshes a session index", async (t) => {
  const agentDirectory = mkdtempSync(join(tmpdir(), "pi-web-index-worker-"));
  t.after(() => rmSync(agentDirectory, { recursive: true, force: true }));
  const sessionsDirectory = join(agentDirectory, "sessions");
  const projectDirectory = join(sessionsDirectory, "project");
  const indexPath = join(agentDirectory, "cache", "pi-web", "session-index-v1.json");
  mkdirSync(projectDirectory, { recursive: true });
  const firstPath = join(projectDirectory, "first.jsonl");
  const secondPath = join(projectDirectory, "second.jsonl");
  writeSession(firstPath, "first", "one");
  writeSession(secondPath, "second", "two");

  let eventLoopReleased = false;
  const coldPromise = runSessionIndexWorker({
    indexPath,
    projectionVersion: "test-projection",
    sessionsDirectory,
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  eventLoopReleased = true;
  const cold = await coldPromise;
  assert.equal(eventLoopReleased, true);
  assert.deepEqual(cold.stats, { parsed: 2, reused: 0, removed: 0, unstable: 0 });
  assert.equal(cold.entries.get(firstPath)?.metadata?.firstMessage, "one");
  await persistSessionIndexInWorker({
    indexPath,
    projectionVersion: "test-projection",
  }, cold.entries);

  let startupSnapshot;
  const warm = await runSessionIndexWorker({
    indexPath,
    projectionVersion: "test-projection",
    sessionsDirectory,
    onSnapshot: (entries) => { startupSnapshot = entries; },
  });
  assert.equal(startupSnapshot?.size, 2);
  assert.deepEqual(warm.stats, { parsed: 0, reused: 2, removed: 0, unstable: 0 });
  await persistSessionIndexInWorker({
    indexPath,
    projectionVersion: "test-projection",
  }, warm.entries);

  appendFileSync(firstPath, `${JSON.stringify({
    type: "message",
    id: "first-assistant",
    parentId: "first-user",
    timestamp: "2026-01-01T00:00:02.000Z",
    message: { role: "assistant", provider: "test", model: "test", content: "done" },
  })}\n`);
  const changed = await runSessionIndexWorker({
    indexPath,
    projectionVersion: "test-projection",
    sessionsDirectory,
  });
  assert.deepEqual(changed.stats, { parsed: 1, reused: 1, removed: 0, unstable: 0 });
  assert.equal(changed.entries.get(firstPath)?.metadata?.messageCount, 2);
});

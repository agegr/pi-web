import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { gitProcessStats, runGit } = await jiti.import("./git-process.ts");

test("all Git callers share one bounded pool and release slots after failures", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "pi-web-git-pool-"));
  const previous = globalThis.__piGitProcessState;
  globalThis.__piGitProcessState = undefined;
  t.after(async () => {
    globalThis.__piGitProcessState = previous;
    await rm(directory, { recursive: true, force: true });
  });

  const results = await Promise.all(
    Array.from({ length: 20 }, () => runGit(directory, ["--version"])),
  );
  assert.equal(results.length, 20);
  assert.ok(results.every((output) => output.startsWith("git version")));
  assert.equal(gitProcessStats().limit, 8);
  assert.equal(gitProcessStats().peakActive, 8);
  assert.equal(gitProcessStats().active, 0);
  assert.equal(gitProcessStats().queued, 0);

  await assert.rejects(runGit(directory, ["rev-parse", "--verify", "missing-ref"]));
  assert.equal(gitProcessStats().active, 0);
  assert.equal(gitProcessStats().queued, 0);
});

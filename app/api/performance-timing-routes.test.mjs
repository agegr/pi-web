import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const routeSources = new Map(await Promise.all([
  ["files", new URL("./files/[...path]/route.ts", import.meta.url)],
  ["git-status", new URL("./git/status/route.ts", import.meta.url)],
  ["git-diff", new URL("./git/diff/route.ts", import.meta.url)],
  ["worktrees", new URL("./worktrees/route.ts", import.meta.url)],
].map(async ([name, url]) => [name, await readFile(url, "utf8")])));

test("critical file, Git, and worktree GET routes emit request-local Server-Timing", () => {
  for (const [name, source] of routeSources) {
    assert.match(source, /createServerTiming\(\)/, `${name} does not create request timing`);
    assert.match(source, /timing\.finish\(/, `${name} does not attach request timing`);
  }
});

test("file routes distinguish authorization and expensive file operations", () => {
  const source = routeSources.get("files");
  assert.match(source, /timing\.time\("auth"/);
  assert.match(source, /timing\.timeSync\("file-read"/);
  assert.match(source, /timing\.timeSync\("enumerate"/);
  assert.match(source, /timing\.time\("preview"/);
});

test("Git and worktree routes distinguish authorization, project, Git, and serialization", () => {
  const status = routeSources.get("git-status");
  const diff = routeSources.get("git-diff");
  const worktrees = routeSources.get("worktrees");

  for (const source of [status, diff]) {
    assert.match(source, /timing\.time\("auth"/);
    assert.match(source, /timing\.time\("git"/);
    assert.match(source, /timing\.timeSync\("serialize"/);
  }
  assert.match(worktrees, /timing\.time\("auth"/);
  assert.match(worktrees, /timing\.time\("project"/);
  assert.match(worktrees, /timing\.time\("git"/);
  assert.match(worktrees, /timing\.timeSync\("serialize"/);
});

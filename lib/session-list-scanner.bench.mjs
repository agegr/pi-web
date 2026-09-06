// Run: node --expose-gc lib/session-list-scanner.bench.mjs
// Synthetic files only. "No index" does not mean an empty OS filesystem cache.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { appendFileSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { SessionManager } = await jiti.import("@earendil-works/pi-coding-agent");
const { listSessionsIncremental, resetSessionScanIndexForTests } = await jiti.import("./session-list-scanner.ts");
if (process.argv.includes("--persisted-index")) {
  assert.ok(process.env.PI_CODING_AGENT_DIR, "the parent benchmark must supply a temporary agent directory");
  const start = performance.now();
  const sessions = await listSessionsIncremental();
  console.log(JSON.stringify({ count: sessions.length, elapsed: performance.now() - start }));
  process.exit(0);
}
const root = mkdtempSync(join(tmpdir(), "pi-web-scanner-bench-"));
const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
process.env.PI_CODING_AGENT_DIR = root;
const count = 2000;
const timestamp = "2026-01-01T00:00:00.000Z";
const line = (entry) => JSON.stringify(entry) + "\n";
const message = line({ type: "message", timestamp, message: { role: "user", content: "x".repeat(1024) } });
const samples = new Map();
let bytes = 0;

async function measure(label, scan) {
  globalThis.gc?.();
  const start = performance.now();
  const sessions = await scan();
  const elapsed = performance.now() - start;
  assert.equal(sessions.length, count);
  const values = samples.get(label) ?? [];
  values.push(elapsed);
  samples.set(label, values);
}

try {
  const dir = join(root, "sessions", "project");
  mkdirSync(dir, { recursive: true });
  for (let i = 0; i < count; i++) {
    const content = line({ type: "session", version: 3, id: String(i), cwd: root, timestamp }) + message.repeat(64);
    writeFileSync(join(dir, `${i}.jsonl`), content);
    bytes += Buffer.byteLength(content);
  }
  for (let trial = 0; trial < 3; trial++) {
    rmSync(join(root, "pi-web-session-index.json"), { force: true });
    resetSessionScanIndexForTests();
    await measure("SDK full scan", () => SessionManager.listAll());
    await measure("Scanner, no index", listSessionsIncremental);
    await measure("Scanner, memory index", listSessionsIncremental);
    const child = spawnSync(process.execPath, [fileURLToPath(import.meta.url), "--persisted-index"], {
      env: process.env, encoding: "utf8", timeout: 30_000,
    });
    assert.equal(child.status, 0, child.error?.message ?? child.stderr);
    const persisted = JSON.parse(child.stdout);
    assert.equal(persisted.count, count);
    const label = "Scanner, persisted index (new process)";
    const values = samples.get(label) ?? [];
    values.push(persisted.elapsed);
    samples.set(label, values);
    appendFileSync(join(dir, "0.jsonl"), message);
    await measure("Scanner, one appended file", listSessionsIncremental);
  }
  console.log(`${count} synthetic sessions, ${(bytes / 1024 / 1024).toFixed(1)} MiB, 64 messages/file; three trials.`);
  console.log("Scan latency only; excludes process startup, SDK imports, API project resolution, and browser rendering.");
  console.table([...samples].map(([mode, values]) => ({
    mode,
    medianMs: Number([...values].sort((a, b) => a - b)[1].toFixed(1)),
    samplesMs: values.map((value) => value.toFixed(1)).join(", "),
  })));
} finally {
  resetSessionScanIndexForTests();
  if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
  rmSync(root, { recursive: true, force: true });
}

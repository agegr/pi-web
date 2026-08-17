import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";
import { createJiti } from "jiti";

// getAgentDir() reads this on every call, so pointing it at a scratch tree
// keeps the suite off the developer's real session catalogue.
const agentDir = mkdtempSync(join(tmpdir(), "pi-web-sessions-"));
const sessionsDir = join(agentDir, "sessions");
mkdirSync(sessionsDir, { recursive: true });
process.env.PI_CODING_AGENT_DIR = agentDir;
after(() => rmSync(agentDir, { recursive: true, force: true }));

function writeSession(project, id, { entries = 0, header } = {}) {
  const dir = join(sessionsDir, project);
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `2026-08-17T00-00-00_${id}.jsonl`);
  const lines = [
    JSON.stringify(
      header ?? { type: "session", id, timestamp: new Date().toISOString(), cwd: join("/w", project) },
    ),
  ];
  // Body the targeted lookup must never need to read.
  for (let i = 0; i < entries; i++) {
    lines.push(JSON.stringify({ type: "message", id: `m${i}`, parentId: null, payload: "x".repeat(256) }));
  }
  writeFileSync(file, lines.join("\n") + "\n");
  return file;
}

const wanted = writeSession("alpha", "session-wanted", { entries: 3 });
writeSession("beta", "session-other", { entries: 200 });
const inGamma = writeSession("gamma", "session-deep");
// Named for one id, headed with another.
writeSession("alpha", "claimed-id", {
  header: { type: "session", id: "actual-id", timestamp: new Date().toISOString(), cwd: "/w/alpha" },
});

const jiti = createJiti(import.meta.url);
const { resolveSessionPath } = await jiti.import("./session-reader.ts");

test("resolves a session path without parsing the catalogue", async () => {
  assert.equal(await resolveSessionPath("session-wanted"), wanted);
});

test("finds a session in any project directory", async () => {
  assert.equal(await resolveSessionPath("session-deep"), inGamma);
});

test("does not trust a filename whose header disagrees", async () => {
  // The name matches, the header does not — the id must not resolve to it.
  assert.notEqual(await resolveSessionPath("claimed-id"), join(sessionsDir, "alpha", "2026-08-17T00-00-00_claimed-id.jsonl"));
});

test("returns null for an unknown session rather than guessing", async () => {
  assert.equal(await resolveSessionPath("no-such-session"), null);
});

test("a session id containing path separators cannot escape the sessions dir", async () => {
  for (const hostile of ["../../etc/passwd", "..\\..\\windows", "a/../../b", ""]) {
    assert.equal(await resolveSessionPath(hostile), null, `${hostile} must not resolve`);
  }
});

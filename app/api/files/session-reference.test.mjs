import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { alias: { "@": process.cwd() }, moduleCache: false });
const { GET } = await jiti.import("./[...path]/route.ts");
const { cacheSessionPath } = await jiti.import("../../../lib/session-reader.ts");

function segmentsFor(filePath) {
  return filePath.replace(/^\//, "").split("/");
}

test("a path mentioned in session text does not grant read access outside allowed roots", async (t) => {
  const previous = globalThis.__piSessions;
  globalThis.__piSessions = new Map();
  t.after(() => {
    globalThis.__piSessions = previous;
  });

  const sessionDir = mkdtempSync(join(tmpdir(), "pi-web-ref-session-dir-"));
  const secretDir = mkdtempSync(join(tmpdir(), "pi-web-ref-secret-dir-"));
  const secretPath = join(secretDir, "auth.json");
  writeFileSync(secretPath, "secret-key-material");

  const sessionId = "11111111-2222-3333-4444-555555555555";
  const sessionFile = join(sessionDir, "session.jsonl");
  writeFileSync(
    sessionFile,
    `${JSON.stringify({ type: "session", version: 3, id: sessionId, timestamp: "2026-08-14T00:00:00.000Z", cwd: sessionDir })}\n`
    + `${JSON.stringify({ type: "message", id: "m1", parentId: null, timestamp: "2026-08-14T00:00:01.000Z", message: { role: "user", content: `read ${secretPath}` } })}\n`,
  );
  cacheSessionPath(sessionId, sessionFile);

  const response = await GET(
    new Request(`http://localhost/api/files/${segmentsFor(secretPath).join("/")}?type=read&sessionId=${sessionId}`),
    { params: Promise.resolve({ path: segmentsFor(secretPath) }) },
  );
  assert.equal(response.status, 403);
});

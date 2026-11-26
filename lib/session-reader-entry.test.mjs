import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { readSessionEntry, invalidateSessionManagerCache, SM_CACHE_LIMITS } = await jiti.import("./session-reader.ts");
const { SessionManager } = await jiti.import("@earendil-works/pi-coding-agent");
const { sessionPathKey } = await jiti.import("./session-path.ts");

const TARGET = "a1b2c3d4";

function header(version = 3) {
  return { type: "session", version, id: "11111111-2222-4333-8444-555555555555", timestamp: "2026-01-01T00:00:00.000Z", cwd: "/tmp" };
}

function message(id, parentId, role, content) {
  return { type: "message", id, parentId, timestamp: "2026-01-01T00:00:00.000Z", message: { role, content, timestamp: 0 } };
}

function writeSession(t, entries) {
  const dir = mkdtempSync(join(tmpdir(), "pi-web-entry-read-"));
  const filePath = join(dir, "session.jsonl");
  writeFileSync(filePath, entries.map((entry) => typeof entry === "string" ? entry : JSON.stringify(entry)).join("\n") + "\n");
  t.after(() => {
    invalidateSessionManagerCache(filePath);
    rmSync(dir, { recursive: true, force: true });
  });
  return filePath;
}

/** Serve every file as over the cache limit, and count full SessionManager opens. */
function asOversize(t) {
  const previousLimit = SM_CACHE_LIMITS.maxFileBytes;
  const originalOpen = SessionManager.open;
  const opens = [];
  SM_CACHE_LIMITS.maxFileBytes = 0;
  SessionManager.open = (...args) => {
    opens.push(args[0]);
    return originalOpen.apply(SessionManager, args);
  };
  t.after(() => {
    SM_CACHE_LIMITS.maxFileBytes = previousLimit;
    SessionManager.open = originalOpen;
  });
  return opens;
}

// The target's id also shows up before it: in a tool call's arguments, in text, and in a line
// that is not JSON; after it as its child's parentId.
function sessionWithDecoys(targetContent = [{ type: "image", data: "aGk=", mimeType: "image/png" }]) {
  return [
    header(),
    message("00000001", null, "assistant", [
      { type: "toolCall", id: "call-1", name: "lookup", arguments: { id: TARGET } },
      { type: "text", text: `"id":"${TARGET}"` },
    ]),
    `{"type":"message","id":"${TARGET}", torn`,
    message(TARGET, "00000001", "toolResult", targetContent),
    message("00000003", TARGET, "user", "next"),
  ];
}

test("a small session's entry comes from the cached SessionManager", async (t) => {
  const filePath = writeSession(t, sessionWithDecoys());
  const entry = await readSessionEntry(filePath, TARGET);
  assert.equal(entry?.id, TARGET);
  assert.equal(entry?.message.role, "toolResult");
  assert.ok(globalThis.__piSmCache?.has(sessionPathKey(filePath)));
});

test("an oversize session is scanned for the line whose own id matches, without opening it whole (#1812)", async (t) => {
  const opens = asOversize(t);
  const filePath = writeSession(t, sessionWithDecoys());

  const entry = await readSessionEntry(filePath, TARGET);
  assert.equal(entry?.id, TARGET);
  assert.equal(entry?.parentId, "00000001");
  assert.equal(entry?.message.role, "toolResult");
  assert.deepEqual(opens, []);
  assert.equal(globalThis.__piSmCache?.has(sessionPathKey(filePath)) ?? false, false);
});

test("the scan reads an entry whose line spans several reads", async (t) => {
  asOversize(t);
  const data = Buffer.alloc(2_500_000, 7).toString("base64");
  const filePath = writeSession(t, sessionWithDecoys([{ type: "image", data, mimeType: "image/png" }]));

  const entry = await readSessionEntry(filePath, TARGET);
  assert.equal(entry?.message.content[0].data, data);
  // The last line, with no newline after it, is read too.
  writeFileSync(filePath, [header(), message("00000001", null, "user", "hi"), message(TARGET, "00000001", "toolResult", [{ type: "image", data, mimeType: "image/png" }])].map((line) => JSON.stringify(line)).join("\n"));
  assert.equal((await readSessionEntry(filePath, TARGET))?.message.content[0].data, data);
});

test("an id that no entry carries is not found, even where other lines mention it", async (t) => {
  const opens = asOversize(t);
  const filePath = writeSession(t, sessionWithDecoys().filter((entry) => entry.id !== TARGET));

  assert.equal(await readSessionEntry(filePath, TARGET), undefined);
  assert.equal(await readSessionEntry(filePath, "ffffffff"), undefined);
  assert.equal(await readSessionEntry(filePath, ""), undefined);
  // The session header's own id is not an entry id.
  assert.equal(await readSessionEntry(filePath, header().id), undefined);
  assert.deepEqual(opens, []);
});

test("a legacy oversize session still opens through SessionManager, which migrates it", async (t) => {
  const opens = asOversize(t);
  const filePath = writeSession(t, [header(2), message(TARGET, null, "user", "hi")]);

  assert.equal((await readSessionEntry(filePath, TARGET))?.id, TARGET);
  assert.equal(opens.length, 1);
});

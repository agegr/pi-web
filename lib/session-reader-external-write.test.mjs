// Integration check for the exact condition app/api/sessions/[id]/route.ts
// branches on: a live wrapper's SessionManager does NOT know an entry that
// another process appended to the same file. This validates the SDK contract
// (`getEntry()` is backed by an in-memory index, not a disk read) that the
// external-writer detection depends on — issue #632.
import assert from "node:assert/strict";
import test from "node:test";
import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { readLatestSessionEntryId } = await jiti.import("./session-reader.ts");

const header = {
  type: "session",
  version: 3,
  id: "11111111-1111-4111-8111-111111111111",
  cwd: "/tmp",
  timestamp: "2026-01-01T00:00:00.000Z",
};
function entry(id, text) {
  return {
    id,
    parentId: null,
    type: "message",
    timestamp: "2026-01-01T00:00:01.000Z",
    message: { role: "user", content: [{ type: "text", text }] },
  };
}

function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), "pi-web-eviction-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = join(
    dir,
    "2026-01-01T00-00-00-000Z_11111111-1111-4111-8111-111111111111.jsonl",
  );
  writeFileSync(
    file,
    `${JSON.stringify(header)}\n${JSON.stringify(entry("aaaa1111", "first"))}\n`,
  );
  return file;
}

test("an externally appended entry is unknown to the in-memory manager", (t) => {
  const file = fixture(t);
  const manager = SessionManager.open(file);
  assert.ok(
    manager.getEntry("aaaa1111"),
    "precondition: manager knows its own entry",
  );

  // Simulate the pi TUI appending to the same session file.
  appendFileSync(
    file,
    `${JSON.stringify(entry("bbbb2222", "written by the other process"))}\n`,
  );

  const diskLatestId = readLatestSessionEntryId(file);
  assert.equal(diskLatestId, "bbbb2222");
  // This is the branch condition: unknown disk id => the wrapper is stale.
  assert.equal(manager.getEntry(diskLatestId), undefined);
});

test("a manager writing its own entries is never flagged as stale", (t) => {
  // The eviction must not fire on pi-web's own appends, or every read would
  // destroy a healthy wrapper in a loop.
  const file = fixture(t);
  const manager = SessionManager.open(file);
  manager.appendMessage({
    role: "user",
    content: [{ type: "text", text: "written by pi-web" }],
  });

  const diskLatestId = readLatestSessionEntryId(file);
  assert.ok(diskLatestId, "pi-web's own append must be visible on disk");
  assert.ok(
    manager.getEntry(diskLatestId),
    "and must already be known to the manager",
  );
});

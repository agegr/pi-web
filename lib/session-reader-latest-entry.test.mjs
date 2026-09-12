// readLatestSessionEntryId is the staleness probe behind "a live wrapper must
// yield to the on-disk session file" (issue #632). A wrong answer here is
// expensive in both directions: a false positive evicts a healthy wrapper on
// every read, a false negative leaves the user staring at a frozen transcript.
import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { readLatestSessionEntryId } = await jiti.import("./session-reader.ts");

function withSessionFile(t, content) {
  const dir = mkdtempSync(join(tmpdir(), "pi-web-latest-entry-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = join(dir, "2026-01-01T00-00-00-000Z_session.jsonl");
  writeFileSync(file, content);
  return file;
}

const header = {
  type: "session",
  version: 3,
  id: "session-uuid",
  cwd: "/tmp",
  timestamp: "T0",
};
function message(id) {
  return {
    id,
    parentId: null,
    type: "message",
    timestamp: "T1",
    message: { role: "user", content: id },
  };
}
const lines = (...entries) =>
  `${entries.map((e) => JSON.stringify(e)).join("\n")}\n`;

test("returns the newest entry id", (t) => {
  const file = withSessionFile(
    t,
    lines(header, message("a1"), message("b2"), message("c3")),
  );
  assert.equal(readLatestSessionEntryId(file), "c3");
});

test("skips the session header so a fresh, entry-less session reads as undefined", (t) => {
  // The SDK's entry index excludes the header. Returning its id would look like
  // an unknown entry and evict a healthy wrapper on every single read.
  const file = withSessionFile(t, lines(header));
  assert.equal(readLatestSessionEntryId(file), undefined);
});

test("ignores a torn trailing line mid-append", (t) => {
  // appendFileSync is not atomic from a reader's perspective; a partial line is
  // the normal state, not corruption. Fall back to the last complete entry.
  const file = withSessionFile(
    t,
    `${lines(header, message("a1"), message("b2"))}{"id":"b3","par`,
  );
  assert.equal(readLatestSessionEntryId(file), "b2");
});

test("returns undefined when the file is absent or the path is unknown", (t) => {
  // An unflushed wrapper has no file on disk yet; that is not staleness.
  const dir = mkdtempSync(join(tmpdir(), "pi-web-latest-entry-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  assert.equal(readLatestSessionEntryId(join(dir, "missing.jsonl")), undefined);
  assert.equal(readLatestSessionEntryId(undefined), undefined);
});

test("reads only a bounded tail of a large session", (t) => {
  // 2000 entries of ~1KB each, well past the 64KB probe budget. The header sits
  // at the far start, so a file-wide scan that leaked the header would surface.
  const filler = (i) =>
    JSON.stringify({ ...message(`e${i}`), padding: "x".repeat(1000) });
  const body = Array.from({ length: 2000 }, (_, i) => filler(i)).join("\n");
  const file = withSessionFile(t, `${JSON.stringify(header)}\n${body}\n`);
  assert.equal(readLatestSessionEntryId(file), "e1999");
});

test("handles CRLF-terminated entries", (t) => {
  const file = withSessionFile(
    t,
    `${JSON.stringify(header)}\r\n${JSON.stringify(message("a1"))}\r\n`,
  );
  assert.equal(readLatestSessionEntryId(file), "a1");
});

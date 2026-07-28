import assert from "node:assert/strict";
import test from "node:test";

async function loadSubject() {
  return import("./session-path.ts");
}

test("normalizes Windows separators and casing for session identity", async () => {
  const { sessionPathKey } = await loadSubject();

  assert.equal(
    sessionPathKey("C:\\Users\\Alex\\.pi\\sessions\\Parent.jsonl", "win32"),
    sessionPathKey("c:/Users/Alex/.pi/sessions/parent.jsonl", "win32"),
  );
});

test("preserves case when session paths are case-sensitive", async () => {
  const { sessionPathKey } = await loadSubject();

  assert.notEqual(
    sessionPathKey("/var/lib/pi/Parent.jsonl", "linux"),
    sessionPathKey("/var/lib/pi/parent.jsonl", "linux"),
  );
});

import assert from "node:assert/strict";
import test from "node:test";

async function loadSubject() {
  return import("./session-file-references-core.ts");
}

test("authorizes full output only from a bash execution message", async () => {
  const { isBashOutputPathReferencedByEntries } = await loadSubject();
  const outputPath = "/tmp/pi-bash-ab12.log";
  const bashEntry = {
    type: "message",
    id: "entry-1",
    parentId: null,
    timestamp: "2026-01-01T00:00:00.000Z",
    message: {
      role: "bashExecution",
      command: "printf test",
      output: "test",
      fullOutputPath: outputPath,
    },
  };
  const assistantEntry = {
    type: "message",
    id: "entry-2",
    parentId: "entry-1",
    timestamp: "2026-01-01T00:00:01.000Z",
    message: {
      role: "assistant",
      content: [{ type: "text", text: `mentioned ${outputPath}` }],
    },
  };

  assert.equal(isBashOutputPathReferencedByEntries(outputPath, [bashEntry]), true);
  assert.equal(isBashOutputPathReferencedByEntries(outputPath, [assistantEntry]), false);
  assert.equal(isBashOutputPathReferencedByEntries("/tmp/pi-bash-other.log", [bashEntry]), false);
});

test("validates session ids before resolving session paths", async () => {
  const { isValidSessionId } = await loadSubject();

  assert.equal(isValidSessionId("not-a-session-id"), false);
  assert.equal(isValidSessionId("../../sessions/foo"), false);
  assert.equal(isValidSessionId("550e8400-e29b-41d4-a716-446655440000"), true);
});

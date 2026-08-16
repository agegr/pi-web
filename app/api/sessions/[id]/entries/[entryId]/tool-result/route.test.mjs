import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  alias: { "@": process.cwd() },
  interopDefault: true,
  moduleCache: false,
});
const { GET } = await jiti.import("./route.ts");
const { cacheSessionPath } = await jiti.import("../../../../../../../lib/session-reader.ts");

function writeToolResultSession(extraLines = []) {
  const dir = mkdtempSync(join(tmpdir(), "pi-web-tool-result-"));
  const id = "tool-result-session";
  const path = join(dir, `${id}.jsonl`);
  const toolEntryId = "tr-1";
  const lines = [
    JSON.stringify({ type: "session", version: 3, id, timestamp: "2026-01-01T00:00:00.000Z", cwd: dir }),
    JSON.stringify({
      type: "message",
      id: toolEntryId,
      parentId: "a-1",
      timestamp: "2026-01-01T00:00:01.000Z",
      message: {
        role: "toolResult",
        toolCallId: "call-1",
        content: [{ type: "text", text: "full result" }],
      },
    }),
    ...extraLines,
  ];
  writeFileSync(path, lines.join("\n") + "\n");
  cacheSessionPath(id, path);
  return { dir, id, toolEntryId };
}

test("returns the full normalized tool result for a valid entry", async (t) => {
  const { dir, id, toolEntryId } = writeToolResultSession();
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const response = await GET(
    new Request(`http://localhost/api/sessions/${id}/entries/${toolEntryId}/tool-result`),
    { params: Promise.resolve({ id, entryId: toolEntryId }) },
  );

  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).result, {
    role: "toolResult",
    toolCallId: "call-1",
    content: [{ type: "text", text: "full result" }],
  });
});

test("returns 404 for an unknown entry id", async (t) => {
  const { dir, id } = writeToolResultSession();
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const response = await GET(
    new Request(`http://localhost/api/sessions/${id}/entries/missing/tool-result`),
    { params: Promise.resolve({ id, entryId: "missing" }) },
  );

  assert.equal(response.status, 404);
});

test("returns 404 when the entry is an assistant message, not a tool result", async (t) => {
  const assistantEntryId = "a-1";
  const { dir, id } = writeToolResultSession([
    JSON.stringify({
      type: "message",
      id: assistantEntryId,
      parentId: null,
      timestamp: "2026-01-01T00:00:00.500Z",
      message: {
        role: "assistant",
        provider: "test",
        model: "test",
        content: [{ type: "text", text: "answer" }],
      },
    }),
  ]);
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const response = await GET(
    new Request(`http://localhost/api/sessions/${id}/entries/${assistantEntryId}/tool-result`),
    { params: Promise.resolve({ id, entryId: assistantEntryId }) },
  );

  assert.equal(response.status, 404);
});

test("returns 404 for an unknown session", async (t) => {
  const response = await GET(
    new Request("http://localhost/api/sessions/unknown-session/entries/x/tool-result"),
    { params: Promise.resolve({ id: "unknown-session", entryId: "x" }) },
  );

  assert.equal(response.status, 404);
});

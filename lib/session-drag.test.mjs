import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  interopDefault: true,
  moduleCache: false,
});
const { SESSION_DRAG_MIME, readSessionDrag, sessionDragData } = await jiti.import("./session-drag.ts");

const UUID = "01a1d03f-83b1-7311-b88e-4fa7a73ace2f";

function dropSource(type, value) {
  return {
    types: type === SESSION_DRAG_MIME ? [SESSION_DRAG_MIME, "text/plain"] : ["text/plain"],
    getData: (format) => (format === SESSION_DRAG_MIME ? value : ""),
  };
}

test("a dragged row reads back as the session it names", () => {
  const payload = sessionDragData({ id: UUID, title: "修复登录", cwd: "/p/pi-web", modified: "2026-11-22T10:00:00Z" });
  assert.deepEqual(readSessionDrag(dropSource(SESSION_DRAG_MIME, payload)), {
    id: UUID,
    title: "修复登录",
    cwd: "/p/pi-web",
    modified: "2026-11-22T10:00:00Z",
  });
});

test("a drag from another app is not a session", () => {
  // A link dragged out of a browser carries text/plain only.
  assert.equal(readSessionDrag(dropSource("text/plain", "https://example.com/x")), null);
});

test("a broken or empty payload reads as no session", () => {
  assert.equal(readSessionDrag(dropSource(SESSION_DRAG_MIME, "not json")), null);
  assert.equal(readSessionDrag(dropSource(SESSION_DRAG_MIME, "{}")), null);
  assert.equal(readSessionDrag(dropSource(SESSION_DRAG_MIME, JSON.stringify({ id: "" }))), null);
  // Missing optionals stay absent rather than empty strings.
  assert.deepEqual(readSessionDrag(dropSource(SESSION_DRAG_MIME, JSON.stringify({ id: UUID, title: "x" }))), {
    id: UUID,
    title: "x",
    cwd: undefined,
    modified: undefined,
  });
});
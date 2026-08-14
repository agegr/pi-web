import assert from "node:assert/strict";
import test from "node:test";
import { getToolResultImages } from "./tool-result-images.ts";

test("selects image blocks from tool results for paired rendering", () => {
  const image = {
    type: "image",
    source: { type: "url", media_type: "image/png", url: "/api/tool-image" },
  };
  const result = {
    role: "toolResult",
    toolCallId: "call-1",
    content: [{ type: "text", text: "Read image file" }, image],
  };

  assert.deepEqual(getToolResultImages(result), [image]);
  assert.deepEqual(getToolResultImages(undefined), []);
});

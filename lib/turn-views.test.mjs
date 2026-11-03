import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { getFinalAnswerViews, keepWrittenFiles } = await jiti.import("./turn-views.ts");

function finalAssistant() {
  return {
    role: "assistant",
    provider: "test",
    model: "test-model",
    usage: { input: 1, output: 2 },
    content: [
      { type: "thinking", thinking: "Plan" },
      { type: "toolCall", toolCallId: "t1", toolName: "write", input: { path: "a.txt" } },
      { type: "text", text: "Done." },
    ],
  };
}

test("splits a final assistant message into its process part and its answer", () => {
  const message = finalAssistant();
  const views = getFinalAnswerViews(new WeakMap(), message);

  assert.deepEqual(views.answer.content, [message.content[2]]);
  assert.deepEqual(views.answer.usage, message.usage);
  assert.deepEqual(views.process.content, message.content.slice(0, 2));
  assert.equal(views.process.usage, undefined);
  assert.notEqual(views.answer, message);
});

test("hands every render the same copies of an unchanged message, so MessageView's memo holds (#1005)", () => {
  const cache = new WeakMap();
  const message = finalAssistant();
  const first = getFinalAnswerViews(cache, message);
  const again = getFinalAnswerViews(cache, message);

  assert.equal(again, first);
  assert.equal(again.answer, first.answer);
  assert.equal(again.process, first.process);
  // A replaced message is a new object and gets its own copies.
  assert.notEqual(getFinalAnswerViews(cache, { ...message }).answer, first.answer);
});

test("keeps the written-files list while the turn wrote the same files", () => {
  const views = getFinalAnswerViews(new WeakMap(), finalAssistant());
  const first = keepWrittenFiles(views, [{ filePath: "/p/a.txt" }]);

  assert.equal(keepWrittenFiles(views, [{ filePath: "/p/a.txt" }]), first);
  const changed = [{ filePath: "/p/a.txt" }, { filePath: "/p/b.txt" }];
  assert.equal(keepWrittenFiles(views, changed), changed);
  assert.equal(keepWrittenFiles(views, []).length, 0);
});

test("a reply stopped before or after its thinking says so once, under the answer", () => {
  const stoppedEarly = { role: "assistant", content: [], stopReason: "aborted", errorMessage: "Request was aborted" };
  const early = getFinalAnswerViews(new WeakMap(), stoppedEarly);
  assert.equal(early.answer?.stopReason, "aborted");

  const stoppedThinking = { ...stoppedEarly, content: [{ type: "thinking", thinking: "Hmm" }] };
  const thinking = getFinalAnswerViews(new WeakMap(), stoppedThinking);
  assert.equal(thinking.answer?.stopReason, "aborted");
  assert.equal(thinking.process.stopReason, undefined);

  const stoppedText = { ...stoppedEarly, content: [{ type: "thinking", thinking: "Hmm" }, { type: "text", text: "Half" }] };
  const text = getFinalAnswerViews(new WeakMap(), stoppedText);
  assert.equal(text.answer?.stopReason, "aborted");
  assert.equal(text.process.stopReason, undefined);
  assert.equal(text.process.errorMessage, undefined);
});

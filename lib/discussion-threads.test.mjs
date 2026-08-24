import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { interopDefault: true });
const {
  collectDiscussionThreads,
  findActiveDiscussionThread,
  groupDiscussionThreadsBySource,
  parseDiscussionThreadMetadata,
  threadTitleFromMarkdown,
} = await jiti.import("./discussion-threads.ts");

const entry = (id, type, parentId, extra = {}) => ({
  id,
  type,
  parentId,
  timestamp: `2026-01-01T00:00:0${id.length}.000Z`,
  ...extra,
});

const node = (entryValue, children = [], compressedEntryIds) => ({
  entry: entryValue,
  children,
  ...(compressedEntryIds ? { compressedEntryIds } : {}),
});

test("parses thread metadata and derives a compact title", () => {
  assert.equal(threadTitleFromMarkdown("## Authentication\n\n- Rotate tokens"), "Authentication Rotate tokens");
  assert.deepEqual(parseDiscussionThreadMetadata({
    version: 1,
    sourceEntryId: "assistant",
    hostLeafId: "main-leaf",
    selectedMarkdown: "## Authentication",
    status: "anything",
  }), {
    version: 1,
    sourceEntryId: "assistant",
    hostLeafId: "main-leaf",
    selectedMarkdown: "## Authentication",
    title: "Authentication",
    status: "open",
  });
});

test("collects thread roots, latest leaves, and active compressed descendants", () => {
  const threadNode = node(entry("thread", "custom", "assistant", {
    customType: "pi-web.thread",
    data: {
      version: 1,
      sourceEntryId: "assistant",
      hostLeafId: "main-leaf",
      selectedMarkdown: "Authentication",
      title: "Authentication",
      status: "open",
    },
  }), [node(entry("reply", "message", "thread"), [], ["user-question"])]);
  const tree = [node(entry("assistant", "message", null), [threadNode])];
  const threads = collectDiscussionThreads(tree);

  assert.equal(threads.length, 1);
  assert.equal(threads[0].latestLeafId, "reply");
  assert.equal(findActiveDiscussionThread(threads, "user-question")?.id, "thread");
  assert.deepEqual(groupDiscussionThreadsBySource(threads).get("assistant")?.map((thread) => thread.id), ["thread"]);
});

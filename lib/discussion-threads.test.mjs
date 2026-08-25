import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { interopDefault: true });
const {
  collectDiscussionThreads,
  findActiveDiscussionThread,
  groupDiscussionThreadsBySource,
  parseDiscussionThreadMetadata,
  resolveInactiveSessionLeafId,
  resolveThreadMainLeafId,
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
    anchorKey: "0:h2:0",
    status: "anything",
  }), {
    version: 1,
    sourceEntryId: "assistant",
    hostLeafId: "main-leaf",
    selectedMarkdown: "## Authentication",
    anchorKey: "0:h2:0",
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

const threadEntry = (id, parentId, sourceEntryId, hostLeafId) => entry(id, "custom", parentId, {
  customType: "pi-web.thread",
  data: { version: 1, sourceEntryId, hostLeafId, selectedMarkdown: "topic", title: "topic", status: "open" },
});

test("returns to the newest main descendant instead of the recorded host leaf", () => {
  // hostLeafId is the source itself, which is what the runtime records when a
  // thread starts from the latest response.
  const thread = node(threadEntry("thread", "assistant", "assistant", "assistant"), [
    node(entry("thread-reply", "message", "thread")),
  ]);
  const mainTail = node(entry("main-2", "message", "main-1"));
  const main = node(entry("main-1", "message", "assistant"), [mainTail]);
  const tree = [node(entry("assistant", "message", null), [thread, main])];

  const [descriptor] = collectDiscussionThreads(tree);
  assert.equal(resolveThreadMainLeafId(tree, descriptor), "main-2");
  assert.equal(findActiveDiscussionThread(collectDiscussionThreads(tree), "main-2"), null);
});

test("falls back to the source when the main branch has no continuation", () => {
  const thread = node(threadEntry("thread", "assistant", "assistant", "assistant"), []);
  const tree = [node(entry("assistant", "message", null), [thread])];
  const [descriptor] = collectDiscussionThreads(tree);

  assert.equal(resolveThreadMainLeafId(tree, descriptor), "assistant");
  assert.equal(resolveThreadMainLeafId([], descriptor), "assistant");
});

test("an inactive session opens its main leaf instead of its newest thread leaf", () => {
  const thread = node(threadEntry("thread", "assistant", "assistant", "assistant"), [
    node(entry("thread-reply", "message", "thread")),
  ]);
  const main = node(entry("main", "message", "assistant"), [
    node(entry("main-tail", "message", "main")),
  ]);
  const tree = [node(entry("assistant", "message", null), [thread, main])];

  assert.equal(resolveInactiveSessionLeafId(tree, "thread-reply"), "main-tail");
  assert.equal(resolveInactiveSessionLeafId(tree, "main-tail"), "main-tail");
});

test("ancestors contracted into a thread node are not treated as thread content", () => {
  // A fully linear session contracts the main prefix into the thread node,
  // because compressedEntryIds records entries folded *above* it.
  const thread = node(threadEntry("thread", "assistant", "assistant", "assistant"), [
    node(entry("thread-reply", "message", "thread")),
  ], ["root-user", "assistant"]);
  const tree = [node(entry("root-user", "message", null), [thread])];
  const threads = collectDiscussionThreads(tree);

  assert.equal(findActiveDiscussionThread(threads, "assistant"), null);
  assert.equal(findActiveDiscussionThread(threads, "root-user"), null);
  assert.equal(findActiveDiscussionThread(threads, "thread-reply")?.id, "thread");
  assert.equal(resolveThreadMainLeafId(tree, threads[0]), "assistant");
});

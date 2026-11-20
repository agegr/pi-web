import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { Script } from "node:vm";
import ts from "typescript";
import { createJiti } from "jiti";

// #1746: a user message sent during the run had no entry id until the run's
// end read the file, so it showed no "New session". The wrapper names its
// entry (`user_message_entry`) right after its `message_end`; the hook maps
// the message the transcript shows for it to that id, apart from `entryIds`.

const jiti = createJiti(import.meta.url, { interopDefault: true, alias: { "@": new URL("..", import.meta.url).pathname } });
const { withLiveUserEntryId } = await jiti.import("../lib/message-keys.ts");
const { userMessageKey } = await jiti.import("../lib/prompt-recovery.ts");

const source = ts.createSourceFile("useAgentSession.ts", await readFile(new URL("./useAgentSession.ts", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true);
const nodes = [];
function visit(node) { nodes.push(node); ts.forEachChild(node, visit); }
visit(source);

/** The `case` clauses of handleAgentEvent for these event types, as one switch. */
function cases(...types) {
  const clauses = types.map((type) => {
    const clause = nodes.find((node) => ts.isCaseClause(node) && node.expression.getText(source) === JSON.stringify(type));
    assert.ok(clause, `missing case ${type}`);
    return clause.getText(source);
  });
  return new Script(ts.transpileModule(`(() => { switch (event.type) { ${clauses.join("\n")} } })()`, { compilerOptions: { target: ts.ScriptTarget.ESNext } }).outputText);
}

function setup(messages) {
  const state = { messages, ids: new Map() };
  const scope = {
    agentRunningRef: { current: true },
    sessionIdRef: { current: "s" },
    optimisticUserMessageKeyRef: { current: null },
    optimisticUserMessageRef: { current: null },
    deliveredUserMessageRef: { current: null },
    isSystemMessageEvent: () => false,
    normalizeToolCalls: (message) => ({ ...message }),
    userMessageKey,
    withLiveUserEntryId,
    markPromptLanded() {},
    setMessages(update) { state.messages = update(state.messages); },
    setLiveUserEntryIds(update) { state.ids = update(state.ids); },
    dispatch() {},
    setAgentPhase() {},
  };
  const script = cases("user_message_entry", "message_end");
  const run = (event) => script.runInNewContext({ ...scope, event });
  return { state, scope, run };
}

test("the run's prompt and a steer take the entry ids the wrapper names after their message_end", () => {
  const bubble = { role: "user", content: "go", timestamp: 1 };
  const { state, scope, run } = setup([bubble]);
  scope.optimisticUserMessageKeyRef.current = userMessageKey(bubble);
  scope.optimisticUserMessageRef.current = bubble;

  run({ type: "message_end", message: { role: "user", content: "go", timestamp: 100 } });
  assert.deepEqual(state.messages, [bubble], "the bubble stays for its delivered prompt");
  run({ type: "user_message_entry", entryId: "p1", timestamp: 100 });
  assert.equal(state.ids.get(bubble), "p1");

  // A steer with the same text is its own message, with its own entry.
  run({ type: "message_end", message: { role: "user", content: "go", timestamp: 200 } });
  const steer = state.messages.at(-1);
  assert.notEqual(steer, bubble);
  assert.equal(state.ids.get(steer), undefined);
  run({ type: "user_message_entry", entryId: "s1", timestamp: 200 });
  assert.equal(state.ids.get(steer), "s1");
  assert.equal(state.ids.get(bubble), "p1");

  // An entry whose message_end the chat did not show names nothing.
  scope.agentRunningRef.current = false;
  run({ type: "message_end", message: { role: "user", content: "late", timestamp: 300 } });
  const before = state.ids;
  run({ type: "user_message_entry", entryId: "l1", timestamp: 300 });
  assert.equal(state.ids, before);
});

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { Script } from "node:vm";
import ts from "typescript";
import { createJiti } from "jiti";

const source = ts.createSourceFile("useAgentSession.ts", readFileSync(new URL("./useAgentSession.ts", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true);
const nodes = [];
function visit(node) { nodes.push(node); ts.forEachChild(node, visit); }
visit(source);
function callback(name) {
  const node = nodes.find(n => ts.isVariableDeclaration(n) && n.name.getText(source) === name);
  assert.ok(node, name);
  return new Script(ts.transpileModule(`(${node.initializer.arguments[0].getText(source)})`, { compilerOptions: { target: ts.ScriptTarget.ESNext } }).outputText);
}
const windowSource = ts.createSourceFile("ChatWindow.tsx", readFileSync(new URL("../components/ChatWindow.tsx", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true);
function windowEffect(marker) {
  let effect;
  function find(node) {
    if (ts.isCallExpression(node) && ["useEffect", "useLayoutEffect"].includes(node.expression.getText(windowSource))
      && node.arguments[0]?.getText(windowSource).includes(marker)) effect = node.arguments[0];
    ts.forEachChild(node, find);
  }
  find(windowSource);
  assert.ok(effect, marker);
  return new Script(ts.transpileModule(`(${effect.getText(windowSource)})`, { compilerOptions: { target: ts.ScriptTarget.ESNext } }).outputText);
}
const searchEffect = windowEffect("searchTarget.sessionId !== session?.id");
const resetEffect = windowEffect("setPendingScrollRestore(initialReadingPositionRef.current)");
const earlierScript = callback("loadEarlierMessages");
const contextScript = callback("loadContext");
const jiti = createJiti(import.meta.url);
const { mergeSessionStats } = await jiti.import("../lib/session-stats.ts");
const plain = value => JSON.parse(JSON.stringify(value));
const message = (input) => ({ role: "assistant", content: [{ type: "text", text: String(input) }], usage: { input, output: 0, cacheRead: 0, cacheWrite: 0, cost: { total: 0 } } });
function page() {
  return { context: { messages: [message(20), { role: "user", content: "past" }], entryIds: ["e0", "e1"], oldestEntryId: "e0", hasMore: false, model: null, thinkingLevel: "off" },
    page: { startIndex: 0, endIndex: 2, totalMessages: 3, hasEarlier: false }, inputHistory: ["past"] };
}
function setup(fetchImpl = async () => Response.json(page())) {
  const base = message(80);
  const live = message(5);
  const state = {
    messages: [base, live], entryIds: ["e2"], contextPage: { startIndex: 2, endIndex: 3, totalMessages: 3, hasEarlier: true },
    data: { sessionId: "A", stats: { userMessages: 1, assistantMessages: 2, toolCalls: 0, toolResults: 0, totalMessages: 3, tokens: { input: 100, output: 0, cacheRead: 0, cacheWrite: 0, total: 100 }, cost: 0 }, context: { messages: [base], entryIds: ["e2"], model: null, thinkingLevel: "off" } },
  };
  const writes = [];
  const context = {
    AbortController, URLSearchParams, console, fetch: fetchImpl,
    INITIAL_SESSION_CONTEXT_MESSAGES: 60, SESSION_CONTEXT_PAGE_MESSAGES: 120,
    sessionIdRef: { current: "A" }, sessionHookMountedRef: { current: true },
    activeLeafIdRef: { current: "e2" }, contextPageRef: { current: state.contextPage },
    historyLoadPendingRef: { current: false }, historyLoadGenerationRef: { current: 0 }, historyLoadControllerRef: { current: null },
    contextLoadGenerationRef: { current: 0 }, contextLoadControllerRef: { current: null },
    sessionLoadGenerationRef: { current: 0 }, sessionLoadControllerRef: { current: null },
  };
  for (const name of ["Messages", "EntryIds", "Data", "ActiveLeafId", "ContextPage", "ContextStats", "ServerInputHistory", "LoadingEarlierMessages"]) {
    const key = name[0].toLowerCase() + name.slice(1);
    context[`set${name}`] = (value) => {
      state[key] = typeof value === "function" ? value(state[key]) : value;
      writes.push(key);
    };
  }
  return { state, context, writes, earlier: earlierScript.runInNewContext(context), loadContext: contextScript.runInNewContext(context) };
}

test("历史上翻只改变已加载窗口，不把旧消息重复计入实时用量", async () => {
  let request;
  const x = setup(async (url) => { request = new URL(url, "http://localhost"); return Response.json(page()); });
  const before = mergeSessionStats(x.state.data.stats, x.state.data.context.messages, x.state.messages);
  assert.equal(before.tokens.input, 105);
  const result = await x.earlier();
  assert.equal(request.searchParams.get("before"), "2");
  assert.equal(request.searchParams.get("limit"), "120");
  assert.equal(request.searchParams.get("leafId"), "e2");
  assert.equal(result.page.startIndex, 0);
  assert.deepEqual(plain(x.state.entryIds), ["e0", "e1", "e2"]);
  assert.deepEqual(plain(x.state.data.context.entryIds), ["e0", "e1", "e2"]);
  assert.deepEqual(plain(x.context.contextPageRef.current), { startIndex: 0, endIndex: 3, totalMessages: 3, hasEarlier: false });
  const after = mergeSessionStats(x.state.data.stats, x.state.data.context.messages, x.state.messages);
  assert.deepEqual(after, before);
  assert.equal(await x.earlier(), null);
});

test("重复触发共用请求所有权，过期会话、叶节点、页边界及卸载均拒绝写入", async () => {
  const mutations = [
    x => { x.context.sessionIdRef.current = "B"; },
    x => { x.context.activeLeafIdRef.current = "other"; },
    x => { x.context.contextPageRef.current = { ...x.state.contextPage, startIndex: 1 }; },
    x => { x.context.historyLoadGenerationRef.current += 1; },
    x => { x.context.sessionHookMountedRef.current = false; },
  ];
  for (const mutate of mutations) {
    const gate = Promise.withResolvers();
    let requests = 0;
    const x = setup(async () => { requests++; await gate.promise; return Response.json(page()); });
    const first = x.earlier();
    assert.equal(await x.earlier(), null);
    assert.equal(requests, 1);
    mutate(x);
    gate.resolve();
    assert.equal(await first, null);
    assert.deepEqual(x.writes.filter(name => name !== "loadingEarlierMessages"), []);
  }
});

test("外部取消后允许立即重启，旧请求 finally 不能清除新请求状态", async () => {
  const gates = [Promise.withResolvers(), Promise.withResolvers()];
  let count = 0;
  const x = setup(async () => { const i = count++; await gates[i].promise; return Response.json(page()); });
  const controller = new AbortController();
  const first = x.earlier({ signal: controller.signal });
  controller.abort();
  const second = x.earlier();
  assert.equal(count, 2);
  gates[0].resolve();
  assert.equal(await first, null);
  assert.equal(x.context.historyLoadPendingRef.current, true);
  gates[1].resolve();
  assert.ok(await second);
  assert.equal(x.context.historyLoadPendingRef.current, false);
  assert.deepEqual(plain(x.state.entryIds), ["e0", "e1", "e2"]);
});

test("连续上翻不依赖 React 再渲染后才推进页游标", async () => {
  const cursors = [];
  const x = setup(async url => {
    const before = Number(new URL(url, "http://localhost").searchParams.get("before"));
    cursors.push(before);
    const result = page();
    result.page = { startIndex: before - 1, endIndex: before, totalMessages: 3, hasEarlier: before > 1 };
    result.context.messages = [{ role: "user", content: `m${before - 1}` }];
    result.context.entryIds = [`e${before - 1}`];
    return Response.json(result);
  });
  await x.earlier();
  await x.earlier();
  assert.deepEqual(cursors, [2, 1]);
  assert.deepEqual(plain(x.state.entryIds), ["e0", "e1", "e2"]);
});

test("搜索可连续加载多个数字分页，取消后不会高亮过期目标", async () => {
  const done = Promise.withResolvers();
  let calls = 0;
  let visible = 0;
  const target = { sessionId: "A", entryId: "e0" };
  const context = {
    AbortController, searchTarget: target, session: { id: "A" }, loading: false, sessionBusy: false,
    locateGenerationRef: { current: 0 }, loadingOlderRef: { current: false }, prevScrollDistanceRef: { current: 0 },
    searchHistoryRef: { current: { entryIds: ["e5"], hasEarlierMessages: true } },
    loadEarlierMessages: async () => {
      calls++;
      return { context: { entryIds: calls === 1 ? ["e3", "e4"] : calls === 2 ? ["e1", "e2"] : ["e0"] }, page: { hasEarlier: calls < 3 } };
    },
    setVisibleCount: updater => { visible = updater(visible); },
    setPendingSearchScroll: value => done.resolve(value),
    onSearchTargetHandled: () => done.reject(new Error("目标存在，不应提前结束搜索")),
  };
  const cleanup = searchEffect.runInNewContext(context)();
  assert.equal(await done.promise, target);
  assert.equal(calls, 3);
  assert.equal(visible, 12);
  cleanup();

  const gate = Promise.withResolvers();
  const writes = [];
  const cancelled = { ...context,
    loadEarlierMessages: async () => { await gate.promise; return { context: { entryIds: ["e0"] }, page: { hasEarlier: false } }; },
    setPendingSearchScroll: () => writes.push("highlight"), onSearchTargetHandled: () => writes.push("handled"),
  };
  const cancel = searchEffect.runInNewContext(cancelled)();
  cancel();
  gate.resolve();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(writes, []);
});

test("复用聊天壳的 A→B→A 切换重新初始化各自保存的阅读位置", () => {
  const positions = [];
  const context = {
    locateGenerationRef: { current: 0 }, restoreStartedRef: { current: true }, loadingOlderRef: { current: true },
    initialPromptSentRef: { current: true }, initialReadingPositionRef: { current: null }, prevScrollDistanceRef: { current: 123 },
    VISIBLE_PAGE_SIZE: 60, setPendingScrollRestore: value => positions.push(value),
    setRestoreAnchorReady() {}, setPendingSearchScroll() {}, setVisibleCount() {},
  };
  const reset = resetEffect.runInNewContext(context);
  const a = { atBottom: false, anchorEntryId: "a100", anchorOffset: -8, oldestEntryId: "a80" };
  const b = { atBottom: false, anchorEntryId: "b20", anchorOffset: 4, oldestEntryId: "b0" };
  for (const position of [a, b, a]) { context.initialReadingPositionRef.current = position; reset(); }
  assert.deepEqual(positions, [a, b, a]);
  assert.equal(context.locateGenerationRef.current, 3);
  assert.equal(context.restoreStartedRef.current, false);
  assert.equal(context.loadingOlderRef.current, false);
});

test("换分支取消详情及历史请求，旧分支返回不能覆盖新分支", async () => {
  const gates = [Promise.withResolvers(), Promise.withResolvers()];
  const queries = [];
  const x = setup(async url => { const i = queries.length; queries.push(new URL(url, "http://localhost")); await gates[i].promise; return Response.json(page()); });
  const oldDetail = new AbortController();
  const oldHistory = new AbortController();
  x.context.sessionLoadControllerRef.current = oldDetail;
  x.context.historyLoadControllerRef.current = oldHistory;
  const first = x.loadContext("A", "branch-old");
  const second = x.loadContext("A", null);
  assert.equal(oldDetail.signal.aborted, true);
  assert.equal(oldHistory.signal.aborted, true);
  assert.equal(queries[1].searchParams.get("leafId"), "");
  gates[0].resolve();
  assert.equal(await first, undefined);
  assert.equal(x.state.data.context.entryIds[0], "e2");
  gates[1].resolve();
  assert.ok(await second);
  assert.equal(x.context.activeLeafIdRef.current, null);
  assert.deepEqual(plain(x.state.data.context.entryIds), ["e0", "e1"]);
});

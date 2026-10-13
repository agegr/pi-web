import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { Script } from "node:vm";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";
import ts from "typescript";
import { renderHook, useCallback, useEffect, useMemo } from "./__fixtures__/react-hook-shim.mjs";

const shim = fileURLToPath(new URL("./__fixtures__/react-hook-shim.mjs", import.meta.url));
const jiti = createJiti(import.meta.url, { tsconfigPaths: true, alias: { react: shim } });
const { useAgentSession } = await jiti.import("./useAgentSession.ts");
const { collectSessionWrittenFiles, sessionWrittenFileKey } = await jiti.import("../lib/session-written-files.ts");
const { useStreamingSelector, selectIsStreaming, selectHasStreamingContent } = await jiti.import("./useStreamingSelector.ts");

// No DOM/test renderer is installed. Reuse the project's actual-callback AST
// scaffold for ChatWindow's Files slice, not an imitation of its aggregation.
// The entire real public session hook is mounted with the existing hook shim;
// HTTP/EventSource are controlled boundaries. This does not mount the DOM tree.
const source = ts.createSourceFile("ChatWindow.tsx", await readFile(new URL("../components/ChatWindow.tsx", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const chat = source.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "ChatWindow");
const statements = chat.body.statements;
function declaration(name) {
  return statements.find(node => ts.isVariableStatement(node) && node.declarationList.declarations.some(entry => entry.name.getText(source) === name));
}
const filesIndex = statements.indexOf(declaration("sessionFiles"));
const filesSlice = new Script(ts.transpileModule(`(() => {
${[declaration("isStreaming"), declaration("hasStreamingContent"), declaration("getStreamingMessage"), declaration("toolResultsMap"), declaration("messageCwd"), ...statements.slice(filesIndex, filesIndex + 3)].map(node => node.getText(source)).join("\n")}
})()`, { compilerOptions: { target: ts.ScriptTarget.ESNext } }).outputText);

const json = body => Response.json(body);
const settle = async () => { for (let index = 0; index < 10; index++) await new Promise(resolve => setImmediate(resolve)); };
const call = (id, path) => ({ role: "assistant", model: "test", provider: "test", timestamp: 10, content: [{ type: "toolCall", toolCallId: id, toolName: "write", input: { path } }] });
const result = (id, timestamp = 20) => ({ role: "toolResult", toolCallId: id, timestamp, content: [{ type: "text", text: "ok" }] });
const view = (sid, branch) => ({
  sessionId: sid, filePath: "", tree: [], leafId: `leaf-${branch}`, totalActiveMs: 0,
  context: { messages: [call(`${branch}-visible`, `/repo/${branch}.html`), result(`${branch}-visible`)], entryIds: [`${branch}-call`, `${branch}-result`], oldestEntryId: `${branch}-call`, hasMore: true, turnsBefore: 2, thinkingLevel: "off", model: null },
  writtenFileManifest: { leafId: `leaf-${branch}`, writes: [
    { toolCallId: `${branch}-old`, filePath: `/repo/${branch}-old.md`, sessionWrittenAtMs: 5 },
    { toolCallId: `${branch}-visible`, filePath: `/repo/${branch}.html`, sessionWrittenAtMs: 20 },
  ] },
});
const expected = branch => [[`/repo/${branch}.html`, 1], [`/repo/${branch}-old.md`, 1]];

function mountedFiles(t, sid = "review") {
  const globals = new Map(["document", "window", "EventSource"].map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  const sources = []; const requests = []; const commands = []; let hook; let change; let rows = []; let retry;
  t.after(() => {
    hook?.unmount();
    for (const source of sources) source.close();
    for (const [name, descriptor] of globals) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name]; }
  });
  globalThis.document = Object.assign(new EventTarget(), { visibilityState: "visible" });
  globalThis.window = new EventTarget();
  globalThis.EventSource = class {
    readyState = 0; onmessage = null; onerror = null;
    constructor(url) { this.url = url; sources.push(this); }
    close() { this.readyState = 2; }
    emit(event) { this.readyState = 1; this.onmessage?.({ data: JSON.stringify(event) }); }
  };
  t.mock.method(globalThis, "fetch", async (url, init = {}) => {
    const parsed = new URL(url, "http://test.invalid");
    if (parsed.pathname === "/api/models") return json({ models: {}, modelList: [] });
    if (parsed.pathname.startsWith("/api/agent/")) {
      if (init.body) { commands.push(JSON.parse(init.body)); return json({ success: true, data: {} }); }
      return json({ running: false, state: {} });
    }
    const match = parsed.pathname.match(/^\/api\/sessions\/([^/]+)(\/context|\/state)?$/);
    if (!match) throw new Error(`unexpected HTTP boundary: ${url}`);
    if (match[2] === "/state") return json({ running: false, state: {} });
    const pending = Promise.withResolvers();
    requests.push({ ...pending, sid: match[1], kind: match[2] ? "context" : parsed.searchParams.get("writtenFiles") === "1" ? "manifest" : "detail", leaf: parsed.searchParams.get("leafId"), before: parsed.searchParams.get("before") });
    return pending.promise;
  });
  function mount(id) {
    const props = { session: { id, cwd: "/repo", messageCount: 2 }, newSessionCwd: "/repo", newSessionDraftKey: null,
      onBranchDataChange: (_tree, _leaf, callback) => { change = callback; },
      onSessionFilesChange: (files, nextRetry) => { rows = JSON.parse(JSON.stringify(files.map(file => [file.filePath, file.writeCount]))); retry = nextRetry; } };
    return renderHook(options => {
      const state = useAgentSession(options);
      filesSlice.runInNewContext({ ...state, ...options, useMemo, useCallback, useEffect, useStreamingSelector, selectIsStreaming, selectHasStreamingContent, collectSessionWrittenFiles, sessionWrittenFileKey });
      return state;
    }, props);
  }
  hook = mount(sid);
  const reply = (kind, branch, { id = sid, leaf, status = 200 } = {}) => {
    const request = requests.find(entry => !entry.answered && entry.kind === kind && entry.sid === id && (kind === "detail" || entry.leaf === (leaf === undefined ? `leaf-${branch}` : leaf)));
    assert.ok(request, `expected ${kind} HTTP request for ${id}/${leaf ?? "default"}`);
    request.answered = true;
    const data = view(id, branch);
    request.resolve(status !== 200 ? new Response("unavailable", { status }) : json(kind === "detail" ? data : kind === "context" ? { context: data.context } : { sessionId: id, writtenFileManifest: data.writtenFileManifest }));
  };
  return { get hook() { return hook; }, get rows() { return rows; }, get retry() { return retry; }, change: leaf => change(leaf), reply, sources, requests, commands,
    remount(id) { hook.unmount(); hook = mount(id); } };
}

test("Files follow the latest selected branch/session while requests race, retaining full baselines and immediate live writes", async t => {
  const globals = new Map(["document", "window", "EventSource", "requestAnimationFrame", "cancelAnimationFrame"].map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  const sources = [];
  let hook;
  t.after(() => {
    hook?.unmount();
    for (const source of sources) source.close();
    for (const [name, descriptor] of globals) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name]; }
  });
  globalThis.document = Object.assign(new EventTarget(), { visibilityState: "visible" });
  globalThis.window = new EventTarget();
  globalThis.requestAnimationFrame = callback => setTimeout(callback, 0);
  globalThis.cancelAnimationFrame = clearTimeout;
  globalThis.EventSource = class {
    readyState = 0;
    onmessage = null;
    onerror = null;
    constructor(url) { this.url = url; sources.push(this); }
    close() { this.readyState = 2; }
    emit(event) { this.readyState = 1; this.onmessage?.({ data: JSON.stringify(event) }); }
  };
  const requests = [];
  let secondDetail;
  const defer = (kind, sid, leaf, before) => {
    const pending = Promise.withResolvers();
    requests.push({ ...pending, kind, sid, leaf, before });
    return pending.promise;
  };
  t.mock.method(globalThis, "fetch", async (url, init = {}) => {
    const parsed = new URL(url, "http://test.invalid");
    if (parsed.pathname === "/api/models") return json({ models: {}, modelList: [] });
    if (parsed.pathname.startsWith("/api/agent/")) {
      if (init.body) return json({ success: true, data: {} });
      return json({ running: false, state: {} });
    }
    if (/^\/api\/sessions\/(s1|s2)\/state$/.test(parsed.pathname)) return json({ running: false, state: {} });
    const session = parsed.pathname.match(/^\/api\/sessions\/(s1|s2)(\/context)?$/);
    if (!session) throw new Error(`unexpected HTTP boundary: ${url}`);
    const sid = session[1];
    const leaf = parsed.searchParams.get("leafId");
    if (session[2]) return defer("context", sid, leaf, parsed.searchParams.get("before"));
    if (parsed.searchParams.get("writtenFiles") === "1") return defer("manifest", sid, leaf);
    if (sid === "s2") { secondDetail = Promise.withResolvers(); return secondDetail.promise; }
    return json(view("s1", "a"));
  });
  let rows = [];
  let leafChange;
  const filesChanged = files => { rows = JSON.parse(JSON.stringify(files.map(file => [file.filePath, file.writeCount]))); };
  const branchChanged = (_tree, _leaf, change) => { leafChange = change; };
  function mount(sid) {
    const props = { session: sid ? { id: sid, cwd: "/repo", messageCount: 2 } : null, newSessionCwd: "/repo", newSessionDraftKey: sid ? null : "new:files", onBranchDataChange: branchChanged, onSessionFilesChange: filesChanged };
    return renderHook(options => {
      const state = useAgentSession(options);
      filesSlice.runInNewContext({ ...state, ...options, useMemo, useCallback, useEffect, useStreamingSelector, selectIsStreaming, selectHasStreamingContent, collectSessionWrittenFiles, sessionWrittenFileKey });
      return state;
    }, props);
  }
  hook = mount("s1");
  await settle(); hook.flush();
  assert.deepEqual(rows, expected("a"), "complete initial manifest includes unloaded history without double counting loaded writes");

  const oldPage = hook.result.loadContext("s1", "leaf-a", "a-call");
  const pendingB = leafChange("leaf-b"); hook.flush();
  assert.deepEqual(rows, [], "old branch rows must disappear while the new context/manifest is pending");
  const pendingC = leafChange("leaf-c"); hook.flush();
  assert.deepEqual(rows, [], "a second pending selection must not expose either earlier branch");
  function reply(sid, leaf, branch, { manifestStatus = 200, before = null } = {}) {
    const data = view(sid, branch);
    requests.find(request => request.kind === "context" && request.sid === sid && request.leaf === leaf && request.before === before && !request.answered).resolve(json({ context: data.context }));
    requests.find(request => request.kind === "context" && request.sid === sid && request.leaf === leaf && request.before === before && !request.answered).answered = true;
    if (!before) {
      const manifest = requests.find(request => request.kind === "manifest" && request.sid === sid && request.leaf === leaf && !request.answered);
      manifest.resolve(manifestStatus === 200 ? json({ sessionId: sid, writtenFileManifest: data.writtenFileManifest }) : new Response("unavailable", { status: manifestStatus }));
      manifest.answered = true;
    }
  }
  reply("s1", "leaf-c", "c"); await pendingC; hook.flush();
  assert.deepEqual(rows, expected("c"), "the latest selection exposes its full branch only");
  reply("s1", "leaf-b", "b"); await pendingB; hook.flush();
  assert.deepEqual(rows, expected("c"), "an older replacement response must not overwrite the selected branch");
  reply("s1", "leaf-a", "a", { before: "a-call" }); await oldPage; hook.flush();
  assert.deepEqual(rows, expected("c"), "an old pagination response cannot prepend files from the previous branch");
  assert.deepEqual(hook.result.messages.map(message => message.toolCallId ?? message.content[0].toolCallId), ["c-visible", "c-visible"]);

  const pendingDefault = leafChange(null); hook.flush();
  assert.deepEqual(rows, []);
  reply("s1", null, "default"); await pendingDefault; hook.flush();
  assert.deepEqual(rows, [], "an unconfirmed default-leaf manifest is not presented as a complete file list");

  const failedManifest = leafChange("leaf-e"); hook.flush();
  reply("s1", "leaf-e", "e", { manifestStatus: 503 }); await failedManifest; hook.flush();
  assert.deepEqual(rows, [], "a failed manifest must not present loaded/live rows and counts as complete");
  const retry = leafChange("leaf-e"); hook.flush();
  reply("s1", "leaf-e", "e"); await retry; hook.flush();
  assert.deepEqual(rows, expected("e"), "a later successful read restores the full baseline");

  const abandoned = leafChange("leaf-b"); hook.flush();
  hook.unmount();
  assert.deepEqual(rows, [], "the outgoing ChatWindow Files effect clears its rows");
  hook = mount("s2"); await settle(); hook.flush();
  assert.deepEqual(rows, [], "a new session cannot display the outgoing session's files");
  reply("s1", "leaf-b", "b"); await abandoned; hook.flush();
  assert.deepEqual(rows, [], "an outgoing-session response must not emit files into the new session");
  secondDetail.resolve(json(view("s2", "g"))); await settle(); hook.flush();
  assert.deepEqual(rows, expected("g"));

  const liveSource = sources.find(source => source.url.includes("/s2/") && source.readyState !== 2);
  liveSource.emit({ type: "connected", sessionId: "s2", isStreaming: false });
  liveSource.emit({ type: "agent_start" });
  liveSource.emit({ type: "message_start", message: call("g-live", "/repo/g.html") });
  liveSource.emit({ type: "message_end", message: call("g-live", "/repo/g.html") });
  liveSource.emit({ type: "message_end", message: result("g-live", 30) });
  hook.flush();
  assert.deepEqual(rows, [["/repo/g.html", 2], ["/repo/g-old.md", 1]], "a confirmed live write is immediate, while the old complete baseline and UI leaf remain intact");

  // Existing public hook state controls also cover a call still held solely in
  // the actual streamingStore, not in loaded assistant messages.
  hook.result.dispatch({ type: "snapshot", message: call("store-only", "/repo/store.html") });
  hook.result.setMessages([...hook.result.messages, result("store-only", 40)]); hook.flush();
  assert.deepEqual(rows, [["/repo/store.html", 1], ["/repo/g.html", 2], ["/repo/g-old.md", 1]]);

  hook.unmount(); hook = mount(null); await settle(); hook.flush();
  hook.result.dispatch({ type: "snapshot", message: call("new-live", "/repo/new.html") });
  hook.result.setMessages([result("new-live", 50)]); hook.flush();
  assert.deepEqual(rows, [["/repo/new.html", 1]], "a fresh composer with no persisted baseline still exposes confirmed streaming writes immediately");
});

test("a settled full-session refresh cannot take the view back from a newer selected branch", async t => {
  const mounted = mountedFiles(t, "refresh");
  mounted.reply("detail", "a"); await settle(); mounted.hook.flush();
  assert.deepEqual(mounted.rows, expected("a"));
  const source = mounted.sources[0];
  source.emit({ type: "connected", sessionId: "refresh", isStreaming: false });
  source.emit({ type: "agent_start" });
  source.emit({ type: "agent_settled" });
  mounted.hook.flush();
  const selected = mounted.change("leaf-b"); mounted.hook.flush();
  assert.deepEqual(mounted.rows, []);
  mounted.reply("detail", "a"); await settle(); mounted.hook.flush();
  assert.deepEqual(mounted.rows, [], "an older settled detail response must not restore A while selected B is pending");
  assert.equal(mounted.hook.result.activeLeafId, "leaf-b");
  mounted.reply("context", "b"); mounted.reply("manifest", "b"); await selected; mounted.hook.flush();
  assert.deepEqual(mounted.rows, expected("b"));
  assert.ok(mounted.commands.some(command => command.type === "navigate_tree" && command.targetId === "leaf-b"), "the still-selected branch navigation reaches the HTTP boundary");
  source.emit({ type: "agent_start" }); source.emit({ type: "agent_settled" });
  mounted.reply("detail", "b"); await settle(); mounted.hook.flush();
  assert.deepEqual(mounted.rows, expected("b"), "a normal current-selection settled refresh remains usable");
  source.emit({ type: "agent_start" }); source.emit({ type: "agent_settled" }); mounted.hook.flush();
  const obsolete = mounted.requests.find(request => !request.answered && request.kind === "detail");
  const latest = mounted.change("leaf-c"); mounted.hook.flush();
  mounted.reply("context", "c"); mounted.reply("manifest", "c"); await latest; mounted.hook.flush();
  assert.equal(mounted.hook.result.error, null);
  obsolete.answered = true; obsolete.reject(new TypeError("synthetic obsolete fetch failure"));
  await settle(); mounted.hook.flush();
  assert.equal(mounted.hook.result.error, null, "an obsolete rejected refresh cannot hide the successfully selected chat behind an error page");
  assert.deepEqual(mounted.rows, expected("c"));
});


test("an unavailable complete manifest is explicit and retry restores only the still-selected branch", async t => {
  const mounted = mountedFiles(t, "failure");
  mounted.reply("detail", "a"); await settle(); mounted.hook.flush();
  mounted.sources[0].emit({ type: "connected", sessionId: "failure", isStreaming: false });
  const selected = mounted.change("leaf-e"); mounted.hook.flush();
  mounted.reply("context", "e"); mounted.reply("manifest", "e", { status: 503 }); await selected; mounted.hook.flush();
  assert.equal(mounted.hook.result.messages.length, 2, "chat remains usable when the independent file manifest fails");
  assert.deepEqual(mounted.rows, [], "partial loaded file totals are not exposed as a complete list");
  assert.equal(typeof mounted.retry, "function", "the Files callback carries an explicit retry state");
  const recovered = mounted.retry();
  mounted.reply("manifest", "e"); await recovered; mounted.hook.flush();
  assert.deepEqual(mounted.rows, expected("e"));
  assert.equal(mounted.retry, undefined, "successful retry clears the incomplete state");
  const sameBranch = mounted.change("leaf-e"); mounted.hook.flush();
  mounted.reply("context", "e"); mounted.reply("manifest", "e", { status: 503 }); await sameBranch; mounted.hook.flush();
  assert.deepEqual(mounted.rows, expected("e"), "a valid same-leaf baseline is retained rather than replaced by a subset");
  const failedB = mounted.change("leaf-b"); mounted.hook.flush();
  mounted.reply("context", "b"); mounted.reply("manifest", "b", { status: 503 }); await failedB; mounted.hook.flush();
  const obsoleteRetry = mounted.retry();
  const newerC = mounted.change("leaf-c"); mounted.hook.flush();
  mounted.reply("context", "c"); mounted.reply("manifest", "c"); await newerC; mounted.hook.flush();
  mounted.reply("manifest", "b", { leaf: "leaf-b" }); await obsoleteRetry; mounted.hook.flush();
  assert.deepEqual(mounted.rows, expected("c"), "a late retry cannot leak another branch into the selected list");
  const failedD = mounted.change("leaf-d"); mounted.hook.flush();
  mounted.reply("context", "d"); mounted.reply("manifest", "d", { status: 503 }); await failedD; mounted.hook.flush();
  const outgoingRetry = mounted.retry(); mounted.remount("next");
  mounted.reply("manifest", "d"); await outgoingRetry; mounted.hook.flush();
  assert.deepEqual(mounted.rows, [], "an outgoing-session retry cannot expose files in the new session");
  mounted.reply("detail", "g", { id: "next" }); await settle(); mounted.hook.flush();
  assert.deepEqual(mounted.rows, expected("g"));
});

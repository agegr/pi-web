import assert from "node:assert/strict";
import { mock, test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createJiti } from "jiti";

// A prompt request that fails after it left the page (#1432). The composer was
// cleared before the request, so the text must not be lost; nothing is sent
// again either. A definite refusal (`prompt_rejected` + `accepted: false`) says
// it was not sent. A network error or a proxy's answer cannot say:
// - a steer or follow-up has no bubble, so its text comes back at once, with a
//   notice that the send is unconfirmed;
// - a normal send keeps its bubble, and its text comes back only once the
//   server is idle and a session read shows the prompt never arrived, or when
//   the page leaves it unsettled. An event of the run means it arrived.
// The text goes in front of what was typed since; another session's draft is
// left alone.
const shimPath = fileURLToPath(new URL("./__fixtures__/react-hook-shim.mjs", import.meta.url));
const jiti = createJiti(import.meta.url, { tsconfigPaths: true, alias: { react: shimPath } });
const { renderHook } = await import(pathToFileURL(shimPath).href);
const { useAgentSession } = await jiti.import("./useAgentSession.ts");
const { clearDraft, getDraft, setDraft } = await jiti.import("@/lib/draft-store");
const { deleteSessionViewSnapshot, getSessionViewSnapshot } = await jiti.import("@/lib/session-view-cache");

globalThis.document ??= Object.assign(new EventTarget(), { visibilityState: "visible" });
globalThis.window ??= new EventTarget();

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const settle = async () => { for (let index = 0; index < 10; index++) await new Promise((resolve) => setImmediate(resolve)); };
const image = { data: "AQID", mimeType: "image/png", previewUrl: "blob:image" };
const restoredImages = [{ data: "AQID", mimeType: "image/png" }];
const earlier = { role: "user", content: "earlier", timestamp: 1 };
const reply = (text) => ({ role: "assistant", content: [{ type: "text", text }] });
const outcomes = {
  network: () => { throw new TypeError("Failed to fetch"); },
  proxy503: () => new Response("Service Unavailable", { status: 503 }),
  rejected: () => json({ error: "Rejected by the server", code: "prompt_rejected", accepted: false }, 500),
  accepted: () => json({ success: true, data: null }),
};

// Notices show their translation keys.
async function setup({ fresh = false, context } = {}) {
  const t = (key) => key;
  mock.timers.enable({ apis: ["setTimeout", "setInterval", "Date"] });
  const sid = fresh ? "s1" : "A";
  const sources = [];
  const prompts = [];
  // What the server says: its run state, the session's context (and a branch's,
  // for the branch switch), whether status and session reads get through, how
  // the prompt request ends. A prompt "previous" is accepted at once.
  const server = {
    running: false,
    statusDown: false,
    readsDown: false,
    context: context ?? (fresh ? { messages: [], entryIds: [] } : { messages: [earlier], entryIds: ["e1"] }),
    branchContext: null,
    leafChange: null,
    response: Promise.withResolvers(),
    outcome: "network",
  };
  globalThis.EventSource = class {
    readyState = 0;
    onmessage = null;
    onerror = null;
    constructor(url) { this.url = url; sources.push(this); }
    close() { this.readyState = 2; }
    emit(event) {
      this.readyState = 1;
      this.onmessage?.({ data: JSON.stringify(event) });
    }
  };
  const state = () => ({ running: server.running, state: { isStreaming: server.running, isPromptRunning: server.running } });
  globalThis.fetch = async (requestUrl, init = {}) => {
    const url = requestUrl.replace("?systemPrompt=0", "");
    if (url.startsWith("/api/models")) return json({ models: {}, modelList: [] });
    if (url === "/api/agent/new") return json({ sessionId: sid });
    if (url.startsWith(`/api/sessions/${sid}/context?`)) return json({ context: { ...server.branchContext, oldestEntryId: null, hasMore: false } });
    if (url.startsWith(`/api/sessions/${sid}?`)) {
      if (server.readsDown) throw new TypeError("Failed to fetch");
      // The revision follows the file, as the server's: a prompt that never
      // arrived leaves it unchanged, and the hook then keeps its view's messages.
      const snapshotRevision = `r:${server.context.entryIds.join(",")}`;
      return json({ sessionId: sid, filePath: `/${sid}.jsonl`, leafId: null, tree: [], treeFormat: "summary", snapshotRevision, context: { ...server.context, oldestEntryId: null, hasMore: false } });
    }
    if (url === `/api/sessions/${sid}/state`) return json(state());
    if (url === `/api/agent/${sid}` && init.body) {
      const command = JSON.parse(init.body);
      if (command.type !== "prompt") return json({ success: true, data: null });
      prompts.push(command);
      if (command.message === "previous") return json({ success: true, data: null });
      await server.response.promise;
      return outcomes[server.outcome]();
    }
    if (url === `/api/agent/${sid}`) {
      if (server.statusDown) throw new TypeError("Failed to fetch");
      return json(state());
    }
    return json({});
  };
  const hook = renderHook(useAgentSession, fresh
    ? { session: null, newSessionCwd: "/project", newSessionDraftKey: "new:draft", t }
    : {
        session: { id: "A", cwd: "/project", path: "/A.jsonl", name: "A" }, newSessionCwd: null, newSessionDraftKey: null, t,
        onBranchDataChange: (_tree, _leaf, change) => { server.leafChange = change; },
      });
  await settle();
  hook.flush();
  const connect = async () => {
    for (const source of sources) if (source.readyState === 0) source.emit({ type: "connected", sessionId: sid, isStreaming: false });
    await settle();
    hook.flush();
  };
  await connect();
  const tick = async (ms) => {
    for (let left = ms; left > 0; left -= 100) {
      mock.timers.tick(Math.min(100, left));
      await settle();
      hook.flush();
    }
  };
  const emit = async (event) => {
    sources.filter((source) => source.readyState === 1).at(-1)?.emit(event);
    await settle();
    hook.flush();
  };
  // Fails the request under way the given way, then lets the page react.
  const answer = async (outcome) => {
    server.outcome = outcome;
    server.response.resolve();
    await settle();
    hook.flush();
  };
  const notices = () => hook.result.notices.map(({ type, message }) => [type, message]);
  const isBubble = (message) => message.role === "user" && JSON.stringify(message.content).includes("first submission");
  const bubble = () => hook.result.messages.some(isBubble);
  // The session's cached view, which a read of an unchanged file keeps.
  const cachedBubble = () => Boolean(getSessionViewSnapshot(sid)?.messages.some(isBubble));
  let unmounted = false;
  const unmount = () => { if (!unmounted) { unmounted = true; hook.unmount(); } };
  const teardown = () => {
    unmount();
    for (const source of sources) source.close();
    mock.timers.reset();
    for (const key of ["A", "B", "s1", "new:draft", "parked-new:/project"]) clearDraft(key);
    // A cached view would open the next test's session on this one's messages.
    for (const key of ["A", "s1"]) deleteSessionViewSnapshot(key);
  };
  return { hook, sid, server, prompts, connect, tick, emit, answer, notices, bubble, cachedBubble, unmount, teardown };
}

async function withSetup(options, body) {
  const originalError = console.error;
  console.error = () => {};
  const env = await setup(options);
  try {
    setDraft("B", { value: "draft in B", images: [] });
    await body(env);
    assert.equal(getDraft("B").value, "draft in B", "another session's draft is left alone");
    assert.equal(env.prompts.filter(({ message }) => message !== "previous").length, 1, "nothing is sent again");
  } finally {
    console.error = originalError;
    env.teardown();
  }
}

// Sends "first submission" with an image and types "second draft" while the request is out.
async function sendNormal(env) {
  const sending = env.hook.result.handleSend("first submission", [image]);
  await settle();
  await env.connect();
  assert.equal(env.prompts.length, 1, "the prompt request is out");
  setDraft(env.sid, { value: "second draft", images: [] });
  return { sending };
}

for (const outcome of ["network", "proxy503"]) {
  test(`normal send, ${outcome}: the bubble stays, the text comes back once an idle server shows it never arrived`, async () => {
    await withSetup({}, async (env) => {
      const { sending } = await sendNormal(env);
      await env.answer(outcome);
      await sending;
      assert.equal(getDraft("A").value, "second draft", "no restore while it is unknown");
      assert.ok(env.bubble(), "the bubble stays, copyable");
      assert.deepEqual(env.notices(), []);

      await env.tick(1_000);
      assert.equal(getDraft("A").value, "first submission\n\nsecond draft");
      assert.deepEqual(getDraft("A").images, restoredImages);
      assert.ok(!env.bubble(), "the bubble goes, though the read found the file unchanged");
      assert.ok(!env.cachedBubble(), "and the cached view loses it");
      assert.deepEqual(env.notices(), [["error", "chat.sendNotReceived"]]);

      await env.tick(30_000);
      assert.equal(getDraft("A").value, "first submission\n\nsecond draft", "restored once");
    });
  });
}

for (const [label, event, before] of [
  ["agent_start before the request failed", { type: "agent_start" }, true],
  ["prompt_done after the request failed", { type: "prompt_done" }, false],
  ["queue_update after the request failed", { type: "queue_update", steering: [], followUp: ["first submission"] }, false],
  ["its user message after the request failed", { type: "message_end", message: { role: "user", content: "first submission (expanded)" } }, false],
]) {
  test(`normal send: ${label} means it arrived, so nothing comes back`, async () => {
    await withSetup({}, async (env) => {
      const { sending } = await sendNormal(env);
      if (before) await env.emit(event);
      await env.answer("network");
      await sending;
      if (!before) await env.emit(event);
      await env.tick(30_000);
      env.unmount();
      assert.equal(getDraft("A").value, "second draft");
      assert.deepEqual(env.notices(), []);
    });
  });
}

test("normal send: a read that moved on past the send means it arrived, so nothing comes back", async () => {
  await withSetup({}, async (env) => {
    const { sending } = await sendNormal(env);
    await env.answer("network");
    await sending;
    env.server.context = {
      messages: [earlier, { role: "user", content: [{ type: "text", text: "first submission" }, { type: "image", data: "AQID", mimeType: "image/png" }] }, { role: "assistant", content: [{ type: "text", text: "reply" }] }],
      entryIds: ["e1", "e2", "e3"],
    };
    await env.tick(30_000);
    env.unmount();
    assert.equal(getDraft("A").value, "second draft");
    assert.deepEqual(env.notices(), []);
  });
});

test("normal send: past the settle wait, coming back online reconciles and gives the text back", async () => {
  await withSetup({}, async (env) => {
    const { sending } = await sendNormal(env);
    env.server.statusDown = true;
    await env.answer("network");
    await sending;
    await env.tick(25_000);
    assert.equal(getDraft("A").value, "second draft", "the settle wait gave up without knowing");
    assert.ok(env.bubble());

    env.server.statusDown = false;
    window.dispatchEvent(new Event("online"));
    await settle();
    env.hook.flush();
    await settle();
    env.hook.flush();
    assert.equal(getDraft("A").value, "first submission\n\nsecond draft");
    assert.deepEqual(env.notices(), [["error", "chat.sendNotReceived"]]);
  });
});

test("normal send: switching away with the send unsettled gives the text back to its session's draft", async () => {
  await withSetup({}, async (env) => {
    const { sending } = await sendNormal(env);
    await env.answer("proxy503");
    await sending;
    env.unmount();
    assert.equal(getDraft("A").value, "first submission\n\nsecond draft");
    assert.deepEqual(getDraft("A").images, restoredImages);
    assert.ok(!env.cachedBubble(), "coming back shows no bubble beside the restored text");
  });
});

test("normal send: switching away after the run was seen to start gives nothing back", async () => {
  await withSetup({}, async (env) => {
    const { sending } = await sendNormal(env);
    await env.emit({ type: "agent_start" });
    await env.answer("network");
    await sending;
    env.unmount();
    assert.equal(getDraft("A").value, "second draft");
  });
});

test("fresh composer: leaving it while the first prompt is out parks the text in its cwd", async () => {
  await withSetup({ fresh: true }, async (env) => {
    const sending = env.hook.result.handleSend("first submission", [image]);
    await settle();
    await env.connect();
    assert.equal(env.prompts.length, 1);
    env.unmount();
    await env.answer("network");
    await sending;
    await settle();
    assert.equal(getDraft("parked-new:/project").value, "first submission");
    assert.deepEqual(getDraft("parked-new:/project").images, restoredImages);
    assert.equal(getDraft("s1"), null, "no draft under a session that has no row");
  });
});

for (const mode of ["steer", "followUp"]) {
  for (const outcome of ["network", "proxy503"]) {
    test(`${mode}, ${outcome}: the text comes back at once as unconfirmed`, async () => {
      await withSetup({}, async (env) => {
        const sending = env.hook.result[mode === "steer" ? "handleSteer" : "handleFollowUp"]("first submission", [image]);
        await settle();
        setDraft("A", { value: "second draft", images: [] });
        await env.answer(outcome);
        await sending;
        assert.equal(getDraft("A").value, "first submission\n\nsecond draft");
        assert.deepEqual(getDraft("A").images, restoredImages);
        assert.deepEqual(env.notices(), [["warning", "chat.sendUnconfirmed"]]);
      });
    });
  }

  test(`${mode}: a definite refusal gives the text back as failed`, async () => {
    await withSetup({}, async (env) => {
      const sending = env.hook.result[mode === "steer" ? "handleSteer" : "handleFollowUp"]("first submission", [image]);
      await settle();
      setDraft("A", { value: "second draft", images: [] });
      await env.answer("rejected");
      await sending;
      assert.equal(getDraft("A").value, "first submission\n\nsecond draft");
      assert.deepEqual(env.notices(), [["error", "Rejected by the server"]]);
    });
  });

  test(`${mode}: an accepted prompt leaves the draft typed since alone`, async () => {
    await withSetup({}, async (env) => {
      const sending = env.hook.result[mode === "steer" ? "handleSteer" : "handleFollowUp"]("first submission", [image]);
      await settle();
      setDraft("A", { value: "second draft", images: [] });
      await env.answer("accepted");
      await sending;
      assert.equal(getDraft("A").value, "second draft");
      assert.deepEqual(env.notices(), []);
    });
  });
}

test("normal send: a definite refusal gives the text back at once and drops the bubble", async () => {
  await withSetup({}, async (env) => {
    const { sending } = await sendNormal(env);
    await env.answer("rejected");
    await sending;
    assert.equal(getDraft("A").value, "first submission\n\nsecond draft");
    assert.ok(!env.bubble());
    assert.deepEqual(env.notices(), [["error", "Rejected by the server"]]);
  });
});

// The same text earlier in the session is not the prompt arriving.
test("normal send: the same text sent before is not this prompt arriving", async () => {
  const sent = { role: "user", content: [{ type: "text", text: "first submission" }, { type: "image", data: "AQID", mimeType: "image/png" }] };
  await withSetup({ context: { messages: [sent, reply("an earlier reply")], entryIds: ["e1", "e2"] } }, async (env) => {
    const { sending } = await sendNormal(env);
    await env.answer("network");
    await sending;
    await env.tick(1_000);
    assert.equal(getDraft("A").value, "first submission\n\nsecond draft");
    assert.deepEqual(env.notices(), [["error", "chat.sendNotReceived"]]);
  });
});

test("normal send: after a branch switch, a send the server never got comes back", async () => {
  await withSetup({}, async (env) => {
    env.server.branchContext = { messages: [earlier, { role: "user", content: "other" }, reply("other reply")], entryIds: ["e1", "e4", "e5"] };
    await env.server.leafChange("e5");
    await settle();
    env.hook.flush();
    env.server.context = env.server.branchContext;
    const { sending } = await sendNormal(env);
    await env.answer("network");
    await sending;
    await env.tick(1_000);
    assert.equal(getDraft("A").value, "first submission\n\nsecond draft");
    assert.deepEqual(env.notices(), [["error", "chat.sendNotReceived"]]);
  });
});

test("normal send: when the previous run's reload failed, a send the server never got comes back as unconfirmed", async () => {
  await withSetup({}, async (env) => {
    // The same text as the previous prompt: the view already has it unsaved, the read has it saved.
    const first = env.hook.result.handleSend("first submission", [image]);
    await settle();
    await env.connect();
    await env.answer("accepted");
    await first;
    const previous = { role: "user", content: [{ type: "text", text: "first submission" }, { type: "image", data: "AQID", mimeType: "image/png" }] };
    await env.emit({ type: "agent_start" });
    await env.emit({ type: "message_end", message: previous });
    await env.emit({ type: "message_end", message: reply("prev reply") });
    env.server.context = { messages: [earlier, previous, reply("prev reply")], entryIds: ["e1", "e2", "e3"] };
    env.server.readsDown = true;
    await env.emit({ type: "agent_end" });
    await env.emit({ type: "agent_settled" });
    await env.emit({ type: "prompt_done" });
    await env.tick(200);
    env.server.readsDown = false;
    assert.equal(env.hook.result.agentRunning, false, "the previous run settled in the view");
    env.prompts.length = 0;
    env.server.response = Promise.withResolvers();

    const { sending } = await sendNormal(env);
    await env.answer("network");
    await sending;
    await env.tick(1_000);
    assert.equal(getDraft("A").value, "first submission\n\nsecond draft");
    assert.deepEqual(env.notices(), [["warning", "chat.sendUnconfirmed"]], "the read moved on past what the view had saved");
  });
});

test("normal send: a session read that fails once the server is idle gives the text back as unconfirmed", async () => {
  await withSetup({}, async (env) => {
    const { sending } = await sendNormal(env);
    await env.answer("network");
    await sending;
    env.server.readsDown = true;
    await env.tick(1_000);
    assert.equal(getDraft("A").value, "first submission\n\nsecond draft");
    assert.deepEqual(env.notices(), [["warning", "chat.sendUnconfirmed"]]);
    assert.ok(env.bubble(), "with no read, the view is stale and keeps the bubble");
  });
});

test("normal send: a command is never called not received", async () => {
  await withSetup({}, async (env) => {
    const sending = env.hook.result.handleSend("/deploy now");
    await settle();
    await env.connect();
    setDraft("A", { value: "second draft", images: [] });
    await env.answer("network");
    await sending;
    await env.tick(1_000);
    assert.equal(getDraft("A").value, "/deploy now\n\nsecond draft");
    assert.deepEqual(env.notices(), [["warning", "chat.sendUnconfirmed"]]);
  });
});

test("normal send: switching away while the request is out gives the text back to its session's draft", async () => {
  await withSetup({}, async (env) => {
    const { sending } = await sendNormal(env);
    env.unmount();
    assert.ok(env.cachedBubble(), "the view was cached with the request still out");
    await env.answer("network");
    await sending;
    await settle();
    assert.equal(getDraft("A").value, "first submission\n\nsecond draft");
    assert.deepEqual(getDraft("A").images, restoredImages);
    assert.ok(!env.cachedBubble(), "giving the text back takes the bubble out of the cached view");
  });
});

test("fresh composer: still open, its text comes back once the idle server shows it never arrived", async () => {
  await withSetup({ fresh: true }, async (env) => {
    const sending = env.hook.result.handleSend("first submission", [image]);
    await settle();
    await env.connect();
    setDraft("new:draft", { value: "second draft", images: [] });
    await env.answer("proxy503");
    await sending;
    assert.equal(getDraft("new:draft").value, "second draft");
    await env.tick(1_000);
    assert.equal(getDraft("new:draft").value, "first submission\n\nsecond draft");
    assert.deepEqual(getDraft("new:draft").images, restoredImages);
    assert.deepEqual(env.notices(), [["error", "chat.sendNotReceived"]]);
  });
});

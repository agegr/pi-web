import assert from "node:assert/strict";
import fs from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";
import { fauxAssistantMessage, fauxProvider, fauxText, fauxToolCall, getCurrentTools } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import { createAgentSessionFromServices, createAgentSessionServices, ModelRuntime, SessionManager, SettingsManager } from "@earendil-works/pi-coding-agent";
import { Check } from "typebox/value";

const jiti = createJiti(import.meta.url);
const { createKanbanExtension } = await jiti.import("./kanban-extension.ts");
const { allowFileRoot } = await jiti.import("./file-access.ts");
const { kanbanBoardPath, encodeKanbanProjectKey } = await jiti.import("./kanban-data.ts");
const { readBoard, getBoardRevision, applyMutation } = await jiti.import("./kanban-store.ts");
const { appendSessionToolSelection, appendClearedSessionToolSelection } = await jiti.import("./session-tool-selection.ts");
const { kanbanCardKey } = await jiti.import("./kanban-types.ts");

async function fixture(t, options) {
  const previous = process.env.PI_CODING_AGENT_DIR;
  const root = fs.realpathSync(fs.mkdtempSync(join(tmpdir(), "kanban-sdk-")));
  const project = join(root, "project");
  const agentDir = join(root, "agent");
  fs.mkdirSync(project);
  fs.mkdirSync(agentDir);
  process.env.PI_CODING_AGENT_DIR = agentDir;
  allowFileRoot(root);
  const faux = fauxProvider({ models: [{ id: "faux-model" }] });
  const modelRuntime = await ModelRuntime.create({ authPath: join(agentDir, "auth.json"), modelsPath: null, refreshOnCreate: false });
  modelRuntime.registerNativeProvider(faux.provider);
  const nested = [];
  const services = await createAgentSessionServices({
    cwd: project, agentDir, modelRuntime, settingsManager: SettingsManager.inMemory(),
    resourceLoaderOptions: {
      noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true,
      extensionFactories: [createKanbanExtension(options), (pi) => pi.registerTool({
        name: "script", label: "Script", description: "Nested tool caller like codemode", parameters: Type.Object({ request: Type.Any() }),
        async execute(_id, params, signal, _onUpdate, ctx) {
          const result = await ctx.executeTool("kanban", params.request, { signal });
          nested.push(result);
          return { ...result.result, isError: result.isError };
        },
      })],
    },
  });
  const manager = SessionManager.create(project, join(agentDir, "sessions", encodeKanbanProjectKey(project)));
  const { session } = await createAgentSessionFromServices({ services, sessionManager: manager, model: faux.getModel("faux-model") });
  t.after(() => {
    session.dispose();
    if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previous;
    fs.rmSync(root, { recursive: true, force: true });
  });
  // ToolInfo and persisted transcript messages omit outputSchema/structuredContent;
  // active definitions and execution events carry them, as do nested outcomes.
  const definition = session.agent.state.tools.find((tool) => tool.name === "kanban");
  const executions = [];
  session.subscribe((event) => { if (event.type === "tool_execution_end") executions.push(event); });
  const invoke = async (request, via = "kanban") => {
    faux.setResponses([
      fauxAssistantMessage([fauxToolCall(via, via === "script" ? { request } : request)], { stopReason: "toolUse" }),
      fauxAssistantMessage([fauxText("done")]),
    ]);
    await session.prompt("Use the requested tool.");
    const message = session.agent.state.messages.findLast((m) => m.role === "toolResult" && m.toolName === via);
    const execution = executions.findLast((e) => e.toolName === via && !e.parentToolCallId);
    assert.deepEqual(message.content, execution.result.content);
    assert.deepEqual(message.details, execution.result.details);
    return { ...execution.result, isError: execution.isError };
  };
  const output = (message) => {
    assert.equal(message?.isError, false, JSON.stringify(message));
    assert.equal(Check(definition.outputSchema, message.structuredContent), true, JSON.stringify(message.structuredContent));
    assert.deepEqual(JSON.parse(message.content[0].text), message.structuredContent, "model receives the same data as scripts");
    return message.structuredContent;
  };
  return { project, manager, session, faux, nested, definition, invoke, output, path: kanbanBoardPath(project) };
}

test("real SDK declares the flat tool; model and nested calls persist cards and matching typed content", async (t) => {
  const f = await fixture(t);
  assert.ok(f.session.getActiveToolNames().includes("kanban"));
  assert.ok(f.session.getCallableToolNames().includes("kanban"));
  assert.equal(f.definition.parameters.type, "object");
  const before = f.output(await f.invoke({ action: "read" }));
  assert.equal(before.revision, 0);
  assert.equal(before.currentCard, null);
  assert.equal(before.totalCards, 0);
  assert.equal(before.lanes.length, 6);
  assert.equal(before.lanes[0].cardCount, 0);
  assert.deepEqual(before.lanes[0].description, "Waiting work, no session yet");
  assert.equal(fs.existsSync(f.path), false, "discovery creates no board file");
  const created = f.output(await f.invoke({ action: "create", title: "independent", description: "keep" }));
  assert.equal(created.card.sessionId, null);
  assert.equal(created.lane.id, "lane-backlog");
  const claimed = f.output(await f.invoke({ action: "update", cardId: created.card.id, laneId: "lane-plan", title: "claimed" }, "script"));
  assert.equal(claimed.card.sessionId, f.session.sessionId);
  assert.equal(claimed.card.description, "keep");
  assert.equal(claimed.currentCardId, created.card.id);
  assert.equal(f.nested.at(-1).isError, false);
  const done = f.output(await f.invoke({ action: "update", laneId: "lane-done", description: "" }));
  assert.equal(done.nextLaneId, null);
  assert.equal(done.revision, claimed.revision + 1);
  const same = f.output(await f.invoke({ action: "update", laneId: "lane-done" }));
  assert.equal(same.revision, done.revision);
  const read = f.output(await f.invoke({ action: "read", cardId: done.card.id }, "script"));
  assert.deepEqual(read.card, done.card);
  assert.equal(read.lane.id, "lane-done");
  assert.equal(read.nextLaneId, null);
  assert.equal(read.currentCardId, done.card.id);
  const search = f.output(await f.invoke({ action: "search", query: "CLAIM" }));
  assert.deepEqual(search.cards.map((card) => card.id), [done.card.id]);
  assert.equal(search.cards[0].linked, true);
  assert.equal(search.hasMore, false);
  assert.equal(search.currentCardId, done.card.id);
  // A note on the session's own card, through the real SDK: persisted, counted,
  // and carried by the next one-card read (the handoff the next run needs).
  const commented = f.output(await f.invoke({ action: "comment", body: "Next: wire the route." }, "script"));
  assert.equal(commented.action, "comment");
  assert.equal(commented.comment.author, "agent");
  assert.equal(commented.comment.sessionId, f.session.sessionId);
  assert.equal(commented.comment.cardId, done.card.id, "an omitted cardId is this session's card");
  assert.equal(commented.revision, same.revision + 1);
  const withComments = f.output(await f.invoke({ action: "read", cardId: done.card.id }));
  assert.deepEqual(withComments.comments.map((comment) => comment.body), ["Next: wire the route."]);
  assert.equal(withComments.commentCount, 1);
  const overview = f.output(await f.invoke({ action: "read" }));
  assert.equal(overview.totalCards, 1);
  assert.equal(overview.currentCard.description, "");
  assert.equal(overview.lanes.find((lane) => lane.id === "lane-done").cardCount, 1);
  assert.equal((await getBoardRevision(f.project)).revision, commented.revision, "a comment bumps the revision like a card write");
  const doneRow = { ...done.card };
  delete doneRow.key;
  assert.deepEqual((await readBoard(f.project, { create: false })).board.cards, [doneRow], "the card itself is untouched by the note");
  let declared;
  f.faux.setResponses([(context) => {
    declared = getCurrentTools(context.messages).find((tool) => tool.name === "kanban");
    return fauxAssistantMessage([fauxText("done")]);
  }]);
  await f.session.prompt("Check declarations.");
  assert.ok(declared);
  assert.deepEqual(Object.keys(declared.parameters.properties).sort(), ["action", "body", "cardId", "description", "laneId", "limit", "query", "title"]);
});

test("real SDK read-only pin blocks direct AND nested mutations, allows reads, follows later selections", async (t) => {
  const f = await fixture(t);
  appendSessionToolSelection(f.manager, ["read", "grep", "find", "ls"]);
  for (const via of ["kanban", "script"]) {
    const read = f.output(await f.invoke({ action: "read" }, via));
    assert.equal(read.revision, 0);
    for (const request of [{ action: "create", title: "blocked" }, { action: "update", title: "blocked" }]) {
      const result = await f.invoke(request, via);
      assert.equal(result.isError, true);
      assert.equal(result.structuredContent.code, "read-only");
      assert.equal(Check(f.definition.outputSchema, result.structuredContent), true);
      assert.match(result.content[0].text, /read-only/);
      assert.equal(fs.existsSync(f.path), false);
    }
  }
  appendSessionToolSelection(f.manager, ["read", "write"]);
  const created = f.output(await f.invoke({ action: "create", title: "allowed", laneId: "lane-todo" }, "script"));
  appendSessionToolSelection(f.manager, ["read"]);
  assert.equal((await f.invoke({ action: "update", title: "blocked" }, "script")).isError, true);
  assert.equal((await getBoardRevision(f.project)).revision, created.revision);
  appendClearedSessionToolSelection(f.manager);
  assert.equal(f.output(await f.invoke({ action: "update", title: "allowed again" })).card.title, "allowed again");
});

test("real SDK child callback is authoritative and queried on nested calls", async (t) => {
  let readOnly = true;
  const seen = [];
  const f = await fixture(t, { isReadOnly: (ctx) => { seen.push(ctx.sessionManager.getSessionId()); return readOnly; } });
  appendSessionToolSelection(f.manager, ["write"]);
  assert.equal((await f.invoke({ action: "create", title: "blocked" }, "script")).structuredContent.code, "read-only");
  readOnly = false;
  appendSessionToolSelection(f.manager, ["read"]);
  assert.equal(f.output(await f.invoke({ action: "create", title: "allowed" }, "script")).card.title, "allowed");
  assert.deepEqual(seen, [f.session.sessionId, f.session.sessionId]);
});

test("real SDK rejects unknown/action-specific fields and malformed patches without writes", async (t) => {
  const f = await fixture(t);
  for (const via of ["kanban", "script"]) {
    for (const request of [{ action: "read", title: "forbidden" }, { action: "create", title: "x", extra: true }, { action: "create", title: "x", cardId: "forbidden" }, { action: "update" }, { action: "update", description: null }, { action: "update", title: " " }]) {
      const result = await f.invoke(request, via);
      assert.equal(result.isError, true, JSON.stringify({ request, result }));
      assert.equal(fs.existsSync(f.path), false);
    }
  }
});

test("a run hears the lanes once, then only the link changing, invisibly to the chat", async (t) => {
  const f = await fixture(t);
  const notices = () => f.session.agent.state.messages.filter((m) => m.role === "custom" && m.customType === "pi-web:kanban-card");
  const noticeEntries = () => f.manager.getEntries().filter((entry) => entry.type === "custom_message" && entry.customType === "pi-web:kanban-card");
  const run = async (label) => {
    f.faux.setResponses([fauxAssistantMessage([fauxText("ok")])]);
    await f.session.prompt(label);
  };

  await run("first run, no card");
  assert.equal(notices().length, 1, "the lane ids are handed over before any tool call");
  assert.equal(notices()[0].content, "Kanban lanes in board order: lane-backlog,lane-todo,lane-plan,lane-implement,lane-deploy,lane-done");
  assert.equal(notices()[0].display, false, "the chat never shows it");
  assert.equal(noticeEntries()[0].details.card, "none");

  await run("second run, still no card");
  assert.equal(notices().length, 1, "unchanged lanes and no card say nothing new");

  // The browser's Link picker, not this session's tool: the model has never seen this card.
  const linked = await applyMutation(f.project, {
    action: "create-card-for-session", sessionId: f.session.sessionId, sessionTitle: "Board", laneId: "lane-todo",
  });
  assert.equal(linked.ok, true, JSON.stringify(linked));
  const card = linked.board.cards.find((c) => c.sessionId === f.session.sessionId);
  await run("card linked from the board");
  assert.equal(notices().length, 2);
  assert.match(notices()[1].content, new RegExp(`^Kanban: this session is on card ${kanbanCardKey(linked.board, card)} in Todo \\(lane-todo\\)\\. `));
  assert.match(notices()[1].content, /move it with kanban update \(no cardId\) as soon as it stops matching/);
  assert.ok(notices()[1].content.length < 400, `notice was ${notices()[1].content.length} chars`);
  assert.equal(noticeEntries().at(-1).details.card, `${card.id}#lane-todo`);

  await run("same card");
  assert.equal(notices().length, 2, "the same link is never repeated");

  // The session's own tool result already told it; no echo next run.
  f.output(await f.invoke({ action: "update", laneId: "lane-done" }));
  await run("after my own update");
  assert.equal(notices().length, 2);

  // A move on another device IS news: another session — the owner, or one it
  // delegated to — can move the card between this session's runs, so the lane is
  // part of the card half. The lanes themselves did not change.
  assert.equal((await applyMutation(f.project, { action: "move-card", cardId: card.id, laneId: "lane-plan" })).ok, true);
  await run("card moved elsewhere");
  assert.equal(notices().length, 3);
  assert.match(notices()[2].content, new RegExp(`^Kanban: this session is on card ${kanbanCardKey(linked.board, card)} in Plan \\(lane-plan\\)`));
  assert.equal(notices()[2].content.includes("Kanban lanes in board order"), false, "the lanes did not change");
  assert.equal(noticeEntries().at(-1).details.card, `${card.id}#lane-plan`);
  assert.equal((await applyMutation(f.project, { action: "rename-lane", laneId: "lane-plan", name: "Planned" })).ok, true);
  await run("lane renamed on the board");
  assert.equal(notices().length, 3, "a lane's name is not its identity");

  // A lane appearing or going is board news: one line with the ids, no card line.
  const added = await applyMutation(f.project, { action: "add-lane", name: "Review", laneId: "lane-review" });
  assert.equal(added.ok, true, JSON.stringify(added));
  await run("lane added on the board");
  assert.equal(notices().length, 4);
  assert.equal(notices()[3].content, "Kanban lanes in board order: lane-backlog,lane-todo,lane-plan,lane-implement,lane-deploy,lane-done,lane-review");
  await run("same lanes");
  assert.equal(notices().length, 4);

  // Compaction summarizes the notices away: the model lost them, so the next run
  // repeats the state it can no longer see. The append-only file still holds the
  // old entries, which is why the notice reads the *context*, not the file.
  const lastUser = f.manager.getEntries().filter((entry) => entry.type === "message" && entry.message.role === "user").at(-1);
  f.manager.appendCompaction("Compacted: the board and its lanes", lastUser.id, 4321);
  await run("after compaction");
  assert.equal(notices().length, 5);
  assert.match(notices()[4].content, new RegExp(`^Kanban: this session is on card ${kanbanCardKey(linked.board, card)} in `));
  assert.match(notices()[4].content, /Kanban lanes in board order: lane-backlog/);
  await run("after the repeat");
  assert.equal(notices().length, 5, "one repeat, not one per turn");

  // Unlinking is one line too, and then silence.
  assert.equal((await applyMutation(f.project, { action: "unlink-session", cardId: card.id })).ok, true);
  await run("card unlinked");
  assert.equal(notices().length, 6);
  assert.equal(notices()[5].content, "Kanban: this session is no longer on a Kanban card.");
  await run("still unlinked");
  assert.equal(notices().length, 6);
});

test("lane instructions hand over the way ahead at the first run, then once per entry and edit, dismiss on leaving them behind, and repeat once per compaction", async (t) => {
  const f = await fixture(t);
  const notices = () => f.session.agent.state.messages.filter((m) => m.role === "custom" && m.customType === "pi-web:kanban-card");
  const noticeEntries = () => f.manager.getEntries().filter((entry) => entry.type === "custom_message" && entry.customType === "pi-web:kanban-card");
  // The card line rides along whenever the card's lane changed; these assertions
  // are about the instructions half, so they read what is left after it.
  const instructionHalf = (index) => notices()[index].content.split("\n")
    .filter((line) => !line.startsWith("Kanban: this session is on card"))
    .join("\n");
  const run = async (label) => {
    f.faux.setResponses([fauxAssistantMessage([fauxText("ok")])]);
    await f.session.prompt(label);
  };
  // The browser's drag, not the session's tool.
  const browserMove = async (laneId) => {
    const card = (await readBoard(f.project, { create: false })).board.cards.find((c) => c.sessionId === f.session.sessionId);
    assert.equal((await applyMutation(f.project, { action: "move-card", cardId: card.id, laneId })).ok, true);
  };

  // The config dialog's textarea writes the lane's model-facing text.
  const planRules = "Plan lane: write the plan as a short list before any code.";
  assert.equal((await applyMutation(f.project, { action: "edit-lane", laneId: "lane-plan", instructions: planRules })).ok, true);
  // The block: the card's step on the board, then its lane marked `[now]` and
  // every instructed lane after it, in board order.
  const runway = (step, current, entries) => [
    `Kanban lane instructions — step ${step} of 6, ${current}; these apply in board order as the card moves:`,
    ...entries.flatMap(([label, text]) => [`${label}:`, text]),
  ].join("\n");

  await run("first run, no card");
  assert.equal(notices().length, 1, "the lanes line once");
  assert.equal(notices()[0].content.includes("Plan lane:"), false, "no card sits in the lane: nothing to inject");

  const linked = await applyMutation(f.project, {
    action: "create-card-for-session", sessionId: f.session.sessionId, sessionTitle: "Board", laneId: "lane-todo",
  });
  assert.equal(linked.ok, true, JSON.stringify(linked));
  const card = linked.board.cards.find((c) => c.sessionId === f.session.sessionId);
  await run("linked into todo, an uninstructed lane");
  assert.equal(notices().length, 2);
  // The lane the card sits in has no text, but the ones it has yet to reach do:
  // the run learns the steps ahead before it produces the work for them.
  assert.equal(instructionHalf(1), runway(2, "Todo (lane-todo)", [["Plan (lane-plan)", planRules]]));

  await browserMove("lane-plan");
  await run("the board moved the card into plan");
  assert.equal(notices().length, 3, "one injection on entry");
  assert.match(notices()[2].content, /^Kanban: this session is on card .* in Plan \(lane-plan\)/, "the move is news as well");
  assert.equal(
    instructionHalf(2),
    runway(3, "Plan (lane-plan)", [["[now] Plan (lane-plan)", planRules]]),
    "the same lane's text, now marked as the card's own",
  );
  assert.equal(notices()[2].display, false, "the chat never shows it");
  assert.match(noticeEntries().at(-1).details.laneInstr, /^2>lane-plan#/);

  await run("still in plan");
  assert.equal(notices().length, 3, "never per turn");

  // The instructions edited under the card: one more injection, once. The lane did
  // not change, so no card line comes with it.
  assert.equal((await applyMutation(f.project, { action: "edit-lane", laneId: "lane-plan", instructions: "Plan lane v2: design first." })).ok, true);
  await run("instructions edited");
  assert.equal(notices().length, 4);
  assert.equal(instructionHalf(3), runway(3, "Plan (lane-plan)", [["[now] Plan (lane-plan)", "Plan lane v2: design first."]]));
  await run("edited, next turn");
  assert.equal(notices().length, 4);

  // Leaving every instructed lane behind dismisses once; coming back injects again.
  await browserMove("lane-done");
  await run("left the instructed lanes behind");
  assert.equal(notices().length, 5);
  assert.equal(instructionHalf(4), "Kanban: the lane instructions given earlier no longer apply.");
  await browserMove("lane-plan");
  await run("re-entered plan");
  assert.equal(notices().length, 6);
  assert.equal(instructionHalf(5), runway(3, "Plan (lane-plan)", [["[now] Plan (lane-plan)", "Plan lane v2: design first."]]));

  // The agent's own kanban update is the same trigger — and its tool result
  // already named the card, so only the dismiss line is due.
  f.output(await f.invoke({ action: "update", laneId: "lane-done" }));
  await run("my own update moved it out");
  assert.equal(notices().length, 7, "the dismiss line for my own move");
  assert.equal(notices()[6].content, "Kanban: the lane instructions given earlier no longer apply.");
  f.output(await f.invoke({ action: "update", laneId: "lane-plan" }));
  await run("my own update moved it back in");
  assert.equal(notices().length, 8);
  assert.equal(instructionHalf(7), runway(3, "Plan (lane-plan)", [["[now] Plan (lane-plan)", "Plan lane v2: design first."]]));

  // Compaction summarizes the state away: the next run repeats it once, not per turn.
  // (Anchor the compaction after a settled, notice-free run — the kept context
  // must not still hold the last injection.)
  await run("settled before compaction");
  assert.equal(notices().length, 8, "nothing new to say");
  const lastUser = f.manager.getEntries().filter((entry) => entry.type === "message" && entry.message.role === "user").at(-1);
  f.manager.appendCompaction("Compacted: the board, its lanes and instructions", lastUser.id, 999);
  await run("after compaction");
  assert.equal(notices().length, 9);
  assert.match(notices()[8].content, new RegExp(`^Kanban: this session is on card ${kanbanCardKey(linked.board, card)} in `));
  assert.match(notices()[8].content, /Kanban lanes in board order: lane-backlog/);
  assert.match(notices()[8].content, /Kanban lane instructions — step 3 of 6, Plan \(lane-plan\)/);
  assert.match(notices()[8].content, /\[now\] Plan \(lane-plan\):\nPlan lane v2/);
  await run("after the repeat");
  assert.equal(notices().length, 9, "one repeat per compaction");
});

test("the board's own template and reminder repeat the card line every N turns, naming the lane it is in", async (t) => {
  const f = await fixture(t);
  const notices = () => f.session.agent.state.messages.filter((m) => m.role === "custom" && m.customType === "pi-web:kanban-card");
  const run = async (label) => {
    f.faux.setResponses([fauxAssistantMessage([fauxText("ok")])]);
    await f.session.prompt(label);
  };
  const line = (key, lane, laneId) => `Card ${key} is in ${lane} (${laneId}). Move it the moment that stops being true.`;

  // The Configure dialog's set-notice: a card line of the user's own, repeated
  // every third turn.
  const configured = await applyMutation(f.project, {
    action: "set-notice",
    template: "Card {cardKey} is in {lane} ({laneId}). Move it the moment that stops being true.",
    reminderTurns: 3,
  });
  assert.equal(configured.ok, true, JSON.stringify(configured));

  await run("first run, no card");
  assert.equal(notices().length, 1, "the lanes line only: no card, no card line");

  const linked = await applyMutation(f.project, {
    action: "create-card-for-session", sessionId: f.session.sessionId, sessionTitle: "Board", laneId: "lane-todo",
  });
  assert.equal(linked.ok, true, JSON.stringify(linked));
  const card = linked.board.cards.find((c) => c.sessionId === f.session.sessionId);
  const key = kanbanCardKey(linked.board, card);

  await run("card linked");
  assert.equal(notices().length, 2);
  assert.equal(notices()[1].content, line(key, "Todo", "lane-todo"), "the board's template, not the built-in line");

  // The notice reset the count: two quiet turns, then the reminder.
  await run("one turn later");
  await run("two turns later");
  assert.equal(notices().length, 2, "not every turn");
  await run("three turns later");
  assert.equal(notices().length, 3, "the third turn repeats the card line");
  assert.equal(notices()[2].content, line(key, "Todo", "lane-todo"));
  assert.equal(notices()[2].display, false);

  // A drag in the browser is news now: the lane is part of the card half, so the
  // model hears where the card went without waiting for a reminder.
  assert.equal((await applyMutation(f.project, { action: "move-card", cardId: card.id, laneId: "lane-implement" })).ok, true);
  await run("after the browser move");
  assert.equal(notices().length, 4);
  assert.equal(notices()[3].content, line(key, "Implement", "lane-implement"));
  assert.equal(notices()[3].content.includes("Kanban lanes in board order"), false);
  // The change reset the count: two quiet turns, then the reminder.
  await run("still later");
  await run("one turn more");
  assert.equal(notices().length, 4, "the count started again at the move");
  await run("three turns after the move");
  assert.equal(notices().length, 5);
  assert.equal(notices()[4].content, line(key, "Implement", "lane-implement"));

  // A reminder is the card line alone: the lanes are already in the context.
  assert.equal(notices()[4].content.includes("Kanban lanes in board order"), false);

  // 0 turns switches the repeat off, and the template alone stays stored.
  const off = await applyMutation(f.project, { action: "set-notice", reminderTurns: 0 });
  assert.equal(off.ok, true, JSON.stringify(off));
  assert.deepEqual(off.board.notice, { template: configured.board.notice.template, reminderTurns: 0 });
  const before = notices().length;
  for (let index = 0; index < 5; index += 1) await run(`quiet ${index}`);
  assert.equal(notices().length, before, "off means off");

  // Editing the wording is a change the model hears: tuning the prompt must not
  // need a card move or a new session to reach a run.
  assert.equal((await applyMutation(f.project, { action: "set-notice", template: "Reworded for {cardKey}: {laneId}." })).ok, true);
  await run("after the template edit");
  assert.equal(notices().length, before + 1);
  assert.equal(notices().at(-1).content, `Reworded for ${key}: lane-implement.`);
  await run("the same wording again");
  assert.equal(notices().length, before + 1, "an edit announces once, not per turn");
});

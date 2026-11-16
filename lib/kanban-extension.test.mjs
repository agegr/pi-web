import assert from "node:assert/strict";
import fs from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";
const jiti = createJiti(import.meta.url);
const {
  createKanbanExtension, kanbanCardNotice, kanbanBoardLanesText, kanbanLaneInstructionSignature, kanbanLaneInstructionsText,
  kanbanTemplateSignature, kanbanCardNoticeLine, KANBAN_CARD_NOTICE_TYPE, KANBAN_LANE_INSTRUCTIONS_DROPPED, KANBAN_NO_LANE_INSTRUCTIONS,
} = await jiti.import("./kanban-extension.ts");
const {
  KANBAN_NOTICE_TEMPLATE_DEFAULT, KANBAN_DELEGATED_NOTICE_TEMPLATE, kanbanBoardNotice, kanbanNoticeValues, renderKanbanNoticeTemplate, setNotice,
} = await jiti.import("./kanban-shared.ts");
const { KANBAN_LANE_INSTRUCTIONS_MAX, KANBAN_LANE_INSTRUCTIONS_TOTAL_MAX, KANBAN_REMINDER_TURNS_MAX } = await jiti.import("./kanban-tool-limits.ts");
const { defaultLanes } = await jiti.import("./kanban-types.ts");
const lanes = defaultLanes();
const cardIn = (laneId) => ({ id: "c1", title: "Ship it", description: "", laneId, sessionId: "me", sessionTitle: "Me", createdAt: 1, updatedAt: 1 });

async function harness(options) {
  const tools = [];
  const handlers = new Map();
  const extension = createKanbanExtension(options);
  await extension.factory({ registerTool: (definition) => tools.push(definition), on: (event, handler) => handlers.set(event, handler) });
  assert.equal(tools.length, 1);
  return { definition: tools[0], beforeAgentStart: handlers.get("before_agent_start") };
}

async function tool(options) {
  return (await harness(options)).definition;
}
const context = (tools) => ({ cwd: "/must-not-touch", sessionManager: {
  getSessionId: () => "actor",
  getSessionName: () => "Actor",
  getEntries: () => tools === undefined ? [] : [{ type: "custom", customType: "pi-web:tool-selection", data: { version: 1, tools } }],
} });

test("registers one direct tool with flat schema and output schema, plus the card notice hook", async () => {
  const definition = await tool();
  assert.equal(definition.name, "kanban");
  assert.equal(definition.exposure, "direct");
  assert.deepEqual(Object.keys(definition.parameters.properties).sort(), ["action", "body", "cardId", "description", "laneId", "limit", "query", "title"]);
  assert.ok(definition.outputSchema);
  assert.match(definition.description, /not idempotent|not retry|not blindly retry/i);
  assert.equal(typeof (await harness()).beforeAgentStart, "function");
});

test("execute validates unknown/action-specific keys itself (not just SDK)", async () => {
  const definition = await tool();
  for (const request of [{ action: "read", title: "x" }, { action: "create", title: "x", cwd: "/wrong" }, { action: "update", advance: true }]) {
    const result = await definition.execute("id", request, undefined, undefined, context());
    assert.equal(result.isError, true);
    assert.equal(result.structuredContent.code, "invalid-request");
    assert.match(result.content[0].text, /invalid-request/);
  }
});

test("default read-only policy is re-read on each execute, before store access", async () => {
  const definition = await tool();
  let selection = ["read"];
  const ctx = context();
  ctx.sessionManager.getEntries = () => context(selection).sessionManager.getEntries();
  const invoke = () => definition.execute("id", { action: "create", title: "blocked" }, undefined, undefined, ctx);
  const blocked = await invoke();
  assert.equal(blocked.isError, true);
  assert.equal(blocked.structuredContent.code, "read-only");
  selection = ["read", "write"];
  assert.notEqual((await invoke()).structuredContent.code, "read-only");
  selection = ["read"];
  assert.equal((await invoke()).structuredContent.code, "read-only");
  const read = await definition.execute("id", { action: "read" }, undefined, undefined, ctx);
  assert.notEqual(read.structuredContent.code, "read-only");
  // Discovery reads cover search too: only create/update are gated.
  const search = await definition.execute("id", { action: "search", query: "x" }, undefined, undefined, ctx);
  assert.notEqual(search.structuredContent.code, "read-only");
});

test("child callback receives current context and overrides normal persisted policy", async () => {
  let locked = true;
  const seen = [];
  const definition = await tool({ isReadOnly: (ctx) => { seen.push(ctx); return locked; } });
  const ctx = context(["read", "write"]);
  const invoke = () => definition.execute("parent/nested", { action: "create", title: "x" }, undefined, undefined, ctx);
  assert.equal((await invoke()).structuredContent.code, "read-only");
  locked = false;
  assert.notEqual((await invoke()).structuredContent.code, "read-only");
  assert.deepEqual(seen, [ctx, ctx]);
});

test("the notice's state is the card and its lane, plus the lane ids: a rename is not a state transition", () => {
  const card = { id: "card-1", title: "Ship it", description: "long body", laneId: "lane-todo", sessionId: "me", sessionTitle: "Me", createdAt: 1, updatedAt: 1 };
  const notice = kanbanCardNotice(lanes, card);
  assert.equal(notice.state.card, "card-1#lane-todo");
  assert.equal(notice.state.lanes, JSON.stringify(lanes.map((lane) => lane.id)));
  // A rename is still not a state transition...
  const renamed = kanbanCardNotice(lanes, { ...card, title: "Renamed" });
  assert.deepEqual(renamed.state, notice.state);
  const renamedLane = kanbanCardNotice(lanes.map((lane) => lane.id === "lane-plan" ? { ...lane, name: "Planned" } : lane), card);
  assert.deepEqual(renamedLane.state, notice.state, "a lane id did not change");
  // ...but a move is: another session — the owner, or one it delegated to — can
  // move the card between this session's runs, and the model has to hear it.
  const moved = kanbanCardNotice(lanes, { ...card, laneId: "lane-done" });
  assert.equal(moved.state.card, "card-1#lane-done");
  assert.notDeepEqual(moved.state, notice.state);
  assert.equal(KANBAN_CARD_NOTICE_TYPE, "pi-web:kanban-card");
});

test("the delegated line names the caller's card, and every way it differs from the owner's", () => {
  const card = { id: "card-1", title: "Ship it", description: "", laneId: "lane-todo", sessionId: "parent", sessionTitle: "Parent", createdAt: 1, updatedAt: 1 };
  const line = kanbanCardNoticeLine(lanes, card, "PIW-42", KANBAN_DELEGATED_NOTICE_TEMPLATE);
  assert.match(line, /PIW-42/);
  assert.match(line, /Todo \(lane-todo\)/);
  assert.match(line, /delegated by the session that owns it/);
  // The child owns no card, so the owner's "no cardId" would name nothing.
  assert.match(line, /passing cardId/);
  assert.match(line, /forward only/);
  assert.doesNotMatch(KANBAN_NOTICE_TEMPLATE_DEFAULT, /passing cardId/);
  assert.doesNotMatch(line, /\{cardKey\}|\{lane/);
  // The two lines are different states: a session never confuses one for the other.
  assert.notEqual(kanbanTemplateSignature(KANBAN_DELEGATED_NOTICE_TEMPLATE), kanbanTemplateSignature(""));
});

test("a delegated notice sends its line, its lanes and the lane's instructions once each", () => {
  const card = { id: "card-1", title: "Ship it", description: "", laneId: "lane-todo", sessionId: "parent", sessionTitle: "Parent", createdAt: 1, updatedAt: 1 };
  const notice = kanbanCardNotice(lanes, card, { cardKey: "PIW-42", template: KANBAN_DELEGATED_NOTICE_TEMPLATE });
  assert.match(notice.content, /^Kanban: you are working on card PIW-42 in Todo/);
  assert.match(notice.content, /delegated by the session that owns it/);
  assert.equal(notice.state.card, "card-1#lane-todo");
});

test("the card line names the card, its lane and the tool, and leaves the body out", () => {
  const card = { id: "0f3b9a1c-0000-4000-8000-000000000007", title: "Ship it", description: "long body", laneId: "lane-todo", sessionId: "me", sessionTitle: "Me", createdAt: 1, updatedAt: 1 };
  const tracked = kanbanCardNotice(lanes, card, { lanesChanged: false });
  assert.equal(
    tracked.content,
    "Kanban: this session is on card 0f3b9a1c-0000-4000-8000-000000000007 in Todo (lane-todo). "
    + "Keep that lane matching what you are actually doing, and move it with kanban update (no cardId) as soon as it stops matching — "
    + "one lane at a time as the work advances, never straight to the last lane.",
  );
  for (const absent of ["Ship it", "long body"]) {
    assert.equal(tracked.content.includes(absent), false, `"${absent}" must not be in the notice`);
  }
  assert.equal(kanbanCardNotice(lanes, null, { lanesChanged: false }).content, "", "untracked and unchanged says nothing");
  assert.equal(
    kanbanCardNotice(lanes, card, { cardChanged: false }).content,
    `Kanban lanes in board order: ${kanbanBoardLanesText(lanes)}`,
    "a lane change alone never re-sends the card line",
  );
  assert.equal(kanbanCardNotice(lanes, null, { wasTracked: true, lanesChanged: false }).content, "Kanban: this session is no longer on a Kanban card.");
});

test("a board's own template replaces the card line, and its placeholders are the only values filled", () => {
  const card = { id: "card-1", title: "Ship it", description: "long body", laneId: "lane-todo", sessionId: "me", sessionTitle: "Me", createdAt: 1, updatedAt: 1 };
  const values = kanbanNoticeValues(lanes, card, "PIW-7");
  assert.deepEqual(values, { cardKey: "PIW-7", cardId: "card-1", title: "Ship it", lane: "Todo", laneId: "lane-todo" });
  assert.equal(
    renderKanbanNoticeTemplate("Card {cardKey} ({title}) rests in {lane}/{laneId}; ids are {cardId}.", values),
    "Card PIW-7 (Ship it) rests in Todo/lane-todo; ids are card-1.",
  );
  // An unknown token is left alone: a typo the dialog's preview shows, never a silently empty sentence.
  assert.equal(renderKanbanNoticeTemplate("{cardKey} {nope} {lane}", values), "PIW-7 {nope} Todo");
  // Blank is the built-in line, so clearing the field is a real reset.
  assert.equal(renderKanbanNoticeTemplate("   ", values), renderKanbanNoticeTemplate(KANBAN_NOTICE_TEMPLATE_DEFAULT, values));
  const custom = kanbanCardNotice(lanes, card, { cardKey: "PIW-7", lanesChanged: false, template: "PIW says: move {cardKey} out of {lane} when done." });
  assert.equal(custom.content, "PIW says: move PIW-7 out of Todo when done.");
  assert.equal(custom.state.card, "card-1#lane-todo", "the state is the card and its lane, not the wording");
  // The wording is its own half: an edited template is a change the model hears,
  // which is what the experimenting loop needs. A blank one is the built-in line.
  assert.equal(kanbanTemplateSignature(""), kanbanTemplateSignature("   "));
  assert.notEqual(custom.state.text, kanbanCardNotice(lanes, card, { cardKey: "PIW-7" }).state.text);
});

test("set-notice stores the template and the reminder, and refuses a turn count it cannot use", () => {
  const base = { projectDir: "/p", lanes, cards: [], cardPrefix: "PIW", nextCardNumber: 1 };
  const stored = setNotice(base, { template: "  move {cardKey}  ", reminderTurns: 5 });
  assert.deepEqual(stored.notice, { template: "move {cardKey}", reminderTurns: 5 });
  assert.equal(setNotice(stored, { reminderTurns: 5 }), stored, "the same value writes nothing");
  for (const refused of [-1, 1.5, KANBAN_REMINDER_TURNS_MAX + 1, Number.NaN]) {
    assert.equal(setNotice(stored, { reminderTurns: refused }), null, `${refused} is not a turn count`);
  }
  // Both empty drops the field: the board reads as one that never stored a notice.
  assert.equal("notice" in setNotice(stored, { template: "", reminderTurns: 0 }), false);
  assert.deepEqual(kanbanBoardNotice(base), { template: "", reminderTurns: 0 });
});

test("the lanes line is bare ids in board order and bounds itself", () => {
  assert.equal(
    kanbanBoardLanesText(lanes),
    "lane-backlog,lane-todo,lane-plan,lane-implement,lane-deploy,lane-done",
  );
  const notice = kanbanCardNotice(lanes, null);
  assert.equal(notice.content, `Kanban lanes in board order: ${kanbanBoardLanesText(lanes)}`);
  assert.ok(notice.content.length < 130, `notice was ${notice.content.length} chars`);
  const many = Array.from({ length: 30 }, (_, i) => ({ id: `lane-${i}`, name: `L${i}` }));
  const text = kanbanBoardLanesText(many);
  assert.match(text, /lane-23 \+6 more \(kanban read lists them\)/);
  assert.equal(text.includes("lane-24"), false);
});

test("the lane-instructions half is the runway's lanes, each with a hash of its text", () => {
  const instructed = lanes.map((lane) => lane.id === "lane-implement" ? { ...lane, instructions: "Run the suite before calling a lane done." } : lane);
  const card = cardIn("lane-implement");
  const signature = kanbanLaneInstructionSignature(instructed, card);
  assert.match(signature, /^3>lane-implement#[a-z0-9]+$/);
  // No card, no lane, no text: none. An instructed lane behind the card is not ahead of it.
  assert.equal(kanbanLaneInstructionSignature(instructed, null), KANBAN_NO_LANE_INSTRUCTIONS);
  assert.equal(kanbanLaneInstructionSignature(instructed, cardIn("lane-gone")), KANBAN_NO_LANE_INSTRUCTIONS);
  assert.equal(kanbanLaneInstructionSignature(instructed, cardIn("lane-deploy")), KANBAN_NO_LANE_INSTRUCTIONS);
  const blank = instructed.map((lane) => lane.id === "lane-implement" ? { ...lane, instructions: "  " } : lane);
  assert.equal(kanbanLaneInstructionSignature(blank, card), KANBAN_NO_LANE_INSTRUCTIONS);
  // Stable across renames, card edits and calls; an edit of the text is a change.
  assert.equal(kanbanLaneInstructionSignature(instructed, { ...card, title: "Renamed", laneId: "lane-implement" }), signature);
  const renamed = instructed.map((lane) => lane.id === "lane-implement" ? { ...lane, name: "Building" } : lane);
  assert.equal(kanbanLaneInstructionSignature(renamed, card), signature);
  const edited = instructed.map((lane) => lane.id === "lane-implement" ? { ...lane, instructions: "Run the suite twice." } : lane);
  assert.notEqual(kanbanLaneInstructionSignature(edited, card), signature);
  // The way ahead is part of it, in board order: a card in Todo already carries
  // the instructions of the lanes it has not reached.
  assert.match(kanbanLaneInstructionSignature(instructed, cardIn("lane-todo")), /^1>lane-implement#[a-z0-9]+$/);
  const planned = lanes.map((lane) => lane.id === "lane-plan" ? { ...lane, instructions: "Plan first." }
    : lane.id === "lane-implement" ? { ...lane, instructions: "Then build." } : lane);
  const plannedSignature = kanbanLaneInstructionSignature(planned, cardIn("lane-plan"));
  assert.match(plannedSignature, /^2>lane-plan#[a-z0-9]+>lane-implement#[a-z0-9]+$/);
  const editedAhead = planned.map((lane) => lane.id === "lane-implement" ? { ...lane, instructions: "Then build twice." } : lane);
  assert.notEqual(kanbanLaneInstructionSignature(editedAhead, cardIn("lane-plan")), plannedSignature, "an edited lane ahead is news now, not later");
});

test("lane instructions are their own block — the card's lane and the way ahead — never in the lanes line", () => {
  const instructed = lanes.map((lane) => lane.id === "lane-plan" ? { ...lane, instructions: "Write the plan before any code." }
    : lane.id === "lane-implement" ? { ...lane, instructions: "Run the suite before calling a lane done." } : lane);
  const card = cardIn("lane-plan");
  const notice = kanbanCardNotice(instructed, card, { cardChanged: false, lanesChanged: false });
  assert.equal(notice.content, [
    "Kanban lane instructions — step 3 of 6, Plan (lane-plan); these apply in board order as the card moves:",
    "[now] Plan (lane-plan):",
    "Write the plan before any code.",
    "Implement (lane-implement):",
    "Run the suite before calling a lane done.",
  ].join("\n"));
  assert.deepEqual(Object.keys(notice.state).sort(), ["card", "laneInstr", "lanes", "text"]);
  // The lanes line stays ids only, wherever the block sits.
  const full = kanbanCardNotice(instructed, card);
  const lanesLine = full.content.split("\n").find((line) => line.startsWith("Kanban lanes in board order:"));
  assert.equal(lanesLine, `Kanban lanes in board order: ${kanbanBoardLanesText(instructed)}`);
  assert.equal(lanesLine.includes("Write the plan"), false);
  // A lane the card has passed drops out of the block: no [now] on a lane behind it.
  const passed = kanbanLaneInstructionsText(instructed, cardIn("lane-implement"));
  assert.equal(passed, [
    "Kanban lane instructions — step 4 of 6, Implement (lane-implement); these apply in board order as the card moves:",
    "[now] Implement (lane-implement):",
    "Run the suite before calling a lane done.",
  ].join("\n"));
  // An uninstructed lane still hands over the way ahead: the run plans its steps before it gets there.
  assert.equal(kanbanLaneInstructionsText(instructed, cardIn("lane-todo")), [
    "Kanban lane instructions — step 2 of 6, Todo (lane-todo); these apply in board order as the card moves:",
    "Plan (lane-plan):",
    "Write the plan before any code.",
    "Implement (lane-implement):",
    "Run the suite before calling a lane done.",
  ].join("\n"));
  // A hand-edited file that is too long is bounded with a marker — and still hashed in full.
  const long = "x".repeat(KANBAN_LANE_INSTRUCTIONS_MAX + 500);
  const bloated = lanes.map((lane) => lane.id === "lane-plan" ? { ...lane, instructions: long } : lane);
  const text = kanbanLaneInstructionsText(bloated, card);
  assert.match(text, /\n…\[truncated\]$/);
  assert.ok(text.length < KANBAN_LANE_INSTRUCTIONS_MAX + 400, `text was ${text.length} chars`);
  const short = lanes.map((lane) => lane.id === "lane-plan" ? { ...lane, instructions: "x" } : lane);
  assert.notEqual(kanbanLaneInstructionSignature(bloated, card), kanbanLaneInstructionSignature(short, card));
  // The whole block is bounded too, and what it cannot fit is named rather than
  // dropped silently: the run still knows those lanes carry text.
  const wordy = lanes.map((lane) => ({ ...lane, instructions: "y".repeat(KANBAN_LANE_INSTRUCTIONS_MAX) }));
  const crowded = kanbanLaneInstructionsText(wordy, cardIn("lane-todo"));
  assert.ok(crowded.length < KANBAN_LANE_INSTRUCTIONS_TOTAL_MAX + 400, `block was ${crowded.length} chars`);
  assert.match(crowded, /\[now\] Todo \(lane-todo\)/);
  assert.match(crowded, /\[… .*lane-plan.* — beyond what fits here; their instructions arrive when the card reaches them\]/);
  assert.equal(crowded.includes("[now] Plan"), false, "only the lane it is in is marked now");
  // A renamed lane reads right: the current name first, the stable id in parentheses —
  // the id stays what the model updates with, the name what the human recognizes.
  const renamed = instructed.map((lane) => lane.id === "lane-plan" ? { ...lane, name: "Design" } : lane);
  assert.equal(kanbanLaneInstructionsText(renamed, card).split("\n").at(1), "[now] Design (lane-plan):");
});

test("each half speaks for itself: entry injects, silence keeps quiet, leaving dismisses", () => {
  const instructed = lanes.map((lane) => lane.id === "lane-plan" ? { ...lane, instructions: "Design first." } : lane);
  const card = cardIn("lane-plan");
  // Entry: only the instructions block — the card and lanes halves stay out.
  const entry = kanbanCardNotice(instructed, card, { cardChanged: false, lanesChanged: false, laneInstrChanged: true });
  assert.equal(entry.content, [
    "Kanban lane instructions — step 3 of 6, Plan (lane-plan); these apply in board order as the card moves:",
    "[now] Plan (lane-plan):",
    "Design first.",
  ].join("\n"));
  // Unchanged: nothing to say.
  assert.equal(kanbanCardNotice(instructed, card, { cardChanged: false, lanesChanged: false, laneInstrChanged: false }).content, "");
  // Leaving the instructed lane, or clearing its instructions under the card: one dismiss line.
  const left = kanbanCardNotice(instructed, cardIn("lane-done"), { cardChanged: false, lanesChanged: false, laneInstrChanged: true, laneInstrDropped: true });
  assert.equal(left.content, KANBAN_LANE_INSTRUCTIONS_DROPPED);
  const cleared = kanbanCardNotice(lanes, card, { cardChanged: false, lanesChanged: false, laneInstrChanged: true, laneInstrDropped: true });
  assert.equal(cleared.content, KANBAN_LANE_INSTRUCTIONS_DROPPED);
  // Without the drop flag the half is silent (an unlink's card line is its own dismissal).
  assert.equal(kanbanCardNotice(instructed, cardIn("lane-done"), { cardChanged: false, lanesChanged: false, laneInstrChanged: true }).content, "");
  // First run without a card: no instruction lines at all.
  assert.equal(kanbanCardNotice(instructed, null).content, `Kanban lanes in board order: ${kanbanBoardLanesText(instructed)}`);
});

test("an unreadable board never blocks a run and says nothing", async (t) => {
  const previous = process.env.PI_CODING_AGENT_DIR;
  const agentDir = fs.mkdtempSync(join(tmpdir(), "kanban-notice-"));
  process.env.PI_CODING_AGENT_DIR = agentDir;
  t.after(() => {
    if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previous;
    fs.rmSync(agentDir, { recursive: true, force: true });
  });
  const { beforeAgentStart } = await harness();
  // A folder outside the allowed roots: the store refuses, the run continues.
  assert.equal(await beforeAgentStart({}, context()), undefined);
});

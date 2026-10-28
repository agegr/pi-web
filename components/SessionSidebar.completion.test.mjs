import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { Script, createContext } from "node:vm";
import { createJiti } from "jiti";
import ts from "typescript";

const jiti = createJiti(import.meta.url);
const { BackgroundCompletionTracker, backgroundCompletionSessions } = await jiti.import("../lib/session-completion-client.ts");
const source = ts.createSourceFile("SessionSidebar.tsx", await readFile(new URL("./SessionSidebar.tsx", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const nodes = [];
function visit(node) { nodes.push(node); ts.forEachChild(node, visit); }
visit(source);
function script(expression) {
  return new Script(ts.transpileModule(`(${expression})`, { compilerOptions: { target: ts.ScriptTarget.ESNext } }).outputText);
}
const poll = nodes.find((n) => ts.isVariableDeclaration(n) && n.name.getText(source) === "poll");
const runningEffect = nodes.find((n) => ts.isCallExpression(n) && n.expression.getText(source) === "useEffect" && n.arguments[0]?.getText(source).includes("const previous = previousRunningSessionIdsRef.current"));
assert.ok(poll && runningEffect);

function setup() {
  let response = {};
  let unread = new Set();
  let sounds = 0;
  let catalogueReads = 0;
  let freshCatalogue;
  let catalogueFailed = false;
  const sessions = [{ id: "main" }, { id: "selected" }, { id: "child", relation: { kind: "subagent" } }];
  const context = createContext({
    stopped: false, controller: null, AbortController,
    document: { visibilityState: "visible" },
    fetch: async () => Response.json(response),
    runningPollAuthoritativeRef: { current: false },
    completionTrackerRef: { current: new BackgroundCompletionTracker() },
    completionContextRef: { current: { allSessions: sessions, selectedSessionId: "selected", onBackgroundTaskDone: () => sounds++ } },
    backgroundCompletionSessions,
    setUnreadSessionIds: (update) => { unread = update(unread); },
    setRunningSessionIds: (update) => { context.runningSessionIds = update(context.runningSessionIds); },
    setAwaitingInputSessionIds() {},
    sameIdsOr: (_previous, ids) => new Set(ids),
    noteUiRevision() {}, schedule() {},
    async loadSessions() {
      catalogueReads++;
      if (catalogueFailed) return undefined;
      context.sessionListVersionRef.current = response.sessionListVersion;
      return freshCatalogue ?? context.completionContextRef.current.allSessions;
    },
    sessionListVersionRef: { current: 1 },
    previousRunningSessionIdsRef: { current: new Set() }, runningSessionIds: new Set(),
    allSessions: sessions, selectedSessionId: "selected",
  });
  const runPoll = script(poll.initializer.getText(source)).runInContext(context);
  const updateRunning = script(runningEffect.arguments[0].getText(source)).runInContext(context);
  return {
    context,
    get unread() { return [...unread]; },
    get sounds() { return sounds; },
    get catalogueReads() { return catalogueReads; },
    setCatalogue(sessions) { freshCatalogue = sessions; },
    failCatalogue(failed) { catalogueFailed = failed; },
    async poll(completionIds, runningSessionIds = [], extra = {}) {
      response = { sessionListVersion: 1, completionIds, runningSessionIds, ...extra };
      await runPoll();
      updateRunning();
    },
  };
}

test("sidebar poll uses only authoritative ID changes, never running-to-idle or suppressed lists", async () => {
  const state = setup();
  await state.poll({ main: "100" }, ["main"]);
  assert.equal(state.sounds, 0, "first poll does not replay history");
  await state.poll({ main: "100" }, [], { completionNotificationSuppressedSessionIds: [] });
  assert.equal(state.sounds, 0, "main may be idle with children still working, or stopped");
  assert.deepEqual(state.unread, []);
  await state.poll({ main: "101" }, [], { completionNotificationSuppressedSessionIds: ["main"] });
  assert.equal(state.sounds, 1, "authoritative completion wins; old suppression lists have no effect");
  assert.deepEqual(state.unread, ["main"]);
  await state.poll({ main: "101" });
  await state.poll({ main: "99" });
  await state.poll({});
  await state.poll({ main: "101" });
  assert.equal(state.sounds, 1);
  await state.poll({ main: "101" }, ["main"]);
  assert.deepEqual(state.unread, [], "a new run still clears unread as before");
  await state.poll({ main: "101" });
  assert.equal(state.sounds, 1, "stopping without a new ID stays silent");
});

test("a newer running turn clears unread even if the previous completion is first observed in the same poll", async () => {
  const state = setup();
  await state.poll({ main: "100" }, ["main"]);
  await state.poll({ main: "101" }, ["main"]);
  assert.equal(state.sounds, 1, "completion ID still alerts");
  assert.deepEqual(state.unread, [], "unchanged running Set still clears unread");
  await state.poll({ main: "101" });
  assert.equal(state.sounds, 1);
  assert.deepEqual(state.unread, [], "a stopped newer turn does not inherit the prior unread");
});

test("poll consumes selected, deleted and child completions silently, using the current selection", async () => {
  const state = setup();
  await state.poll({});
  await state.poll({ selected: "100", child: "101", deleted: "102" });
  assert.deepEqual(state.unread, []);
  assert.equal(state.sounds, 0);
  state.context.completionContextRef.current.selectedSessionId = null;
  await state.poll({ selected: "100", child: "101", deleted: "102" });
  assert.equal(state.sounds, 0, "changing selection cannot replay consumed completions");
  await state.poll({ selected: "103" });
  assert.deepEqual(state.unread, ["selected"]);
  assert.equal(state.sounds, 1);
  state.context.completionContextRef.current.allSessions = [];
  await state.poll({ selected: "104" });
  assert.equal(state.sounds, 1, "a removed session cannot acquire new unread from the poll");
});

test("a fast new session is confirmed against the fresh catalogue, not a stale render", async () => {
  const state = setup();
  await state.poll({});
  state.context.completionContextRef.current.allSessions = [];
  state.setCatalogue([{ id: "fast" }]);
  await state.poll({ fast: "100" }, [], { sessionListVersion: 2 });
  assert.equal(state.sounds, 1);
  assert.deepEqual(state.unread, ["fast"]);
  assert.equal(state.catalogueReads, 1);
  await state.poll({ fast: "100" }, [], { sessionListVersion: 2 });
  assert.equal(state.sounds, 1);
  assert.equal(state.catalogueReads, 1, "consumed IDs do not trigger repeated catalogue reads");
});

test("a failed catalogue read preserves an unknown completion until the next existing poll", async () => {
  const state = setup();
  await state.poll({});
  state.failCatalogue(true);
  await state.poll({ fast: "100" });
  assert.equal(state.sounds, 0);
  state.failCatalogue(false);
  state.setCatalogue([{ id: "fast" }]);
  // The wrapper can disappear meanwhile; unresolved completion must still survive.
  await state.poll({});
  assert.equal(state.sounds, 1);
  assert.deepEqual(state.unread, ["fast"]);
  await state.poll({ fast: "100" });
  assert.equal(state.sounds, 1);
});

test("first-poll history stays silent even if its catalogue is initially absent", async () => {
  const state = setup();
  state.context.completionContextRef.current.allSessions = [];
  state.setCatalogue([{ id: "history" }]);
  await state.poll({ history: "100" }, [], { sessionListVersion: 2 });
  await state.poll({ history: "100" }, [], { sessionListVersion: 2 });
  assert.equal(state.sounds, 0);
  assert.deepEqual(state.unread, []);
});

test("a fresh catalogue confirming deletion consumes the ID without ghost unread or repeated reloads", async () => {
  const state = setup();
  await state.poll({});
  state.setCatalogue([]);
  await state.poll({ deleted: "100" });
  assert.equal(state.catalogueReads, 1);
  await state.poll({ deleted: "100" });
  assert.equal(state.catalogueReads, 1);
  assert.equal(state.sounds, 0);
  assert.deepEqual(state.unread, []);
});

test("selection changed during catalogue loading cannot produce a background duplicate", async () => {
  const state = setup();
  await state.poll({});
  state.context.loadSessions = async () => {
    state.context.completionContextRef.current.selectedSessionId = "fast";
    return [{ id: "fast" }];
  };
  await state.poll({ fast: "100" });
  assert.equal(state.sounds, 0);
  state.context.completionContextRef.current.selectedSessionId = null;
  await state.poll({ fast: "100" });
  assert.equal(state.sounds, 0);
});

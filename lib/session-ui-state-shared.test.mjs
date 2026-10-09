import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const {
  MAX_PROJECT_NAMES,
  MAX_PROJECT_NAME_LENGTH,
  MAX_PROJECT_ORDER_KEYS,
  MAX_SESSION_UI_IDS_PER_REQUEST,
  PROJECT_NAMES_MAX_BYTES,
  PROJECT_ORDER_MAX_BYTES,
  SESSION_ID_PATTERN,
  applySessionUiStateRequest,
  chunkForSessionUiRequests,
  emptySessionUiState,
  normalizeSessionUiState,
  parseSessionUiStateRequest,
  projectDisplayName,
  snapshotSessionUiFlags,
  storedProjectName,
} = await jiti.import("./session-ui-state-shared.ts");

const source = await readFile(new URL("./session-ui-state-shared.ts", import.meta.url), "utf8");
const readerSource = await readFile(new URL("./session-reader.ts", import.meta.url), "utf8");

const state = (sessions = {}, projects = {}, revision = 3) => ({ version: 1, revision, sessions, projects });
const parse = (body) => parseSessionUiStateRequest(body);
const request = (body) => {
  const result = parse(body);
  assert.equal(result.ok, true, result.error);
  return result.request;
};

test("is client-safe and uses the session id rule of the session reader", () => {
  assert.doesNotMatch(source, /from "node:|from "(fs|path|os|crypto)"|require\(/);
  assert.doesNotMatch(source, /\(\?<[=!]/, "no RegExp lookbehind (Safari 16.2)");
  const readerPattern = readerSource.match(/const SESSION_ID_PATTERN = (\/.*\/);/)?.[1];
  assert.equal(String(SESSION_ID_PATTERN), readerPattern);
});

test("empty state is fresh every call", () => {
  const a = emptySessionUiState();
  a.sessions.x = { pinnedAt: 1 };
  assert.deepEqual(emptySessionUiState(), { version: 1, revision: 0, sessions: {}, projects: {} });
});

test("normalize keeps valid entries and drops malformed ones", () => {
  const normalized = normalizeSessionUiState({
    version: 1,
    revision: 7,
    extra: { kept: "by the server, not here" },
    sessions: {
      "a-1": { pinnedAt: 10, color: "red" },
      b: { archivedAt: 20 },
      c: { pinnedAt: "soon" },
      d: { pinnedAt: -1, archivedAt: Number.POSITIVE_INFINITY },
      e: null,
      "-bad": { pinnedAt: 1 },
      "bad/slash": { pinnedAt: 1 },
      f: { pinnedAt: 5, archivedAt: 6 },
    },
    projects: {
      "/repo": { pinnedAt: 1, root: "/repo" },
      "/no-root": { pinnedAt: 1 },
      "/bad-time": { pinnedAt: "x", root: "/bad-time" },
      "": { pinnedAt: 1, root: "/empty-key" },
      "/long-root": { pinnedAt: 1, root: "x".repeat(4097) },
    },
  });
  assert.deepEqual(normalized, {
    version: 1,
    revision: 7,
    sessions: { "a-1": { pinnedAt: 10 }, b: { archivedAt: 20 }, f: { pinnedAt: 5, archivedAt: 6 } },
    projects: { "/repo": { pinnedAt: 1, root: "/repo" } },
  });
});

test("normalize fills missing parts and rejects an unusable root shape", () => {
  assert.deepEqual(normalizeSessionUiState({}), emptySessionUiState());
  assert.deepEqual(normalizeSessionUiState({ revision: -1 }), emptySessionUiState());
  assert.deepEqual(normalizeSessionUiState({ revision: 1.5 }), emptySessionUiState());
  for (const value of [null, undefined, 1, "x", [], { version: 2 }, { version: "1" }, { sessions: [] }, { projects: "x" }, { sessions: null }]) {
    assert.equal(normalizeSessionUiState(value), null, JSON.stringify(value));
  }
});

test("normalize never sets a prototype from a __proto__ key", () => {
  const normalized = normalizeSessionUiState(JSON.parse('{"projects":{"__proto__":{"pinnedAt":1,"root":"/x"}},"sessions":{"__proto__":{"pinnedAt":1}}}'));
  assert.equal(Object.getPrototypeOf(normalized.projects), Object.prototype);
  assert.deepEqual(Object.keys(normalized.projects), []);
  assert.deepEqual(Object.keys(normalized.sessions), []);
});

test("parse accepts the three actions and dedupes ids", () => {
  assert.deepEqual(request({ action: "set", ids: ["a", "b", "a"], pinned: true, extra: 1 }), { action: "set", ids: ["a", "b"], pinned: true });
  assert.deepEqual(request({ action: "set", ids: ["a"], archived: false }), { action: "set", ids: ["a"], archived: false });
  assert.deepEqual(
    request({ action: "restore", entries: [{ id: "a", pinnedAt: null, archivedAt: 5, extra: true }, { id: "b", pinnedAt: 1, archivedAt: null }] }),
    { action: "restore", entries: [{ id: "a", pinnedAt: null, archivedAt: 5 }, { id: "b", pinnedAt: 1, archivedAt: null }] },
  );
  assert.deepEqual(request({ action: "restore", entries: [] }), { action: "restore", entries: [] });
  assert.deepEqual(
    request({ action: "pin-project", projectKey: "/repo", root: "/repo", pinned: true }),
    { action: "pin-project", projectKey: "/repo", root: "/repo", pinned: true },
  );
});

test("parse refuses malformed bodies", () => {
  const ids = (count) => Array.from({ length: count }, (_, index) => `id-${index}`);
  assert.equal(parse({ action: "set", ids: ids(MAX_SESSION_UI_IDS_PER_REQUEST), pinned: true }).ok, true);
  const refused = [
    null,
    [],
    "set",
    {},
    { action: "nope" },
    { action: "set", ids: ["a"] },
    { action: "set", ids: ["a"], pinned: true, archived: true },
    { action: "set", ids: ["a"], pinned: "yes" },
    { action: "set", ids: [], pinned: true },
    { action: "set", ids: "a", pinned: true },
    { action: "set", ids: ["../a"], pinned: true },
    { action: "set", ids: [""], pinned: true },
    { action: "set", ids: [1], pinned: true },
    { action: "set", ids: ids(MAX_SESSION_UI_IDS_PER_REQUEST + 1), pinned: true },
    { action: "restore" },
    { action: "restore", entries: [{ id: "a", pinnedAt: null }] },
    { action: "restore", entries: [{ id: "a", pinnedAt: "1", archivedAt: null }] },
    { action: "restore", entries: [{ id: "a", pinnedAt: -1, archivedAt: null }] },
    { action: "restore", entries: [{ id: "a", pinnedAt: null, archivedAt: null }, { id: "a", pinnedAt: 1, archivedAt: null }] },
    { action: "restore", entries: [{ id: "bad id", pinnedAt: null, archivedAt: null }] },
    { action: "pin-project", projectKey: "", root: "/r", pinned: true },
    { action: "pin-project", projectKey: "/r", root: "", pinned: true },
    { action: "pin-project", projectKey: "/r", root: "/r" },
    { action: "pin-project", projectKey: "__proto__", root: "/r", pinned: true },
    { action: "pin-project", projectKey: "x".repeat(4097), root: "/r", pinned: true },
  ];
  for (const body of refused) {
    const result = parse(body);
    assert.equal(result.ok, false, JSON.stringify(body)?.slice(0, 120));
    assert.equal(typeof result.error, "string");
  }
});

test("pin and archive exclude each other", () => {
  const start = state({ a: { archivedAt: 100 }, b: { pinnedAt: 50 } });
  const pinned = applySessionUiStateRequest(start, request({ action: "set", ids: ["a", "b"], pinned: true }), 200);
  assert.equal(pinned.changed, true);
  assert.deepEqual(pinned.state.sessions, { a: { pinnedAt: 200 }, b: { pinnedAt: 50 } }, "already pinned keeps its time");
  assert.equal(pinned.state.revision, 3, "revision is the server's to bump");

  const archived = applySessionUiStateRequest(pinned.state, request({ action: "set", ids: ["a"], archived: true }), 300);
  assert.deepEqual(archived.state.sessions, { a: { archivedAt: 300 }, b: { pinnedAt: 50 } });

  const again = applySessionUiStateRequest(archived.state, request({ action: "set", ids: ["a"], archived: true }), 400);
  assert.equal(again.changed, true, "re-archiving refreshes the time");
  assert.deepEqual(again.state.sessions.a, { archivedAt: 400 });

  const repinBoth = applySessionUiStateRequest(state({ a: { pinnedAt: 1, archivedAt: 2 } }), request({ action: "set", ids: ["a"], pinned: true }), 9);
  assert.equal(repinBoth.changed, true);
  assert.deepEqual(repinBoth.state.sessions.a, { pinnedAt: 9 });
});

test("clearing a flag removes it and drops empty entries", () => {
  const start = state({ a: { pinnedAt: 1 }, b: { archivedAt: 2 } });
  const unpinned = applySessionUiStateRequest(start, request({ action: "set", ids: ["a", "missing"], pinned: false }), 10);
  assert.equal(unpinned.changed, true);
  assert.deepEqual(unpinned.state.sessions, { b: { archivedAt: 2 } });
  const unarchived = applySessionUiStateRequest(unpinned.state, request({ action: "set", ids: ["b"], archived: false }), 10);
  assert.deepEqual(unarchived.state.sessions, {});
  const noop = applySessionUiStateRequest(unarchived.state, request({ action: "set", ids: ["b"], archived: false }), 10);
  assert.equal(noop.changed, false);
  const notArchived = applySessionUiStateRequest(state({ a: { pinnedAt: 1 } }), request({ action: "set", ids: ["a"], archived: false }), 10);
  assert.equal(notArchived.changed, false);
  assert.deepEqual(notArchived.state.sessions, { a: { pinnedAt: 1 } });
});

test("never mutates its input", () => {
  const start = state({ a: { pinnedAt: 1 } }, { "/r": { pinnedAt: 1, root: "/r" } });
  const frozen = JSON.stringify(start);
  const result = applySessionUiStateRequest(start, request({ action: "set", ids: ["a"], archived: true }), 5);
  applySessionUiStateRequest(start, request({ action: "pin-project", projectKey: "/r", root: "/r", pinned: false }), 5);
  applySessionUiStateRequest(start, request({ action: "restore", entries: [{ id: "a", pinnedAt: null, archivedAt: null }] }), 5);
  assert.equal(JSON.stringify(start), frozen);
  assert.notEqual(result.state.sessions, start.sessions);
  const unchanged = applySessionUiStateRequest(start, request({ action: "set", ids: ["a"], pinned: true }), 5);
  assert.equal(unchanged.changed, false);
  assert.notEqual(unchanged.state, start, "a new object even when nothing changed");
});

test("restore writes back the exact prior values and undoes an archive", () => {
  const start = state({ a: { pinnedAt: 1 }, c: { archivedAt: 3 } });
  const snapshot = snapshotSessionUiFlags(start, ["a", "b", "c", "a"]);
  assert.deepEqual(snapshot, [
    { id: "a", pinnedAt: 1, archivedAt: null },
    { id: "b", pinnedAt: null, archivedAt: null },
    { id: "c", pinnedAt: null, archivedAt: 3 },
  ]);
  const archived = applySessionUiStateRequest(start, request({ action: "set", ids: ["a", "b", "c"], archived: true }), 50);
  assert.deepEqual(archived.state.sessions, { a: { archivedAt: 50 }, b: { archivedAt: 50 }, c: { archivedAt: 50 } });
  const restored = applySessionUiStateRequest(archived.state, request({ action: "restore", entries: snapshot }), 60);
  assert.equal(restored.changed, true);
  assert.deepEqual(restored.state.sessions, start.sessions);
  const again = applySessionUiStateRequest(restored.state, request({ action: "restore", entries: snapshot }), 70);
  assert.equal(again.changed, false);
  assert.deepEqual(snapshotSessionUiFlags(start, ["constructor"]), [{ id: "constructor", pinnedAt: null, archivedAt: null }]);
});

test("pin-project pins with its root and unpins", () => {
  const pinned = applySessionUiStateRequest(state(), request({ action: "pin-project", projectKey: "/r", root: "/r", pinned: true }), 10);
  assert.equal(pinned.changed, true);
  assert.deepEqual(pinned.state.projects, { "/r": { pinnedAt: 10, root: "/r" } });
  const same = applySessionUiStateRequest(pinned.state, request({ action: "pin-project", projectKey: "/r", root: "/r", pinned: true }), 20);
  assert.equal(same.changed, false);
  assert.deepEqual(same.state.projects["/r"], { pinnedAt: 10, root: "/r" });
  const moved = applySessionUiStateRequest(pinned.state, request({ action: "pin-project", projectKey: "/r", root: "/R", pinned: true }), 30);
  assert.equal(moved.changed, true);
  assert.deepEqual(moved.state.projects["/r"], { pinnedAt: 30, root: "/R" });
  const unpinned = applySessionUiStateRequest(moved.state, request({ action: "pin-project", projectKey: "/r", root: "/R", pinned: false }), 40);
  assert.equal(unpinned.changed, true);
  assert.deepEqual(unpinned.state.projects, {});
  const noop = applySessionUiStateRequest(unpinned.state, request({ action: "pin-project", projectKey: "/r", root: "/R", pinned: false }), 50);
  assert.equal(noop.changed, false);
  const toString = applySessionUiStateRequest(state(), request({ action: "pin-project", projectKey: "toString", root: "/t", pinned: false }), 1);
  assert.equal(toString.changed, false, "inherited names are not entries");
});

test("a change to more families than one request carries is split into accepted requests, in order", () => {
  const ids = Array.from({ length: 2 * MAX_SESSION_UI_IDS_PER_REQUEST + 1 }, (_, index) => `s${index}`);
  // One request with every id is refused, so it must never be sent.
  assert.equal(parse({ action: "set", ids, archived: true }).ok, false);

  const chunks = chunkForSessionUiRequests(ids);
  assert.deepEqual(chunks.map((chunk) => chunk.length), [MAX_SESSION_UI_IDS_PER_REQUEST, MAX_SESSION_UI_IDS_PER_REQUEST, 1]);
  assert.deepEqual(chunks.flat(), ids, "every id once, in order");
  let archived = state({}, {}, 0);
  for (const chunk of chunks) {
    archived = applySessionUiStateRequest(archived, request({ action: "set", ids: chunk, archived: true }), 7).state;
  }
  assert.equal(Object.keys(archived.sessions).length, ids.length);

  // Its Undo restores in parts the same way.
  const snapshot = snapshotSessionUiFlags(state(), ids);
  let restored = archived;
  for (const entries of chunkForSessionUiRequests(snapshot)) {
    restored = applySessionUiStateRequest(restored, request({ action: "restore", entries }), 8).state;
  }
  assert.deepEqual(restored.sessions, {});

  assert.deepEqual(chunkForSessionUiRequests([]), []);
  assert.deepEqual(chunkForSessionUiRequests(["a", "b", "c"], 2), [["a", "b"], ["c"]]);
  assert.deepEqual(chunkForSessionUiRequests(["a", "b"], 0), [["a"], ["b"]], "a size below one still makes progress");
});

const ordered = (projectOrder, projects = {}) => ({ ...state({}, projects), projectOrder });
const orderBytes = (order) => Buffer.byteLength(JSON.stringify(order), "utf8");

test("normalize keeps a clean project order and reads anything else as none", () => {
  const normalized = normalizeSessionUiState({
    sessions: { a: { pinnedAt: 1 } },
    projectOrder: ["/b", "/a", "/b", "", "__proto__", 7, null, "x".repeat(4097), "/c"],
  });
  assert.deepEqual(normalized.projectOrder, ["/b", "/a", "/c"]);
  for (const value of ["/a", { 0: "/a" }, null, 1]) {
    const read = normalizeSessionUiState({ sessions: { a: { pinnedAt: 1 } }, projectOrder: value });
    assert.notEqual(read, null, "a bad order is no reason to set pins and archive aside");
    assert.deepEqual(read.sessions, { a: { pinnedAt: 1 } });
    assert.equal("projectOrder" in read, false);
  }
  assert.equal("projectOrder" in normalizeSessionUiState({ projectOrder: [] }), false, "absent while empty");
  assert.equal("projectOrder" in normalizeSessionUiState({ projectOrder: [1, ""] }), false);
  assert.deepEqual(normalizeSessionUiState({}), emptySessionUiState());
});

test("normalize holds the order to its key count and its UTF-8 byte budget", () => {
  const many = Array.from({ length: MAX_PROJECT_ORDER_KEYS + 5 }, (_, index) => `/p${index}`);
  assert.deepEqual(normalizeSessionUiState({ projectOrder: many }).projectOrder, many.slice(0, MAX_PROJECT_ORDER_KEYS));
  // 4096 characters of 3 UTF-8 bytes each, and Windows paths whose backslashes double in JSON.
  for (const unit of ["项", "\\"]) {
    const long = Array.from({ length: 80 }, (_, index) => `${index}`.padEnd(4096, unit));
    const kept = normalizeSessionUiState({ projectOrder: long }).projectOrder;
    assert.ok(kept.length > 0 && kept.length < long.length);
    assert.deepEqual(kept, long.slice(0, kept.length), "the first ones that fit");
    assert.ok(orderBytes(kept) <= PROJECT_ORDER_MAX_BYTES);
    assert.ok(orderBytes(long.slice(0, kept.length + 1)) > PROJECT_ORDER_MAX_BYTES);
  }
});

test("parse accepts add-projects and move-project and dedupes their keys", () => {
  assert.deepEqual(request({ action: "add-projects", keys: ["/a", "/b", "/a"], extra: 1 }), { action: "add-projects", keys: ["/a", "/b"] });
  assert.deepEqual(
    request({ action: "move-project", projectKey: "/a", anchorKey: "/b", position: "after", add: ["/c", "/c", "/a"] }),
    { action: "move-project", projectKey: "/a", anchorKey: "/b", position: "after", add: ["/c", "/a"] },
  );
  assert.deepEqual(
    request({ action: "move-project", projectKey: "/a", anchorKey: "/b", position: "before" }),
    { action: "move-project", projectKey: "/a", anchorKey: "/b", position: "before", add: [] },
    "add defaults to none",
  );
  const keys = (count) => Array.from({ length: count }, (_, index) => `/k${index}`);
  assert.equal(parse({ action: "add-projects", keys: keys(MAX_SESSION_UI_IDS_PER_REQUEST) }).ok, true);
  const refused = [
    { action: "add-projects" },
    { action: "add-projects", keys: [] },
    { action: "add-projects", keys: "/a" },
    { action: "add-projects", keys: [1] },
    { action: "add-projects", keys: [""] },
    { action: "add-projects", keys: ["__proto__"] },
    { action: "add-projects", keys: ["x".repeat(4097)] },
    { action: "add-projects", keys: keys(MAX_SESSION_UI_IDS_PER_REQUEST + 1) },
    { action: "move-project", projectKey: "/a", anchorKey: "/a", position: "before" },
    { action: "move-project", projectKey: "/a", anchorKey: "/b" },
    { action: "move-project", projectKey: "/a", anchorKey: "/b", position: "above" },
    { action: "move-project", projectKey: "", anchorKey: "/b", position: "before" },
    { action: "move-project", projectKey: "/a", anchorKey: "__proto__", position: "before" },
    { action: "move-project", projectKey: "/a", anchorKey: "/b", position: "before", add: "/c" },
    { action: "move-project", projectKey: "/a", anchorKey: "/b", position: "before", add: [null] },
    { action: "move-project", projectKey: "/a", anchorKey: "/b", position: "before", add: keys(MAX_SESSION_UI_IDS_PER_REQUEST + 1) },
  ];
  for (const body of refused) {
    const result = parse(body);
    assert.equal(result.ok, false, JSON.stringify(body).slice(0, 120));
    assert.equal(typeof result.error, "string");
  }
  assert.match(parse({ action: "nope" }).error, /"set", "restore", "pin-project", "add-projects", "move-project" or "rename-project"/);
});

test("add-projects puts new keys on top in their order and never pushes one out", () => {
  const seeded = applySessionUiStateRequest(state(), request({ action: "add-projects", keys: ["/c", "/a", "/b"] }), 1);
  assert.equal(seeded.changed, true);
  assert.deepEqual(seeded.state.projectOrder, ["/c", "/a", "/b"], "a first save keeps the order it was given");
  const more = applySessionUiStateRequest(seeded.state, request({ action: "add-projects", keys: ["/x", "/a", "/y"] }), 2);
  assert.deepEqual(more.state.projectOrder, ["/x", "/y", "/c", "/a", "/b"]);
  const again = applySessionUiStateRequest(more.state, request({ action: "add-projects", keys: ["/y", "/x"] }), 3);
  assert.equal(again.changed, false, "idempotent: two windows saving at once write once");
  assert.deepEqual(again.state.projectOrder, more.state.projectOrder);

  const full = ordered(Array.from({ length: MAX_PROJECT_ORDER_KEYS }, (_, index) => `/p${index}`));
  const refused = applySessionUiStateRequest(full, request({ action: "add-projects", keys: ["/new"] }), 4);
  assert.equal(refused.changed, false);
  assert.deepEqual(refused.state.projectOrder, full.projectOrder, "nothing is evicted");
  // Room for two of three: the last two go in (they render right above the
  // saved keys), so the one left out, still unsaved and shown first, keeps its place.
  const almost = ordered(full.projectOrder.slice(2));
  const partly = applySessionUiStateRequest(almost, request({ action: "add-projects", keys: ["/n1", "/n2", "/n3"] }), 5);
  assert.deepEqual(partly.state.projectOrder.slice(0, 3), ["/n2", "/n3", "/p2"]);
  assert.equal(partly.state.projectOrder.length, MAX_PROJECT_ORDER_KEYS);
});

test("add-projects keeps within the byte budget", () => {
  const long = (index) => `/${index}`.padEnd(4096, "项");
  let current = state();
  for (let index = 0; index < 40; index++) {
    current = applySessionUiStateRequest(current, request({ action: "add-projects", keys: [long(index)] }), index).state;
  }
  assert.ok(current.projectOrder.length < 40);
  assert.ok(orderBytes(current.projectOrder) <= PROJECT_ORDER_MAX_BYTES);
  const short = applySessionUiStateRequest(current, request({ action: "add-projects", keys: ["/s"] }), 99);
  assert.equal(short.changed, true, "a short key still fits");
});

test("move-project places a key next to its anchor, with hidden keys in between", () => {
  // "/h" is a project not shown: "/a after /b" and "/a before /c" give the same band order.
  const start = ordered(["/a", "/b", "/h", "/c"]);
  const after = applySessionUiStateRequest(start, request({ action: "move-project", projectKey: "/a", anchorKey: "/b", position: "after" }), 1);
  assert.equal(after.changed, true);
  assert.deepEqual(after.state.projectOrder, ["/b", "/a", "/h", "/c"]);
  const before = applySessionUiStateRequest(start, request({ action: "move-project", projectKey: "/a", anchorKey: "/c", position: "before" }), 1);
  assert.deepEqual(before.state.projectOrder, ["/b", "/h", "/a", "/c"]);
  const visible = (order) => order.filter((key) => key !== "/h");
  assert.deepEqual(visible(after.state.projectOrder), visible(before.state.projectOrder));
  const up = applySessionUiStateRequest(start, request({ action: "move-project", projectKey: "/c", anchorKey: "/a", position: "before" }), 1);
  assert.deepEqual(up.state.projectOrder, ["/c", "/a", "/b", "/h"]);

  const noop = applySessionUiStateRequest(start, request({ action: "move-project", projectKey: "/b", anchorKey: "/a", position: "after" }), 1);
  assert.equal(noop.changed, false);
  // A key or anchor without a place: the anchor goes to the top first, where an unsaved project renders.
  const missing = applySessionUiStateRequest(start, request({ action: "move-project", projectKey: "/new", anchorKey: "/x", position: "after" }), 1);
  assert.deepEqual(missing.state.projectOrder, ["/x", "/new", "/a", "/b", "/h", "/c"]);
  const fromEmpty = applySessionUiStateRequest(state(), request({ action: "move-project", projectKey: "/a", anchorKey: "/b", position: "before" }), 1);
  assert.deepEqual(fromEmpty.state.projectOrder, ["/a", "/b"]);
});

test("move-project saves its band's unsaved keys first, so the move lands where it was seen", () => {
  // On screen: U1, U2 (unsaved, first), then the saved /a, /b. U2 dropped after /a.
  const moved = applySessionUiStateRequest(ordered(["/a", "/b"]), request({
    action: "move-project", projectKey: "/u2", anchorKey: "/a", position: "after", add: ["/u1", "/u2"],
  }), 1);
  assert.deepEqual(moved.state.projectOrder, ["/u1", "/a", "/u2", "/b"]);
  // /b dropped before U1: without the add, U1 and U2 would still render above it.
  const top = applySessionUiStateRequest(ordered(["/a", "/b"]), request({
    action: "move-project", projectKey: "/b", anchorKey: "/u1", position: "before", add: ["/u1", "/u2"],
  }), 1);
  assert.deepEqual(top.state.projectOrder, ["/b", "/u1", "/u2", "/a"]);
});

test("move-project evicts only keys it does not name from a full list", () => {
  const keys = Array.from({ length: MAX_PROJECT_ORDER_KEYS }, (_, index) => `/p${index}`);
  const moved = applySessionUiStateRequest(ordered(keys), request({
    action: "move-project", projectKey: "/p999", anchorKey: "/n1", position: "after", add: ["/n1", "/n2"],
  }), 1);
  const order = moved.state.projectOrder;
  assert.equal(order.length, MAX_PROJECT_ORDER_KEYS);
  assert.deepEqual(order.slice(0, 3), ["/n1", "/p999", "/n2"]);
  assert.ok(!order.includes("/p998") && !order.includes("/p997"), "the last keys it did not name went");
  assert.ok(order.includes("/p996"));
});

test("pinning puts a project at the bottom of the pinned band, unpinning at the top of the others", () => {
  const pinned = { "/p1": { pinnedAt: 1, root: "/p1" }, "/p2": { pinnedAt: 2, root: "/p2" } };
  const start = ordered(["/a", "/p1", "/b", "/p2", "/c"], pinned);
  const pin = applySessionUiStateRequest(start, request({ action: "pin-project", projectKey: "/c", root: "/c", pinned: true }), 5);
  assert.deepEqual(pin.state.projectOrder, ["/a", "/p1", "/b", "/p2", "/c"], "already after the last pinned key");
  const pinA = applySessionUiStateRequest(start, request({ action: "pin-project", projectKey: "/a", root: "/a", pinned: true }), 5);
  assert.deepEqual(pinA.state.projectOrder, ["/p1", "/b", "/p2", "/a", "/c"]);
  const pinNew = applySessionUiStateRequest(start, request({ action: "pin-project", projectKey: "/new", root: "/new", pinned: true }), 5);
  assert.deepEqual(pinNew.state.projectOrder, ["/a", "/p1", "/b", "/p2", "/new", "/c"], "an unsaved project gets its place too");
  const firstPin = applySessionUiStateRequest(ordered(["/a", "/b"]), request({ action: "pin-project", projectKey: "/b", root: "/b", pinned: true }), 5);
  assert.deepEqual(firstPin.state.projectOrder, ["/b", "/a"], "no pinned key yet: the top");

  const unpin = applySessionUiStateRequest(start, request({ action: "pin-project", projectKey: "/p2", root: "/p2", pinned: false }), 5);
  assert.deepEqual(unpin.state.projectOrder, ["/p2", "/a", "/p1", "/b", "/c"], "before the first key not pinned");
  const allPinned = ordered(["/p1", "/p2"], pinned);
  const unpinLast = applySessionUiStateRequest(allPinned, request({ action: "pin-project", projectKey: "/p1", root: "/p1", pinned: false }), 5);
  assert.deepEqual(unpinLast.state.projectOrder, ["/p2", "/p1"]);

  const newRoot = applySessionUiStateRequest(start, request({ action: "pin-project", projectKey: "/p1", root: "/P1", pinned: true }), 5);
  assert.equal(newRoot.changed, true);
  assert.deepEqual(newRoot.state.projectOrder, start.projectOrder, "a new root changes no band");
  const noOrder = applySessionUiStateRequest(state(), request({ action: "pin-project", projectKey: "/a", root: "/a", pinned: true }), 5);
  assert.equal("projectOrder" in noOrder.state, false, "no order stays no order");
  const full = ordered(Array.from({ length: MAX_PROJECT_ORDER_KEYS }, (_, index) => `/p${index}`));
  const pinFull = applySessionUiStateRequest(full, request({ action: "pin-project", projectKey: "/new", root: "/new", pinned: true }), 5);
  assert.equal(pinFull.changed, true);
  assert.deepEqual(pinFull.state.projectOrder, full.projectOrder, "a full list pushes no key out for a pin");
  const pinKnown = applySessionUiStateRequest(full, request({ action: "pin-project", projectKey: "/p5", root: "/p5", pinned: true }), 5);
  assert.deepEqual(pinKnown.state.projectOrder.slice(0, 2), ["/p5", "/p0"], "a key it has still moves");
});

test("project order requests never mutate their input, and copies are separate", () => {
  const start = ordered(["/a", "/b"], { "/a": { pinnedAt: 1, root: "/a" } });
  const frozen = JSON.stringify(start);
  const added = applySessionUiStateRequest(start, request({ action: "add-projects", keys: ["/c"] }), 1);
  applySessionUiStateRequest(start, request({ action: "move-project", projectKey: "/b", anchorKey: "/a", position: "before", add: ["/z"] }), 1);
  applySessionUiStateRequest(start, request({ action: "pin-project", projectKey: "/b", root: "/b", pinned: true }), 1);
  applySessionUiStateRequest(start, request({ action: "pin-project", projectKey: "/a", root: "/a", pinned: false }), 1);
  assert.equal(JSON.stringify(start), frozen);
  assert.notEqual(added.state.projectOrder, start.projectOrder);
  const unchanged = applySessionUiStateRequest(start, request({ action: "set", ids: ["s"], pinned: false }), 1);
  assert.notEqual(unchanged.state.projectOrder, start.projectOrder, "copied, not shared");
  assert.deepEqual(unchanged.state.projectOrder, start.projectOrder);
  assert.equal("projectOrder" in applySessionUiStateRequest(state(), request({ action: "set", ids: ["s"], pinned: true }), 1).state, false);
});

const named = (projectNames) => ({ ...state(), projectNames });
const namesBytes = (names) => Buffer.byteLength(JSON.stringify(names), "utf8");

test("a project name is one trimmed line of at most 80 characters; empty is none", () => {
  assert.equal(MAX_PROJECT_NAME_LENGTH, 80);
  assert.equal(projectDisplayName("  Thermal Models  "), "Thermal Models");
  assert.equal(projectDisplayName("热模型 · 二期"), "热模型 · 二期");
  assert.equal(projectDisplayName("<img src=x onerror=alert(1)>"), "<img src=x onerror=alert(1)>", "markup is only text");
  // Characters, not UTF-16 units: 80 emoji fit, 81 letters do not.
  assert.equal(projectDisplayName("😀".repeat(80)), "😀".repeat(80));
  assert.equal(projectDisplayName(` ${"x".repeat(80)} `), "x".repeat(80));
  assert.equal(projectDisplayName("x".repeat(81)), undefined);
  for (const value of [null, "", "   ", "\t\n"]) assert.equal(projectDisplayName(value), null, JSON.stringify(value));
  for (const value of [undefined, 1, true, {}, [], "two\nlines", "a\tb", "a b", "a\u0000b", "a\u0085b"]) {
    assert.equal(projectDisplayName(value), undefined, JSON.stringify(value));
  }
});

test("parse takes rename-project with a trimmed name, or null to clear it", () => {
  assert.deepEqual(request({ action: "rename-project", projectKey: "/repo", name: "  Repo  ", extra: 1 }), { action: "rename-project", projectKey: "/repo", name: "Repo" });
  assert.deepEqual(request({ action: "rename-project", projectKey: "/repo", name: null }), { action: "rename-project", projectKey: "/repo", name: null });
  assert.deepEqual(request({ action: "rename-project", projectKey: "/repo", name: "  " }), { action: "rename-project", projectKey: "/repo", name: null });
  const refused = [
    { action: "rename-project", projectKey: "/repo" },
    { action: "rename-project", projectKey: "/repo", name: 7 },
    { action: "rename-project", projectKey: "/repo", name: "x".repeat(81) },
    { action: "rename-project", projectKey: "/repo", name: "a\nb" },
    { action: "rename-project", projectKey: "", name: "x" },
    { action: "rename-project", projectKey: "__proto__", name: "x" },
    { action: "rename-project", projectKey: "x".repeat(4097), name: "x" },
    { action: "rename-project", name: "x" },
  ];
  for (const body of refused) {
    const result = parse(body);
    assert.equal(result.ok, false, JSON.stringify(body).slice(0, 120));
    assert.equal(typeof result.error, "string");
  }
});

test("rename-project sets, changes and clears one project's name, and nothing else", () => {
  const start = ordered(["/b", "/a"], { "/a": { pinnedAt: 1, root: "/a" } });
  const frozen = JSON.stringify(start);
  const set = applySessionUiStateRequest(start, request({ action: "rename-project", projectKey: "/a", name: "Alpha" }), 5);
  assert.equal(set.changed, true);
  assert.deepEqual(set.state, { ...start, projectNames: { "/a": "Alpha" } }, "pins, order and revision untouched");
  assert.equal(JSON.stringify(start), frozen, "input never mutated");
  assert.equal(storedProjectName(set.state, "/a"), "Alpha");
  assert.equal(storedProjectName(set.state, "/b"), undefined);
  assert.equal(storedProjectName(set.state, "constructor"), undefined, "no Object.prototype member reads as a name");
  assert.equal(applySessionUiStateRequest(set.state, request({ action: "rename-project", projectKey: "/a", name: "Alpha" }), 6).changed, false);
  // Duplicate names are fine: the path tells the projects apart.
  const both = applySessionUiStateRequest(set.state, request({ action: "rename-project", projectKey: "/b", name: "Alpha" }), 6).state;
  assert.deepEqual(both.projectNames, { "/a": "Alpha", "/b": "Alpha" });
  const changed = applySessionUiStateRequest(both, request({ action: "rename-project", projectKey: "/a", name: "A" }), 7).state;
  assert.deepEqual(changed.projectNames, { "/a": "A", "/b": "Alpha" });
  const cleared = applySessionUiStateRequest(changed, request({ action: "rename-project", projectKey: "/b", name: null }), 8);
  assert.equal(cleared.changed, true);
  assert.deepEqual(cleared.state.projectNames, { "/a": "A" });
  const empty = applySessionUiStateRequest(cleared.state, request({ action: "rename-project", projectKey: "/a", name: null }), 9).state;
  assert.equal("projectNames" in empty, false, "absent while empty");
  assert.equal(applySessionUiStateRequest(empty, request({ action: "rename-project", projectKey: "/a", name: null }), 9).changed, false);
  // The client's own request before parsing: the same rule, so the optimistic view matches the server.
  assert.deepEqual(applySessionUiStateRequest(state(), { action: "rename-project", projectKey: "/a", name: "  Alpha " }, 1).state.projectNames, { "/a": "Alpha" });
  assert.equal(applySessionUiStateRequest(state(), { action: "rename-project", projectKey: "/a", name: "x".repeat(81) }, 1).changed, false);
  // Copies are separate.
  const copy = applySessionUiStateRequest(set.state, request({ action: "set", ids: ["s"], pinned: false }), 1).state;
  assert.notEqual(copy.projectNames, set.state.projectNames);
  assert.deepEqual(copy.projectNames, set.state.projectNames);
});

test("rename-project never pushes another project's name out: a full list stores no new one", () => {
  const many = Object.fromEntries(Array.from({ length: MAX_PROJECT_NAMES }, (_, index) => [`/p${index}`, `P${index}`]));
  const full = named(many);
  const refused = applySessionUiStateRequest(full, request({ action: "rename-project", projectKey: "/new", name: "New" }), 1);
  assert.equal(refused.changed, false);
  assert.equal(storedProjectName(refused.state, "/new"), undefined);
  assert.deepEqual(refused.state.projectNames, many);
  // A project that has a name can still change or drop it.
  assert.equal(storedProjectName(applySessionUiStateRequest(full, request({ action: "rename-project", projectKey: "/p3", name: "Three" }), 1).state, "/p3"), "Three");
  assert.equal(Object.keys(applySessionUiStateRequest(full, request({ action: "rename-project", projectKey: "/p3", name: null }), 1).state.projectNames).length, MAX_PROJECT_NAMES - 1);
  // Bytes: 4096-character CJK keys reach the byte budget long before the count.
  const longKey = (index) => `${index}`.padEnd(4096, "项");
  let bytesFull = state();
  for (let index = 0; index < MAX_PROJECT_NAMES; index++) {
    const next = applySessionUiStateRequest(bytesFull, request({ action: "rename-project", projectKey: longKey(index), name: "名".repeat(80) }), 1);
    if (!next.changed) break;
    bytesFull = next.state;
  }
  const kept = Object.keys(bytesFull.projectNames).length;
  assert.ok(kept > 0 && kept < 100, `${kept} long names`);
  assert.ok(namesBytes(bytesFull.projectNames) <= PROJECT_NAMES_MAX_BYTES);
});

test("normalize keeps clean project names within both limits and reads anything else as none", () => {
  const normalized = normalizeSessionUiState({
    sessions: { a: { pinnedAt: 1 } },
    projectNames: { "/a": "  Alpha ", "/b": "", "/c": 7, "/d": "x".repeat(81), "/e": "two\nlines", "": "Empty key", "/f": "热模型" },
  });
  assert.deepEqual(normalized.projectNames, { "/a": "Alpha", "/f": "热模型" });
  const proto = normalizeSessionUiState(JSON.parse('{"projectNames":{"__proto__":"x","/a":"A"}}'));
  assert.equal(Object.getPrototypeOf(proto.projectNames), Object.prototype);
  assert.deepEqual(Object.keys(proto.projectNames), ["/a"]);
  for (const value of ["Alpha", ["/a"], null, 1]) {
    const read = normalizeSessionUiState({ sessions: { a: { pinnedAt: 1 } }, projectNames: value });
    assert.notEqual(read, null, "bad names are no reason to set pins and archive aside");
    assert.deepEqual(read.sessions, { a: { pinnedAt: 1 } });
    assert.equal("projectNames" in read, false);
  }
  assert.equal("projectNames" in normalizeSessionUiState({ projectNames: {} }), false, "absent while empty");
  assert.equal("projectNames" in normalizeSessionUiState({ projectNames: { "/a": "" } }), false);
  // The first ones that fit: the count, then the UTF-8 bytes (a Windows `\` doubles in JSON).
  const many = Object.fromEntries(Array.from({ length: MAX_PROJECT_NAMES + 5 }, (_, index) => [`/p${index}`, `P${index}`]));
  assert.deepEqual(Object.keys(normalizeSessionUiState({ projectNames: many }).projectNames), Object.keys(many).slice(0, MAX_PROJECT_NAMES));
  const long = Object.fromEntries(Array.from({ length: 80 }, (_, index) => [`${index}`.padEnd(4096, "\\"), "名".repeat(80)]));
  const kept = normalizeSessionUiState({ projectNames: long }).projectNames;
  assert.ok(Object.keys(kept).length > 0 && Object.keys(kept).length < 80);
  assert.deepEqual(Object.keys(kept), Object.keys(long).slice(0, Object.keys(kept).length), "the first ones that fit");
  assert.ok(namesBytes(kept) <= PROJECT_NAMES_MAX_BYTES);
});

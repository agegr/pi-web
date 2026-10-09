import assert from "node:assert/strict";
import test from "node:test";

import {
  enqueueExtensionUiRequest,
  isBlockingExtensionUiRequest,
  removeExtensionUiRequest,
  retainExtensionUiRequests,
  upsertExtensionUiRequest,
} from "./extension-ui-queue.ts";

const confirm = (id) => ({ type: "extension_ui_request", id, method: "confirm", title: `Run ${id}?`, message: "Details" });
const custom = (id, lines) => ({ type: "extension_ui_request", id, method: "custom", lines });
const ids = (queue) => queue.map((request) => request.id);

test("only the methods a person has to answer count as blocking", () => {
  const blocking = [
    { type: "extension_ui_request", id: "select", method: "select", title: "Choose", options: ["A"] },
    { type: "extension_ui_request", id: "confirm", method: "confirm", title: "Run?", message: "Details" },
    { type: "extension_ui_request", id: "input", method: "input", title: "Value" },
    { type: "extension_ui_request", id: "editor", method: "editor", title: "Edit" },
    { type: "extension_ui_request", id: "open-panel", method: "custom", lines: ["panel"] },
  ];
  for (const request of blocking) assert.equal(isBlockingExtensionUiRequest(request), true, request.method);

  // Everything the TUI does not wait on, plus a custom panel that has closed:
  // a host showing these as a parked run would strand the session's own spinner.
  const passive = [
    { type: "extension_ui_request", id: "notify", method: "notify", message: "Informational" },
    { type: "extension_ui_request", id: "status", method: "setStatus", statusKey: "k" },
    { type: "extension_ui_request", id: "widget", method: "setWidget", widgetKey: "k" },
    { type: "extension_ui_request", id: "title", method: "setTitle", title: "T" },
    { type: "extension_ui_request", id: "editor-text", method: "set_editor_text", text: "x" },
    { type: "extension_ui_request", id: "closed-panel", method: "custom", lines: [], closed: true },
  ];
  for (const request of passive) assert.equal(isBlockingExtensionUiRequest(request), false, request.method);
});

test("keeps concurrent requests in arrival order instead of letting the newest replace the oldest", () => {
  let queue = [];
  queue = enqueueExtensionUiRequest(queue, confirm("a"));
  queue = enqueueExtensionUiRequest(queue, confirm("b"));
  queue = enqueueExtensionUiRequest(queue, confirm("c"));

  assert.deepEqual(ids(queue), ["a", "b", "c"]);
});

test("answering the head shows the next request, and closing a waiting one removes only that id", () => {
  const queue = [confirm("a"), confirm("b"), confirm("c")];

  const afterAnswer = removeExtensionUiRequest(queue, "a");
  assert.deepEqual(ids(afterAnswer), ["b", "c"]);

  // The server closes a waiting request when it expires or its tool is aborted.
  const afterClose = removeExtensionUiRequest(afterAnswer, "c");
  assert.deepEqual(ids(afterClose), ["b"]);
  assert.deepEqual(ids(queue), ["a", "b", "c"], "the previous queue is not mutated");
});

test("a reconnect replay of a queued dialog neither duplicates nor reorders it", () => {
  const queue = [confirm("a"), confirm("b")];
  const replayed = enqueueExtensionUiRequest(enqueueExtensionUiRequest(queue, confirm("a")), confirm("b"));

  assert.equal(replayed, queue, "unchanged queues keep their identity so React skips the render");
  assert.deepEqual(ids(replayed), ["a", "b"]);
});

test("closing an id that is not queued leaves the queue untouched", () => {
  const queue = [confirm("a")];

  // Answering removes the dialog locally before the server's extension_ui_closed arrives.
  assert.equal(removeExtensionUiRequest(queue, "missing"), queue);
  assert.deepEqual(removeExtensionUiRequest(removeExtensionUiRequest(queue, "a"), "a"), []);
});

test("Stop clears every queued request through its own close event", () => {
  let queue = [confirm("a"), confirm("b"), confirm("c")];
  for (const id of ["a", "b", "c"]) queue = removeExtensionUiRequest(queue, id);

  assert.deepEqual(queue, []);
});

test("a custom panel's re-render replaces it in place, and a second panel waits behind the first", () => {
  let queue = [];
  queue = upsertExtensionUiRequest(queue, custom("a", ["first"]));
  queue = upsertExtensionUiRequest(queue, custom("b", ["second"]));
  // Panel b renders again while a is on screen: a stays the head, b keeps its place.
  queue = upsertExtensionUiRequest(queue, custom("b", ["second, updated"]));
  queue = upsertExtensionUiRequest(queue, custom("a", ["first, updated"]));

  assert.deepEqual(ids(queue), ["a", "b"]);
  assert.deepEqual(queue.map((request) => request.lines), [["first, updated"], ["second, updated"]]);

  // Closing the panel on screen surfaces the other one with its latest render,
  // instead of leaving it hidden until it happens to render again.
  assert.deepEqual(removeExtensionUiRequest(queue, "a"), [custom("b", ["second, updated"])]);
});

test("upserting the entry already queued keeps the queue's identity", () => {
  const request = custom("a", ["only"]);
  const queue = [request];

  assert.equal(upsertExtensionUiRequest(queue, request), queue);
  assert.notEqual(upsertExtensionUiRequest(queue, custom("a", ["only"])), queue, "a fresh render is a new entry");
});

test("a reconnect drops requests the server closed while the stream was down, keeping the rest in place", () => {
  const stale = confirm("a");
  const waiting = confirm("b");
  const queue = [stale, waiting, custom("c", ["panel"])];

  // The server now holds only b and c: a timed out, or was answered in another tab.
  const reconciled = retainExtensionUiRequests(queue, new Set(["b", "c", "d"]));
  assert.deepEqual(ids(reconciled), ["b", "c"]);
  assert.equal(reconciled[0], waiting, "a surviving request keeps its identity, and so its typed input");

  // Nothing closed: the same queue comes back, so nothing re-renders.
  assert.equal(retainExtensionUiRequests(reconciled, new Set(["b", "c"])), reconciled);
  assert.deepEqual(retainExtensionUiRequests(queue, new Set()), []);
});

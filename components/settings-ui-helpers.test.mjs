import assert from "node:assert/strict";
import test from "node:test";
import { itemsToSwitch, projectTrustReloadKey } from "./settings-ui-helpers.ts";

const rows = [
  { name: "on", on: true, pinned: false },
  { name: "off", on: false, pinned: false },
  { name: "pinned-on", on: true, pinned: true },
  { name: "pinned-off", on: false, pinned: true },
];
const isOn = (row) => row.on;
const isPinned = (row) => row.pinned;
const names = (items) => items.map((row) => row.name);

test("a group switch targets only the rows not already in the requested state", () => {
  assert.deepEqual(names(itemsToSwitch(rows, true, isOn)), ["off", "pinned-off"]);
  assert.deepEqual(names(itemsToSwitch(rows, false, isOn)), ["on", "pinned-on"]);
  assert.deepEqual(itemsToSwitch(rows.filter(isOn), true, isOn), []);
  assert.deepEqual(itemsToSwitch([], false, isOn), []);
});

test("switching a group off leaves the rows keepOn names, and switching on ignores it", () => {
  assert.deepEqual(names(itemsToSwitch(rows, false, isOn, isPinned)), ["on"]);
  assert.deepEqual(names(itemsToSwitch(rows, true, isOn, isPinned)), ["off", "pinned-off"]);
});

test("returns the original rows in their order", () => {
  const result = itemsToSwitch(rows, true, isOn);
  assert.equal(result[0], rows[1]);
  assert.equal(result[1], rows[3]);
});

test("the page's trust status reloads a settings panel only when its decision changes", () => {
  const untrusted = { requiresTrust: true, trusted: false, decision: null, inherited: false };
  const trusted = { requiresTrust: true, trusted: true, decision: true, decisionPath: "/repo", inherited: false };
  assert.equal(projectTrustReloadKey(null), "");
  assert.equal(projectTrustReloadKey(undefined), "");
  // A new object with the same decision (the dialog re-reading an unchanged folder) keeps the key.
  assert.equal(projectTrustReloadKey(untrusted), projectTrustReloadKey({ ...untrusted }));
  assert.equal(projectTrustReloadKey(trusted), projectTrustReloadKey({ ...trusted, decisionError: "ignored" }));
  const keys = new Set([
    untrusted,
    trusted,
    { ...trusted, inherited: true, decisionPath: "/" },
    { ...untrusted, decision: false, decisionPath: "/repo" },
    { requiresTrust: false, trusted: true, decision: null, inherited: false },
  ].map(projectTrustReloadKey));
  assert.equal(keys.size, 5);
  assert.ok(![...keys].includes(""));
});

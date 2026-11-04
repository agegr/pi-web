import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const {
  DIRECTORY_PREVIEW_DELAY_MS,
  browsableInputValue,
  canSelectDirectory,
  createBrowseLane,
  inputMatchesBrowsed,
  isAbortError,
} = await jiti.import("./directory-picker-sync.ts");

test("a debounce interval long enough to merge a typed path", () => {
  assert.equal(typeof DIRECTORY_PREVIEW_DELAY_MS, "number");
  assert.ok(DIRECTORY_PREVIEW_DELAY_MS >= 100 && DIRECTORY_PREVIEW_DELAY_MS <= 1000);
});

test("only the newest browse request may answer", () => {
  const lane = createBrowseLane();
  const first = lane.begin();
  assert.equal(lane.isCurrent(first), true);
  const second = lane.begin();
  assert.equal(second, first + 1);
  assert.equal(lane.isCurrent(first), false);
  assert.equal(lane.isCurrent(second), true);
  assert.equal(lane.isCurrent(99), false);
});

test("blank input is not a browsable path", () => {
  assert.equal(browsableInputValue("  /tmp  "), "/tmp");
  assert.equal(browsableInputValue("   "), "");
  assert.equal(browsableInputValue(""), "");
});

test("the list matches the text that was browsed, not the resolved directory", () => {
  // A trailing slash and a home shortcut are kept as typed.
  assert.equal(inputMatchesBrowsed("/tmp/", "/tmp/"), true);
  assert.equal(inputMatchesBrowsed("  /tmp/  ", "/tmp/"), true);
  assert.equal(inputMatchesBrowsed("~/work", "~/work"), true);
  assert.equal(inputMatchesBrowsed("/tmp/", "/tmp"), false);
  // macOS resolves /tmp to /private/tmp: the typed text still matches its own list.
  assert.equal(inputMatchesBrowsed("/tmp", "/tmp"), true);
  assert.equal(inputMatchesBrowsed("/tmp", "/private/tmp"), false);
  assert.equal(inputMatchesBrowsed("", ""), false);
  assert.equal(inputMatchesBrowsed("   ", "   "), false);
});

test("selecting needs a browsed directory whose list matches the input", () => {
  const base = { currentPath: "/tmp", input: "/tmp", browsedInput: "/tmp" };
  assert.equal(canSelectDirectory(base), true);
  assert.equal(canSelectDirectory({ ...base, busy: true }), false);
  assert.equal(canSelectDirectory({ ...base, loading: true }), false);
  assert.equal(canSelectDirectory({ ...base, previewing: true }), false);
  assert.equal(canSelectDirectory({ ...base, unresolved: true }), false);
  // Nothing browsed yet: the Windows drive list has no directory to select.
  assert.equal(canSelectDirectory({ ...base, currentPath: "" }), false);
  // Still typing towards another folder: the list belongs to the old text.
  assert.equal(canSelectDirectory({ ...base, input: "/tmp/work" }), false);
  // Cleared input.
  assert.equal(canSelectDirectory({ ...base, input: "  " }), false);
});

test("an aborted fetch is not reported as a failed path", () => {
  assert.equal(isAbortError(Object.assign(new Error("aborted"), { name: "AbortError" })), true);
  assert.equal(isAbortError(new Error("Directory does not exist")), false);
  assert.equal(isAbortError(undefined), false);
  assert.equal(isAbortError(null), false);
});

import assert from "node:assert/strict";
import test from "node:test";
import {
  getExtensionDialogHeading,
  getExtensionDialogPrompt,
  getExtensionDialogSummary,
} from "./extension-dialog-copy.ts";

test("keeps a short select title in the header", () => {
  const request = { method: "select", title: "Choose a model", options: ["A", "B"] };
  assert.equal(getExtensionDialogHeading(request), "Choose a model");
  assert.equal(getExtensionDialogPrompt(request), undefined);
  assert.equal(getExtensionDialogSummary(request), "A");
});

test("moves a multiline select title into the scrollable body", () => {
  const request = {
    method: "select",
    title: "Confirm Goal Draft\n\n● Goal draft ready for confirmation.\n\n─── Proposed Goal ───\n│   Do the thing",
    options: ["1. Confirm — create this goal now", "2. Continue chatting — keep refining"],
  };
  assert.equal(getExtensionDialogHeading(request), "Confirm Goal Draft");
  assert.equal(
    getExtensionDialogPrompt(request),
    "● Goal draft ready for confirmation.\n\n─── Proposed Goal ───\n│   Do the thing",
  );
  assert.equal(getExtensionDialogSummary(request), "● Goal draft ready for confirmation.");
});

test("keeps a long single-line select title in the header", () => {
  const title = "Select the model you would like to use for this conversation " + "A".repeat(80);
  const request = { method: "select", title, options: ["Yes"] };
  assert.equal(getExtensionDialogHeading(request), title);
  assert.equal(getExtensionDialogPrompt(request), undefined);
  assert.equal(getExtensionDialogSummary(request), "Yes");
});

test("preserves a long multiline select body for the scrollable prompt", () => {
  const body = `Objective: ${"do the thing ".repeat(40).trim()}\n\nTasks:\n1. First\n2. Second`;
  const request = {
    method: "select",
    title: `Confirm Goal Draft\n\n${body}`,
    options: ["Confirm"],
  };
  assert.equal(getExtensionDialogHeading(request), "Confirm Goal Draft");
  assert.equal(getExtensionDialogPrompt(request), body);
  assert.ok((getExtensionDialogPrompt(request) ?? "").includes("Tasks:"));
});

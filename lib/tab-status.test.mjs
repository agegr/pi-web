import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const {
  TAB_RUN_COLORS,
  TAB_RUN_GLYPHS,
  TAB_SPINNER_FRAMES,
  TAB_SPINNER_INTERVAL_MS,
  formatTabTitle,
  tabRunPhaseAfterEnd,
  tabRunPrefix,
  tabRunStatus,
} = await jiti.import("./tab-status.ts");

test("the spinner walks its frames and wraps in both directions", () => {
  assert.equal(tabRunPrefix("running", 0), TAB_SPINNER_FRAMES[0]);
  assert.equal(tabRunPrefix("running", 3), TAB_SPINNER_FRAMES[3]);
  assert.equal(tabRunPrefix("running", TAB_SPINNER_FRAMES.length), TAB_SPINNER_FRAMES[0]);
  assert.equal(tabRunPrefix("running", TAB_SPINNER_FRAMES.length + 2), TAB_SPINNER_FRAMES[2]);
  assert.equal(tabRunPrefix("running", -1), TAB_SPINNER_FRAMES[TAB_SPINNER_FRAMES.length - 1]);
  assert.equal(tabRunPrefix("running", 1.7), TAB_SPINNER_FRAMES[1]);
  assert.ok(TAB_SPINNER_INTERVAL_MS >= 60 && TAB_SPINNER_INTERVAL_MS <= 500);
});

test("a finished run shows a glyph, an idle tab shows only its name", () => {
  assert.equal(formatTabTitle("pi-web - Pi Web", "running", 1), `${TAB_SPINNER_FRAMES[1]} pi-web - Pi Web`);
  assert.equal(formatTabTitle("pi-web - Pi Web", "done"), `${TAB_RUN_GLYPHS.done} pi-web - Pi Web`);
  assert.equal(formatTabTitle("pi-web - Pi Web", "failed"), `${TAB_RUN_GLYPHS.failed} pi-web - Pi Web`);
  assert.equal(formatTabTitle("pi-web - Pi Web", "idle"), "pi-web - Pi Web");
  assert.equal(formatTabTitle("", "failed"), `${TAB_RUN_GLYPHS.failed} Pi Web`);
});

test("only finished runs have a colour, and it is the sidebar's green or red", () => {
  assert.equal(tabRunStatus("running"), null);
  assert.equal(tabRunStatus("idle"), null);
  assert.equal(tabRunStatus("done"), "done");
  assert.equal(tabRunStatus("failed"), "failed");
  assert.equal(TAB_RUN_COLORS.done, "#16a34a");
  assert.equal(TAB_RUN_COLORS.failed, "#dc2626");
});

test("a stopped run leaves no mark, a subagent still at work keeps the spinner", () => {
  assert.equal(tabRunPhaseAfterEnd({ aborted: true }), "idle");
  assert.equal(tabRunPhaseAfterEnd({ aborted: true, failed: true }), "idle");
  assert.equal(tabRunPhaseAfterEnd({ subagentsActive: true }), "running");
  assert.equal(tabRunPhaseAfterEnd({ subagentsActive: true, failed: true }), "running");
  assert.equal(tabRunPhaseAfterEnd({}), "done");
  assert.equal(tabRunPhaseAfterEnd({ failed: true }), "failed");
});

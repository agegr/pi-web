import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const view = readFileSync(new URL("./TrajectoryView.tsx", import.meta.url), "utf8");
const timeline = readFileSync(new URL("./TrajectoryTimeline.tsx", import.meta.url), "utf8");
const ledger = readFileSync(new URL("./TrajectoryLedger.tsx", import.meta.url), "utf8");
const inspector = readFileSync(new URL("./TrajectoryInspector.tsx", import.meta.url), "utf8");
const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");

test("TrajectoryView composes timeline, ledger, inspector and composer", () => {
  assert.match(view, /TrajectoryTimeline/);
  assert.match(view, /TrajectoryLedger/);
  assert.match(view, /TrajectoryInspector/);
  assert.match(view, /composer/);
});

test("timeline renders a timing overview with selectable spans", () => {
  assert.match(timeline, /Timing overview/);
  assert.match(timeline, /onSelect/);
  assert.match(timeline, /trajectory-span/);
});

test("ledger renders search, filters and expandable subagent rows", () => {
  assert.match(ledger, /Search events/);
  assert.match(ledger, /kind/);
  assert.match(ledger, /status/);
  assert.match(ledger, /onExpandSubagent/);
});

test("ledger owns its search and filter state", () => {
  assert.match(ledger, /useState\(""\)/);
  assert.match(ledger, /useState\("all"\)/);
});

test("inspector renders summary-first details with explicit confirmation", () => {
  assert.match(inspector, /Load full details/);
  assert.match(inspector, /onConfirmFullDetails/);
  assert.match(inspector, /onCancelFullDetails/);
  assert.match(inspector, /onClose/);
  assert.doesNotMatch(inspector, /"schema"/);
});

test("token totals use the native compact formatter", () => {
  assert.match(view, /Intl\.NumberFormat/);
});

test("css contains desktop grid, mobile sheet and reduced motion rules", () => {
  assert.match(css, /trajectory-ledger/);
  assert.match(css, /trajectory-inspector/);
  assert.match(css, /trajectory-timeline/);
  assert.match(css, /@media \(max-width: 640px\)/);
  assert.match(css, /prefers-reduced-motion/);
});

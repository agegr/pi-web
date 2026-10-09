import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const {
  BG_TASK_NOTIFICATION_CUSTOM_TYPE,
  buildBgTaskNotification,
  parseBgTaskReport,
} = await createJiti(import.meta.url).import("./bg-task-notification.ts");

const outcome = {
  command: "bun scripts/run.js",
  logPath: "/tmp/pi-web-bg-tasks/abc.log",
  startedAtMs: 1_000,
  finishedAtMs: 13_400,
  exitCode: 0,
};

test("names the custom message type the report is delivered under", () => {
  assert.equal(BG_TASK_NOTIFICATION_CUSTOM_TYPE, "pi-web:bg-task-notification");
});

test("round-trips a report without losing the prefix the model needs", () => {
  const text = buildBgTaskNotification(outcome, "hello\nworld");
  assert.match(text, /^The following is a background bash task's report/);
  assert.deepEqual(parseBgTaskReport(text), {
    outcome: "completed",
    duration: "12.4",
    command: "bun scripts/run.js",
    logPath: "/tmp/pi-web-bg-tasks/abc.log",
    tail: "hello\nworld",
  });
});

test("reports a failure with its reason and keeps an empty tail", () => {
  const text = buildBgTaskNotification({ ...outcome, exitCode: null, error: "timeout:1800" }, "");
  const report = parseBgTaskReport(text);
  assert.equal(report.outcome, "failed (timeout:1800)");
  assert.equal(report.tail, "(no output)");
});

test("parses a report whose command spans lines and whose tail ends in a fence", () => {
  const text = buildBgTaskNotification({
    ...outcome,
    command: "FOO=1 \\\n  bun scripts/run.js",
  }, "before\n```\nafter");
  const report = parseBgTaskReport(text);
  assert.equal(report.command, "FOO=1 \\\n  bun scripts/run.js");
  assert.equal(report.tail, "before\n```\nafter");
});

test("returns null for text that is not a report", () => {
  assert.equal(parseBgTaskReport("just some text"), null);
  assert.equal(parseBgTaskReport(""), null);
});
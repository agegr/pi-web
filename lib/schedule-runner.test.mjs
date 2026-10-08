import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));

/**
 * The scheduler's interval must stay ref'd.
 *
 * `timer.unref()` looks harmless and even tidy ("don't hold the process open"),
 * but an unref'd interval lets the event loop treat it as ignorable: the timer
 * reports as started while never firing. That shipped once and the schedule
 * silently did nothing, so it is pinned here.
 */
test("startScheduleRunner does not unref its interval", () => {
  const source = readFileSync(join(here, "schedule-runner.ts"), "utf8");
  const start = source.indexOf("export function startScheduleRunner");
  assert.ok(start !== -1, "startScheduleRunner must exist");
  const body = source.slice(start, source.indexOf("\n}", start));
  assert.ok(
    !/timer\.unref/.test(body),
    "startScheduleRunner must not call timer.unref(): an unref'd interval never fires",
  );
});

test("stopScheduleRunner clears the interval so shutdown is not blocked", () => {
  const source = readFileSync(join(here, "schedule-runner.ts"), "utf8");
  const start = source.indexOf("export function stopScheduleRunner");
  assert.ok(start !== -1, "stopScheduleRunner must exist");
  const body = source.slice(start, source.indexOf("\n}", start));
  assert.ok(/clearInterval/.test(body), "stopScheduleRunner must clearInterval");
});

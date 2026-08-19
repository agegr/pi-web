import assert from "node:assert/strict";
import { test } from "node:test";
import { runIfDue, runKey } from "./schedule.ts";

const at = (hour, minute = 0) => new Date(2026, 7, 17, hour, minute).getTime();

test("an empty (disabled) schedule is never due", () => {
  assert.equal(runKey([], at(8)), null);
});

test("a single due slot returns a bare date key", () => {
  assert.equal(runKey([{ key: "", at: "08:00" }], at(7, 59)), null);
  assert.equal(runKey([{ key: "", at: "08:00" }], at(8)), "2026-08-17");
});

test("a named slot suffixes the run key", () => {
  assert.equal(runKey([{ key: "sweep", at: "03:00" }], at(3)), "2026-08-17:sweep");
});

test("only the latest due slot fires, so a late start does not send both", () => {
  const slots = [
    { key: "morning", at: "08:00" },
    { key: "evening", at: "20:00" },
  ];
  assert.equal(runKey(slots, at(7, 59)), null);
  assert.equal(runKey(slots, at(8)), "2026-08-17:morning");
  assert.equal(runKey(slots, at(19, 59)), "2026-08-17:morning");
  assert.equal(runKey(slots, at(20)), "2026-08-17:evening");
  assert.equal(runKey(slots, at(21)), "2026-08-17:evening", "the missed morning is not replayed");
});

test("runIfDue runs only for the pending chats of a due key", async () => {
  const ledger = { pending: (_key, audience) => audience.filter((id) => id !== 42), mark: () => {} };
  const calls = [];
  await runIfDue(ledger, [42, 43], [{ key: "", at: "08:00" }], at(8), async (key, chats) => {
    calls.push([key, chats]);
  });
  assert.deepEqual(calls, [["2026-08-17", [43]]]);
});

test("runIfDue stays silent when not due, empty audience, or nothing pending", async () => {
  const ledger = { pending: () => [], mark: () => {} };
  let called = false;
  const run = async () => { called = true; };

  await runIfDue(ledger, [42], [{ key: "", at: "08:00" }], at(7), run); // not due
  await runIfDue(ledger, [], [{ key: "", at: "08:00" }], at(8), run); // empty audience
  await runIfDue(ledger, [42], [{ key: "", at: "08:00" }], at(8), run); // nothing pending
  assert.equal(called, false);
});

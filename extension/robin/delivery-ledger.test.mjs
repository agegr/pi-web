import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";

// Point the store at a scratch directory before importing it.
const dir = mkdtempSync(join(tmpdir(), "robin-ledger-"));
process.env.ROBIN_DATA_DIR = dir;

const { createDeliveryLedger } = await import("./delivery-ledger.ts");
const { writeJsonObject } = await import("./paths.ts");

after(() => rmSync(dir, { recursive: true, force: true }));

test("pending returns only the chats not yet delivered, and mark records once", () => {
  const ledger = createDeliveryLedger("t.json");
  assert.deepEqual(ledger.pending("2026-08-17", [42, 43]), [42, 43]);

  ledger.mark("2026-08-17", 42);
  assert.deepEqual(ledger.pending("2026-08-17", [42, 43]), [43]);
  assert.deepEqual(ledger.pending("2026-08-18", [42, 43]), [42, 43], "a new key starts fresh");

  ledger.mark("2026-08-17", 42); // idempotent
  assert.deepEqual(ledger.pending("2026-08-17", [42, 43]), [43]);
});

test("multiple keys coexist, so sweep and digest do not erase each other", () => {
  const ledger = createDeliveryLedger("t.json");
  ledger.mark("2026-08-17:sweep", 42);
  ledger.mark("2026-08-17:morning", 42);
  assert.deepEqual(ledger.pending("2026-08-17:sweep", [42]), []);
  assert.deepEqual(ledger.pending("2026-08-17:morning", [42]), []);
  assert.deepEqual(ledger.pending("2026-08-17:evening", [42]), [42]);
});

test("the old { runKey, chatIds } shape migrates on read without re-sending", () => {
  writeJsonObject("t.json", { runKey: "2026-08-17:morning", chatIds: [42, 43] });
  const ledger = createDeliveryLedger("t.json");
  assert.deepEqual(ledger.pending("2026-08-17:morning", [42, 43]), []);
});

test("the old { date, chatIds } shape (daily agenda) migrates on read", () => {
  writeJsonObject("t.json", { date: "2026-08-17", chatIds: [42] });
  const ledger = createDeliveryLedger("t.json");
  assert.deepEqual(ledger.pending("2026-08-17", [42, 43]), [43]);
});

test("history is capped so the file cannot grow forever", () => {
  const ledger = createDeliveryLedger("t.json");
  for (let i = 1; i <= 25; i += 1) {
    ledger.mark(`2026-08-${String(i).padStart(2, "0")}`, 42);
  }
  // The 20 most recent keys survive; the oldest five dropped.
  assert.deepEqual(ledger.pending("2026-08-01", [42]), [42], "oldest dropped");
  assert.deepEqual(ledger.pending("2026-08-25", [42]), []);
});

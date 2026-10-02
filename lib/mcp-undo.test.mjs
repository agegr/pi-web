import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { moduleCache: false });
const {
  heldRemovalCount,
  holdRemovedEntry,
  MCP_UNDO_MAX_RECORDS,
  MCP_UNDO_TTL_MS,
  returnRemovedEntry,
  takeRemovedEntry,
} = await jiti.import("./mcp-undo.ts");

function removal(name = "docs") {
  return {
    scope: "global",
    name,
    path: "/home/me/.pi/agent/mcp.json",
    entry: { url: "https://docs.example.com/mcp", headers: { Authorization: "Bearer literal-secret" } },
    index: 2,
  };
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function refTimers() {
  return process.getActiveResourcesInfo().filter((kind) => kind === "Timeout").length;
}

test("a removal is held for 60 seconds by default and taken back once", () => {
  assert.equal(MCP_UNDO_TTL_MS, 60_000);
  const now = 1_000_000;
  const { token, expiresAt } = holdRemovedEntry(removal(), { now });
  assert.match(token, /^[0-9a-f-]{36}$/);
  assert.equal(expiresAt, now + 60_000);
  const taken = takeRemovedEntry(token, now + 59_999);
  assert.deepEqual(taken, { ...removal(), token, expiresAt });
  assert.equal(takeRemovedEntry(token, now + 1), undefined, "a token undoes once");
  assert.equal(takeRemovedEntry("not-a-token"), undefined);
});

test("an expired removal cannot be taken, and its timer forgets it on its own", async () => {
  const before = heldRemovalCount();
  const late = holdRemovedEntry(removal("late"), { now: 0, ttlMs: 10 });
  assert.equal(takeRemovedEntry(late.token, 10), undefined, "past its time even before the timer ran");
  const { token } = holdRemovedEntry(removal("short"), { ttlMs: 20 });
  assert.equal(heldRemovalCount(), before + 1);
  await wait(60);
  assert.equal(heldRemovalCount(), before);
  assert.equal(takeRemovedEntry(token), undefined);
});

test("a failed undo hands the removal back for the time it had left", () => {
  const now = Date.now();
  const { token } = holdRemovedEntry(removal(), { now, ttlMs: 30_000 });
  const taken = takeRemovedEntry(token, now + 1_000);
  returnRemovedEntry(taken, now + 2_000);
  assert.deepEqual(takeRemovedEntry(token, now + 29_000), taken);
  // Once its time is up there is nothing to hand back.
  returnRemovedEntry(taken, now + 30_000);
  assert.equal(takeRemovedEntry(token, now + 30_000), undefined);
});

test("a hold never keeps the process alive", () => {
  const before = refTimers();
  const { token } = holdRemovedEntry(removal());
  assert.equal(refTimers(), before, "the 60-second timer is unref'd");
  takeRemovedEntry(token);
});

test("the oldest removal goes first once the store is full", () => {
  const tokens = Array.from({ length: MCP_UNDO_MAX_RECORDS + 1 }, (_, index) => holdRemovedEntry(removal(`s${index}`)).token);
  assert.ok(heldRemovalCount() <= MCP_UNDO_MAX_RECORDS);
  assert.equal(takeRemovedEntry(tokens[0]), undefined);
  assert.equal(takeRemovedEntry(tokens.at(-1)).name, `s${MCP_UNDO_MAX_RECORDS}`);
  for (const token of tokens) takeRemovedEntry(token);
});

test("the store is one per process, whichever copy of the module holds it", async () => {
  const other = await createJiti(import.meta.url, { moduleCache: false }).import("./mcp-undo.ts");
  const { token } = holdRemovedEntry(removal("shared"));
  assert.equal(other.takeRemovedEntry(token).name, "shared");
});

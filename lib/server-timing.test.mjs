import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { createServerTiming } = await jiti.import("./server-timing.ts");

test("records sync, async, repeated, and total durations", async () => {
  let now = 0;
  const timing = createServerTiming(() => now);

  timing.timeSync("parse", () => {
    now += 2;
  });
  await timing.time("project", async () => {
    now += 3;
  });
  timing.timeSync("parse", () => {
    now += 1;
  });
  now += 4;

  const response = timing.finish(Response.json({ ok: true }));
  assert.equal(
    response.headers.get("Server-Timing"),
    "parse;dur=3.0, project;dur=3.0, total;dur=10.0",
  );
});

test("records failed operations without swallowing their errors", async () => {
  let now = 0;
  const timing = createServerTiming(() => now);

  assert.throws(() => timing.timeSync("parse", () => {
    now += 2;
    throw new Error("sync failure");
  }), /sync failure/);

  await assert.rejects(timing.time("scan", async () => {
    now += 3;
    throw new Error("async failure");
  }), /async failure/);

  const response = timing.finish(new Response());
  assert.equal(response.headers.get("Server-Timing"), "parse;dur=2.0, scan;dur=3.0, total;dur=5.0");
});

test("does not expose dynamic or invalid metric names", () => {
  let now = 0;
  const timing = createServerTiming(() => now);
  timing.record("/home/user/private-session.jsonl", 10);
  timing.record("message content", 20);
  timing.record("valid", Number.NaN);
  now = 1;

  const response = timing.finish(new Response(null, {
    headers: { "Server-Timing": "framework;dur=0.5" },
  }));
  assert.equal(response.headers.get("Server-Timing"), "framework;dur=0.5, total;dur=1.0");
});

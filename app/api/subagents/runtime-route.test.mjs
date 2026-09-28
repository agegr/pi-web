import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  alias: { "@": process.cwd() },
  interopDefault: true,
  moduleCache: false,
});
const { GET } = await jiti.import("./[id]/route.ts");

const id = "subagent-route-test";
const context = { params: Promise.resolve({ id }) };

function installRunningSubagent(t) {
  const previousRegistry = globalThis.__piSessions;
  const entries = [{
    type: "custom",
    customType: "pi-web:subagent",
    id: "meta",
    parentId: null,
    timestamp: "2026-01-01T00:00:00.000Z",
    data: {
      version: 1,
      parentSessionId: "parent",
      parentSessionPath: "/tmp/parent.jsonl",
      parentToolCallId: "tool-call",
      profile: "Explore",
      description: "Inspect",
      task: "Inspect files",
      runInBackground: true,
      createdAt: "2026-01-01T00:00:00.000Z",
    },
  }];
  globalThis.__piSessions = new Map([[id, {
    isAlive: () => true,
    isRunning: () => true,
    sessionFile: `/tmp/${id}.jsonl`,
    inner: {
      sessionManager: { getEntries: () => entries },
    },
  }]]);
  t.after(() => {
    globalThis.__piSessions = previousRegistry;
  });
}

test("subagent route reads the persisted legacy run state", async (t) => {
  installRunningSubagent(t);

  const response = await GET(new Request(`http://localhost/api/subagents/${id}`), context);
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.run.status, "running");
  assert.equal(body.run.profile, "Explore");
});

test("subagent GET returns 404 for an unknown session", async (t) => {
  const previousRegistry = globalThis.__piSessions;
  globalThis.__piSessions = new Map();
  t.after(() => {
    globalThis.__piSessions = previousRegistry;
  });

  const missingId = `missing-subagent-${Date.now()}`;
  const response = await GET(
    new Request(`http://localhost/api/subagents/${missingId}`),
    { params: Promise.resolve({ id: missingId }) },
  );
  assert.equal(response.status, 404);
});

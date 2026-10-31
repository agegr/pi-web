import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { shortSessionId, isShortSessionId } = await jiti.import("./session-short-id.ts");
const { findSessionIdsByShortId } = await jiti.import("./session-reader.ts");
const { createSubagentController } = await jiti.import("./subagent-runtime.ts");
const { subagentFinalText } = await jiti.import("./subagent-extension.ts");

// A UUIDv7: the head is the timestamp and the process's sequence, the last 8 hex digits are random.
const LIVE = "01a14d33-da3c-77f8-8180-1c6f793865c6";
// Two sessions whose ids end in the same 32 bits: the case a short form must refuse, not guess.
const COLLIDING = [LIVE, "01a14d9c-3374-7708-a0e4-1c6f793865c6"];
const SETTLED = "01a14d33-da3c-77f8-8180-1c6f7938aaaa";

test("the short form is the uuid's last 8 hex digits, and only a uuid has one", () => {
  assert.equal(shortSessionId(LIVE), "793865c6");
  assert.equal(shortSessionId(COLLIDING[1]), "793865c6");
  assert.equal(shortSessionId(SETTLED), "7938aaaa");
  // The head of a UUIDv7 is a timestamp shared with every session started around it, so the short
  // form must never be the prefix.
  assert.notEqual(shortSessionId(LIVE), "01a14d33");
  // Dashless input, and uppercase, both end at the same tail.
  assert.equal(shortSessionId(LIVE.replaceAll("-", "")), "793865c6");
  assert.equal(shortSessionId(LIVE.toUpperCase()), "793865c6");
  // A test's fake id reads exactly as written, and so does a full id in an unknown shape.
  assert.equal(shortSessionId("child-session"), "child-session");
  assert.equal(isShortSessionId("793865c6"), true);
  assert.equal(isShortSessionId("7938C6"), false);
  assert.equal(isShortSessionId("793865c"), false);
  assert.equal(isShortSessionId("793865c6a"), false);
});

test("a report names a subagent by its short id, never the uuid", () => {
  const run = {
    sessionId: LIVE,
    sessionPath: "/tmp/child.jsonl",
    parentSessionId: "parent-session",
    parentToolCallId: "tool-call",
    profile: "Explore",
    description: "Inspect parser",
    task: "Find the parser",
    runInBackground: true,
    status: "completed",
    createdAt: "2026-01-01T00:00:00.000Z",
    completedAt: "2026-01-01T00:01:00.000Z",
    result: "Parser found",
  };
  assert.equal(subagentFinalText(run), "Subagent 793865c6 completed.\n\nParser found");
  assert.equal(subagentFinalText({ ...run, status: "running" }), "Subagent 793865c6 is running.");
  assert.doesNotMatch(subagentFinalText(run), /01a14d33/);
});

test("the session directory is scanned for ids whose tail is the given 8 characters", async (t) => {
  const agentDir = await mkdtemp(join(tmpdir(), "pi-web-short-id-"));
  const projectDir = join(agentDir, "sessions", "project");
  await mkdir(projectDir, { recursive: true });
  const session = (id) => ({
    type: "session", version: 3, id, timestamp: "2026-01-01T00:00:00.000Z", cwd: "/repo",
  });
  const write = async (id) => writeFile(join(projectDir, `2026-01-01T00-00-00_${id}.jsonl`), JSON.stringify(session(id)) + "\n");
  for (const id of [...COLLIDING, SETTLED]) await write(id);

  const previous = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = agentDir;
  t.after(async () => {
    if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previous;
    await rm(agentDir, { recursive: true, force: true });
  });

  // Every id with that tail comes back, so the caller can refuse instead of picking one.
  assert.deepEqual((await findSessionIdsByShortId("793865c6")).sort(), [...COLLIDING].sort());
  assert.deepEqual(await findSessionIdsByShortId("7938aaaa"), [SETTLED]);
  assert.deepEqual(await findSessionIdsByShortId("00000000"), []);
  // Only the 8-character form is a short id; anything else is not a scan.
  assert.deepEqual(await findSessionIdsByShortId("7938aaa"), []);
});

function sessionFile(id, status, result = "Parser found") {
  return [
    { type: "session", version: 3, id, timestamp: "2026-01-01T00:00:00.000Z", cwd: "/repo" },
    { type: "custom", customType: "pi-web:subagent", parentId: null, data: {
      version: 1,
      parentSessionId: "parent-session",
      parentSessionPath: "/tmp/parent.jsonl",
      parentToolCallId: "tool-call",
      profile: "Explore",
      description: "Inspect parser",
      task: "Find the parser",
      runInBackground: true,
      createdAt: "2026-01-01T00:00:00.000Z",
    } },
    { type: "custom", customType: "pi-web:subagent-result", parentId: null, data: {
      version: 1, status, completedAt: "2026-01-01T00:01:00.000Z", result,
    } },
  ].map((line) => JSON.stringify(line)).join("\n") + "\n";
}

async function controllerFor(t, ids) {
  const dir = await mkdtemp(join(tmpdir(), "pi-web-short-resolve-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const paths = new Map();
  for (const [index, id] of ids.entries()) {
    const file = join(dir, `child-${index}.jsonl`);
    await writeFile(file, sessionFile(id, "completed"));
    paths.set(id, file);
  }
  const scanned = [];
  return {
    scanned,
    controller: createSubagentController({
      getSession: () => undefined,
      registerSession: () => {},
      reopenSession: async () => { throw new Error("unused"); },
      resolveSessionPath: async (id) => paths.get(id) ?? null,
      findSessionIdsByShortId: async (short) => {
        scanned.push(short);
        return ids.filter((id) => shortSessionId(id) === short);
      },
      invalidateSessionList: () => {},
    }),
  };
}

test("an 8-character agent_id resolves to the one subagent whose id ends in it", async (t) => {
  const { controller, scanned } = await controllerFor(t, [LIVE]);

  const run = await controller.get("793865c6");

  assert.equal(run.sessionId, LIVE);
  assert.equal(run.status, "completed");
  assert.deepEqual(scanned, ["793865c6"]);
  // The tools share this resolution, so steer and abort reach the same run.
  assert.equal(await controller.resolveSessionId("793865c6"), LIVE);
  // A full id still passes straight through, without a scan.
  assert.equal(await controller.resolveSessionId(LIVE), LIVE);
  // Anything that is neither form is left alone; its caller answers "not found".
  assert.equal(await controller.resolveSessionId("child-session"), "child-session");
  assert.equal(await controller.get("00000000"), null);
});

test("a short id that matches two subagents is refused, never guessed between", async (t) => {
  const { controller } = await controllerFor(t, COLLIDING);

  await assert.rejects(
    () => controller.get("793865c6"),
    (error) => {
      assert.match(error.message, /matches more than one run/);
      assert.ok(error.message.includes(COLLIDING[1]));
      return true;
    },
  );
  // Ambiguity is refused for the same reason on the shared resolver.
  await assert.rejects(() => controller.resolveSessionId("793865c6"), /matches more than one run/);
});

test("steer and abort reach the run an 8-character id names", async () => {
  const steered = [];
  const aborted = [];
  const entries = [
    { type: "custom", customType: "pi-web:subagent", data: {
      version: 1,
      parentSessionId: "parent-session",
      parentSessionPath: "/tmp/parent.jsonl",
      parentToolCallId: "tool-call",
      profile: "Explore",
      description: "Inspect parser",
      task: "Find the parser",
      runInBackground: false,
      createdAt: "2026-01-01T00:00:00.000Z",
    } },
  ];
  const child = (id, running) => ({
    cwd: tmpdir(),
    sessionFile: `/tmp/${id}.jsonl`,
    inner: {
      sessionManager: { getEntries: () => entries },
      steer: async (message) => { steered.push(message); },
      abort: async () => { aborted.push(id); },
    },
    isAlive: () => true,
    isRunning: () => running,
    waitUntilReady: async () => {},
  });
  const running = child(LIVE, true);
  const settled = child(SETTLED, false);
  const controller = createSubagentController({
    getSession: (id) => id === LIVE ? running : id === SETTLED ? settled : undefined,
    registerSession: () => {},
    reopenSession: async () => { throw new Error("unused"); },
    resolveSessionPath: async () => null,
    findSessionIdsByShortId: async (short) => [LIVE, SETTLED].filter((id) => shortSessionId(id) === short),
    invalidateSessionList: () => {},
  });

  assert.equal((await controller.get("793865c6")).status, "running");
  await controller.steer("793865c6", "Look at lib/parse.ts too");
  await controller.abort("793865c6");
  assert.deepEqual(steered, ["Look at lib/parse.ts too"]);
  assert.deepEqual(aborted, [LIVE]);

  // A refusal names the short form the model is holding, not the full uuid.
  await assert.rejects(
    () => controller.steer("7938aaaa", "again"),
    /Subagent 7938aaaa is not running \(interrupted\)/,
  );
});

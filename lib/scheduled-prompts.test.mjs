import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const {
  ScheduleStorage,
  PromptScheduler,
  validateSchedule,
  parseRelativeTime,
  createScheduledPromptsExtension,
  listActiveScheduledJobs,
  cancelScheduledJob,
  stopAllScheduledPrompts,
  preferPiWebScheduledPromptsExtension,
} = await jiti.import("./scheduled-prompts.ts");
const { hasActiveSessionLivenessProvider } = await jiti.import("./session-liveness.ts");
const { isScheduledPromptsEnabled, writeScheduledPromptsEnabled } = await jiti.import("./scheduled-prompts-settings.ts");

function tempDir() {
  return mkdtempSync(join(tmpdir(), "pi-web-schedule-"));
}

function fakePi() {
  const handlers = new Map();
  const tools = new Map();
  const sent = [];
  return {
    handlers,
    tools,
    sent,
    on(name, handler) { handlers.set(name, handler); },
    registerTool(tool) { tools.set(tool.name, tool); },
    sendMessage(message) { sent.push({ kind: "marker", message }); },
    sendUserMessage(text, options) { sent.push({ kind: "prompt", text, options }); },
  };
}

function context(cwd, sessionId = "s1") {
  return { cwd, sessionManager: { getSessionId: () => sessionId, getEntries: () => [] } };
}

async function run(tool, params, ctx) {
  const result = await tool.execute("call", params, undefined, undefined, ctx);
  return result.content[0].text;
}

test("validateSchedule resolves relative times and rejects bad input", () => {
  const now = Date.parse("2026-01-01T00:00:00Z");
  assert.equal(parseRelativeTime("+5m", now), "2026-01-01T00:05:00.000Z");
  assert.deepEqual(validateSchedule("once", "+10s", now), { ok: true, schedule: "2026-01-01T00:00:10.000Z" });
  assert.equal(validateSchedule("once", "2025-01-01T00:00:00Z", now).ok, false);
  assert.equal(validateSchedule("once", "+2s", now).ok, true);
  assert.equal(validateSchedule("once", "2026-01-01T00:00:02Z", now).ok, false);
  assert.deepEqual(validateSchedule("interval", "5m"), { ok: true, schedule: "5m", intervalMs: 300_000 });
  assert.equal(validateSchedule("interval", "soon").ok, false);
  assert.equal(validateSchedule("cron", "* * * * *").ok, false);
  assert.equal(validateSchedule("cron", "0 * * * * *").ok, true);
  assert.equal(validateSchedule("cron", "99 * * * * *").ok, false);
});

test("an interval job sends a marker and the prompt, then records the run", async () => {
  const cwd = tempDir();
  try {
    const storage = new ScheduleStorage(cwd);
    const pi = fakePi();
    storage.add({ id: "j1", name: "tick", schedule: "1s", prompt: "ping", enabled: true, type: "interval", intervalMs: 20, createdAt: "x", runCount: 0, session: "s1" });
    const scheduler = new PromptScheduler(cwd, "s1", storage, pi);
    scheduler.start();
    await new Promise((resolve) => setTimeout(resolve, 70));
    scheduler.stop();
    const prompts = pi.sent.filter((entry) => entry.kind === "prompt");
    assert.ok(prompts.length >= 2);
    assert.deepEqual(prompts[0].options, { deliverAs: "followUp" });
    assert.equal(prompts[0].text, "ping");
    assert.equal(pi.sent[0].kind, "marker");
    assert.equal(pi.sent[0].message.customType, "scheduled_prompt");
    assert.equal(storage.get("j1").runCount, prompts.length);
    assert.equal(storage.get("j1").lastStatus, "success");
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("a job bound to another session is not fired; an unbound one is", async () => {
  const cwd = tempDir();
  try {
    const storage = new ScheduleStorage(cwd);
    const pi = fakePi();
    const base = { schedule: "1s", prompt: "p", enabled: true, type: "interval", intervalMs: 20, createdAt: "x", runCount: 0 };
    storage.add({ ...base, id: "other", name: "other", session: "s2" });
    storage.add({ ...base, id: "shared", name: "shared" });
    const scheduler = new PromptScheduler(cwd, "s1", storage, pi);
    scheduler.start();
    assert.equal(scheduler.isScheduled("other"), false);
    assert.equal(scheduler.isScheduled("shared"), true);
    scheduler.stop();
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("a one-shot job fires once and disables itself", async () => {
  const cwd = tempDir();
  try {
    const storage = new ScheduleStorage(cwd);
    const pi = fakePi();
    const scheduler = new PromptScheduler(cwd, "s1", storage, pi);
    const job = { id: "o", name: "once", schedule: new Date(Date.now() + 30).toISOString(), prompt: "p", enabled: true, type: "once", createdAt: "x", runCount: 0 };
    storage.add(job);
    scheduler.add(job);
    await new Promise((resolve) => setTimeout(resolve, 90));
    assert.equal(pi.sent.filter((entry) => entry.kind === "prompt").length, 1);
    assert.equal(storage.get("o").enabled, false);
    scheduler.stop();
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("the tool adds, lists, and removes jobs; Settings can list and cancel them", async () => {
  const cwd = tempDir();
  const pi = fakePi();
  try {
    await createScheduledPromptsExtension(() => true).factory(pi);
    const ctx = context(cwd);
    pi.handlers.get("session_start")({}, ctx);
    const tool = pi.tools.get("schedule_prompt");

    assert.match(await run(tool, { action: "add", name: "daily", schedule: "0 0 9 * * *", prompt: "report" }, ctx), /Created/);
    assert.match(await run(tool, { action: "add", name: "daily", schedule: "0 0 9 * * *", prompt: "again" }, ctx), /already exists/);
    assert.match(await run(tool, { action: "add", schedule: "0 0 9 * * *" }, ctx), /Missing required/);

    const active = listActiveScheduledJobs().filter((job) => job.cwd === cwd);
    assert.equal(active.length, 1);
    assert.equal(active[0].name, "daily");
    assert.equal(active[0].boundToSession, true);
    assert.ok(active[0].nextRun);
    assert.equal(hasActiveSessionLivenessProvider({ sessionId: "s1" }), true);

    assert.equal(cancelScheduledJob(cwd, active[0].id), true);
    assert.equal(listActiveScheduledJobs().filter((job) => job.cwd === cwd).length, 0);
    assert.equal(new ScheduleStorage(cwd).all().length, 0);
    assert.equal(hasActiveSessionLivenessProvider({ sessionId: "s1" }), false);
    assert.match(await run(tool, { action: "list" }, ctx), /No scheduled prompts/);

    pi.handlers.get("session_shutdown")();
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("workdir scope leaves the job unbound", async () => {
  const cwd = tempDir();
  const pi = fakePi();
  try {
    await createScheduledPromptsExtension().factory(pi);
    const ctx = context(cwd);
    pi.handlers.get("session_start")({}, ctx);
    await run(pi.tools.get("schedule_prompt"), { action: "add", schedule: "5m", type: "interval", prompt: "p", scope: "workdir" }, ctx);
    assert.equal(new ScheduleStorage(cwd).all()[0].session, undefined);
    pi.handlers.get("session_shutdown")();
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("a fired prompt cannot schedule more prompts", async () => {
  const cwd = tempDir();
  const pi = fakePi();
  try {
    await createScheduledPromptsExtension().factory(pi);
    const ctx = context(cwd);
    ctx.sessionManager.getEntries = () => [{ type: "custom_message", customType: "scheduled_prompt" }];
    pi.handlers.get("session_start")({}, ctx);
    assert.match(await run(pi.tools.get("schedule_prompt"), { action: "add", schedule: "5m", type: "interval", prompt: "p" }, ctx), /infinite loops/);
    pi.handlers.get("session_shutdown")();
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("a disabled feature registers no tool, and stopAll ends live timers", async () => {
  const off = fakePi();
  await createScheduledPromptsExtension(() => false).factory(off);
  assert.equal(off.tools.size, 0);

  const cwd = tempDir();
  const pi = fakePi();
  try {
    await createScheduledPromptsExtension().factory(pi);
    const ctx = context(cwd, "s9");
    pi.handlers.get("session_start")({}, ctx);
    await run(pi.tools.get("schedule_prompt"), { action: "add", schedule: "5m", type: "interval", prompt: "p" }, ctx);
    assert.equal(listActiveScheduledJobs().filter((job) => job.cwd === cwd).length, 1);
    stopAllScheduledPrompts();
    assert.equal(listActiveScheduledJobs().filter((job) => job.cwd === cwd).length, 0);
    assert.equal(JSON.parse(readFileSync(join(cwd, ".pi", "schedule-prompts.json"), "utf8")).jobs.length, 1);
    pi.handlers.get("session_shutdown")();
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("the enabled setting defaults on, persists, and fails closed when damaged", () => {
  const dir = tempDir();
  try {
    const path = join(dir, "scheduled-prompts", "settings.json");
    assert.equal(isScheduledPromptsEnabled(path), true);
    writeScheduledPromptsEnabled(false, path);
    assert.equal(isScheduledPromptsEnabled(path), false);
    writeScheduledPromptsEnabled(true, path);
    assert.equal(isScheduledPromptsEnabled(path), true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the legacy pi-schedule-prompt extension yields to the integrated one", () => {
  const host = { path: "<inline:pi-web-scheduled-prompts>", tools: new Map([["schedule_prompt", {}]]) };
  const legacy = { path: "/x/node_modules/pi-schedule-prompt/dist/index.js", sourceInfo: { source: "npm:pi-schedule-prompt" }, tools: new Map([["schedule_prompt", {}]]) };
  const other = { path: "/x/other.js", tools: new Map() };
  const base = {
    extensions: [host, legacy, other],
    errors: [{ path: host.path, error: `Tool "schedule_prompt" conflicts with ${legacy.path}` }],
  };
  const result = preferPiWebScheduledPromptsExtension(base);
  assert.deepEqual(result.extensions, [host, other]);
  assert.deepEqual(result.errors, []);
  assert.equal(preferPiWebScheduledPromptsExtension({ extensions: [legacy], errors: [] }).extensions.length, 1);
});

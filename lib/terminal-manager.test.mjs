import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";

const jiti = createJiti(import.meta.url, { alias: { "@": fileURLToPath(new URL("../", import.meta.url)) } });
const { createTerminal, getTerminalCwd, hasTerminal, killTerminal, subscribeTerminal, TERMINAL_RECONNECT_MS } = await jiti.import("./terminal-manager.ts");
const { GET } = await jiti.import("../app/api/terminal/[id]/events/route.ts");

test("native module load failures are deferred until creation and include repair instructions", async () => {
  const require = createRequire(import.meta.url);
  const paths = await jiti.import("./paths.ts");
  const source = readFileSync(new URL("./terminal-manager.ts", import.meta.url), "utf8");
  const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } });
  const exports = {};
  runInNewContext(outputText, { exports, process, require(id) {
    if (id === "node-pty") throw new Error("Cannot find module pty.node");
    return id === "./paths" ? paths : require(id);
  } });
  assert.equal(exports.hasTerminal("missing"), false);
  assert.throws(() => exports.createTerminal(process.cwd(), 80, 24), (error) => {
    assert.match(error.message, /native terminal module/);
    assert.match(error.message, /npm rebuild node-pty --build-from-source --ignore-scripts=false --foreground-scripts/);
    assert.match(error.message, /Cannot find module pty.node/);
    return true;
  });
});

test("native PTY starts after install and repeated creation reuses the same workspace process", (t) => {
  const id = createTerminal(process.cwd(), 80, 24);
  t.after(() => killTerminal(id));
  const record = globalThis.__piWebTerminals.get(id);
  assert.ok(record.pty.pid > 0);
  assert.equal(getTerminalCwd(id), process.cwd());
  assert.equal(createTerminal(process.cwd(), 100, 30, id), id);
  assert.strictEqual(globalThis.__piWebTerminals.get(id), record);
  assert.throws(() => createTerminal(process.cwd() + "/other", 80, 24, id), /different workspace/);
  assert.ok(record.cleanupTimer, "unclaimed creations have a lease");
});

test("connected terminals outlive the grace period; only the last disconnect starts expiry", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const id = createTerminal(process.cwd(), 80, 24);
  t.after(() => killTerminal(id));
  const first = subscribeTerminal(id, () => {});
  const second = subscribeTerminal(id, () => {});
  first.unsubscribe();
  t.mock.timers.tick(TERMINAL_RECONNECT_MS * 2);
  assert.ok(hasTerminal(id));
  second.unsubscribe();
  t.mock.timers.tick(TERMINAL_RECONNECT_MS - 1);
  assert.ok(hasTerminal(id));
  const resumed = subscribeTerminal(id, () => {});
  t.mock.timers.tick(TERMINAL_RECONNECT_MS);
  assert.ok(hasTerminal(id));
  resumed.unsubscribe();
  t.mock.timers.tick(TERMINAL_RECONNECT_MS);
  assert.equal(hasTerminal(id), false);
});

test("unclaimed creations expire without requiring a browser cleanup request", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const id = createTerminal(process.cwd(), 80, 24);
  t.after(() => killTerminal(id));
  t.mock.timers.tick(TERMINAL_RECONNECT_MS);
  assert.equal(hasTerminal(id), false);
});

test("SSE resumes from Last-Event-ID and cancellation releases the connection lease", async (t) => {
  const id = createTerminal(process.cwd(), 80, 24);
  t.after(() => killTerminal(id));
  const record = globalThis.__piWebTerminals.get(id);
  record.backlog = "old\r\nnew\r\n";
  record.offset = record.backlog.length;
  const request = new Request("http://localhost/events?after=0", { headers: { "Last-Event-ID": "5" } });
  const response = await GET(request, { params: Promise.resolve({ id }) });
  const reader = response.body.getReader();
  await reader.read();
  const replay = new TextDecoder().decode((await reader.read()).value);
  assert.match(replay, /id: 10\n/);
  assert.deepEqual(JSON.parse(replay.split("data: ")[1]), { type: "output", data: "new\r\n", offset: 10, reset: false });
  await reader.cancel();
  assert.equal(record.listeners.size, 0);
  assert.ok(record.cleanupTimer);
});

test("expired output cursors reset bounded history, while explicit close ends connected streams", async (t) => {
  const id = createTerminal(process.cwd(), 80, 24);
  t.after(() => killTerminal(id));
  const record = globalThis.__piWebTerminals.get(id);
  record.backlog = "tail";
  record.offset = 100;
  const subscription = subscribeTerminal(id, () => {}, 10);
  assert.deepEqual(subscription.output, { type: "output", data: "tail", offset: 100, reset: true });
  subscription.unsubscribe();
  const response = await GET(new Request("http://localhost/events"), { params: Promise.resolve({ id }) });
  const reader = response.body.getReader();
  await reader.read();
  await reader.read();
  killTerminal(id);
  assert.match(new TextDecoder().decode((await reader.read()).value), /"type":"closed"/);
  assert.equal((await reader.read()).done, true);
  assert.equal(record.listeners.size, 0);
  assert.equal(hasTerminal(id), false);
});

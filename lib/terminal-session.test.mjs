import assert from "node:assert/strict";
import test from "node:test";

async function loadSubject() {
  return import("./terminal-session.ts");
}

/** Stands in for node-pty: records what the terminal pushes at the process. */
function fakePty() {
  const pty = {
    written: [],
    resized: [],
    killed: 0,
    emitData: null,
    emitExit: null,
    onData(handler) { pty.emitData = handler; },
    onExit(handler) { pty.emitExit = handler; },
    write(data) { pty.written.push(data); },
    resize(columns, rows) { pty.resized.push([columns, rows]); },
    kill() { pty.killed += 1; },
  };
  return pty;
}

function makeTerminal(ManagedTerminal) {
  const pty = fakePty();
  const closed = [];
  const terminal = new ManagedTerminal(
    pty,
    { terminalId: "t1", sessionId: "s1", cwd: "/tmp", columns: 80, rows: 24 },
    () => closed.push(true),
  );
  return { pty, terminal, closed };
}

/** Collects everything delivered to a subscriber. */
function collect(terminal, afterSequence = 0) {
  const events = [];
  const unsubscribe = terminal.subscribe(afterSequence, (event) => events.push(event));
  return { events, unsubscribe };
}

test("output reaches live subscribers and replays for late ones", async () => {
  const { ManagedTerminal } = await loadSubject();
  const { pty, terminal } = makeTerminal(ManagedTerminal);

  const live = collect(terminal);
  pty.emitData("first");
  pty.emitData("second");

  assert.deepEqual(live.events.map((e) => e.data), ["first", "second"]);
  assert.deepEqual(live.events.map((e) => e.seq), [1, 2]);

  const late = collect(terminal);
  assert.deepEqual(late.events.map((e) => e.data), ["first", "second"]);

  const resumed = collect(terminal, 1);
  assert.deepEqual(resumed.events.map((e) => e.data), ["second"]);

  live.unsubscribe();
  late.unsubscribe();
  resumed.unsubscribe();
  terminal.close();
});

test("a subscriber that missed evicted output is told to reset first", async () => {
  const { ManagedTerminal } = await loadSubject();
  const { pty, terminal } = makeTerminal(ManagedTerminal);

  // Overflow the 1 MiB replay buffer so the earliest frames are evicted.
  const chunk = "x".repeat(256 * 1024);
  for (let i = 0; i < 6; i += 1) pty.emitData(chunk);

  const stale = collect(terminal, 1);
  assert.equal(stale.events[0].type, "reset", "a gap must be announced before the replay");
  assert.ok(stale.events.length > 1, "the surviving frames still follow the reset");
  assert.ok(stale.events.slice(1).every((e) => e.type === "output"));

  // A subscriber that is already past the eviction point sees no reset.
  const current = collect(terminal, 6);
  assert.deepEqual(current.events, []);

  stale.unsubscribe();
  current.unsubscribe();
  terminal.close();
});

test("the replay buffer stays bounded", async () => {
  const { ManagedTerminal } = await loadSubject();
  const { pty, terminal } = makeTerminal(ManagedTerminal);

  const chunk = "y".repeat(256 * 1024);
  for (let i = 0; i < 20; i += 1) pty.emitData(chunk);

  const { events, unsubscribe } = collect(terminal);
  const replayed = events
    .filter((e) => e.type === "output")
    .reduce((total, e) => total + Buffer.byteLength(e.data, "utf8"), 0);
  assert.ok(replayed <= 1_048_576, `replay held ${replayed} bytes`);

  unsubscribe();
  terminal.close();
});

test("oversized output is trimmed without splitting a multi-byte character", async () => {
  const { utf8Tail } = await loadSubject();

  // "€" is three bytes; cutting at a byte offset inside it must not produce
  // a replacement character.
  const text = "€".repeat(10);
  const trimmed = utf8Tail(text, 10);
  assert.ok(!trimmed.includes("�"), "trimmed text must stay well-formed");
  assert.ok(Buffer.byteLength(trimmed, "utf8") <= 10);
  assert.equal(trimmed, "€€€");
  assert.equal(utf8Tail("short", 100), "short");
});

test("input is forwarded and capped, resizes are validated", async () => {
  const { ManagedTerminal, MAX_INPUT_BYTES } = await loadSubject();
  const { pty, terminal } = makeTerminal(ManagedTerminal);

  terminal.write("ls\r");
  assert.deepEqual(pty.written, ["ls\r"]);
  assert.throws(() => terminal.write("z".repeat(MAX_INPUT_BYTES + 1)), /too large/);

  terminal.resize(120, 40);
  assert.deepEqual(pty.resized, [[120, 40]]);
  assert.equal(terminal.descriptor.columns, 120);
  assert.throws(() => terminal.resize(1, 40), /columns/);
  assert.throws(() => terminal.resize(80, 0), /rows/);
  assert.throws(() => terminal.resize(80.5, 40), /columns/);

  terminal.close();
});

test("a process exit is published once and reported to the registry", async () => {
  const { ManagedTerminal } = await loadSubject();
  const { pty, terminal, closed } = makeTerminal(ManagedTerminal);
  const { events } = collect(terminal);

  pty.emitExit({ exitCode: 3, signal: 0 });

  assert.deepEqual(events, [{ seq: 1, type: "exit", exitCode: 3 }]);
  assert.equal(terminal.isAlive(), false);
  assert.equal(closed.length, 1);

  // Closing an already-dead terminal is a no-op, and never kills twice.
  terminal.close();
  assert.equal(events.length, 1);
  assert.equal(closed.length, 1);
  assert.equal(pty.killed, 0);

  assert.throws(() => terminal.write("x"), /exited/);
  assert.throws(() => terminal.resize(80, 24), /exited/);
});

test("an explicit close kills the process and marks the reason", async () => {
  const { ManagedTerminal } = await loadSubject();
  const { pty, terminal } = makeTerminal(ManagedTerminal);
  const { events } = collect(terminal);

  terminal.close("detached");

  assert.equal(pty.killed, 1);
  assert.deepEqual(events, [{ seq: 1, type: "exit", exitCode: 0, signal: 15, reason: "detached" }]);
});

test("a terminal survives while attached and is reaped once nobody is watching", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { ManagedTerminal, DETACHED_TIMEOUT_MS } = await loadSubject();
  const { pty, terminal } = makeTerminal(ManagedTerminal);

  // Constructed with no viewer: the reaper is already armed.
  const { unsubscribe } = collect(terminal);
  t.mock.timers.tick(DETACHED_TIMEOUT_MS * 2);
  assert.equal(terminal.isAlive(), true, "an attached terminal is never reaped, however quiet");

  unsubscribe();
  t.mock.timers.tick(DETACHED_TIMEOUT_MS - 1);
  assert.equal(terminal.isAlive(), true, "a backgrounded tab keeps its shell for a while");

  t.mock.timers.tick(2);
  assert.equal(terminal.isAlive(), false);
  assert.equal(pty.killed, 1);
});

test("reattaching before the deadline cancels the reaper", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { ManagedTerminal, DETACHED_TIMEOUT_MS } = await loadSubject();
  const { terminal } = makeTerminal(ManagedTerminal);

  const first = collect(terminal);
  first.unsubscribe();
  t.mock.timers.tick(DETACHED_TIMEOUT_MS - 1000);

  const second = collect(terminal);
  t.mock.timers.tick(DETACHED_TIMEOUT_MS * 2);
  assert.equal(terminal.isAlive(), true);

  second.unsubscribe();
  terminal.close();
});

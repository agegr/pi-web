import assert from "node:assert/strict";
import fs from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const {
  SessionUiStateLockedError,
  forgetSessionUiState,
  getSessionUiStatePath,
  getSessionUiStateRevision,
  readSessionUiState,
  resetSessionUiStateCacheForTests,
  updateSessionUiState,
} = await jiti.import("./session-ui-state.ts");

const source = fs.readFileSync(new URL("./session-ui-state.ts", import.meta.url), "utf8");

function fixture(t) {
  const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
  const root = fs.mkdtempSync(join(tmpdir(), "pi-web-session-ui-state-"));
  const agentDir = join(root, "agent");
  process.env.PI_CODING_AGENT_DIR = agentDir;
  resetSessionUiStateCacheForTests();
  t.after(() => {
    resetSessionUiStateCacheForTests();
    if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
    fs.rmSync(root, { recursive: true, force: true });
  });
  const path = join(agentDir, "pi-web-session-state.json");
  return {
    agentDir,
    path,
    readFile: () => JSON.parse(fs.readFileSync(path, "utf8")),
    write: (value) => {
      fs.mkdirSync(agentDir, { recursive: true });
      fs.writeFileSync(path, typeof value === "string" ? value : JSON.stringify(value));
    },
  };
}

function quietWarnings(t) {
  const warnings = [];
  const previous = console.warn;
  console.warn = (...args) => warnings.push(args.join(" "));
  t.after(() => {
    console.warn = previous;
  });
  return warnings;
}

test("the path follows the agent dir at call time", (t) => {
  const { agentDir, path } = fixture(t);
  assert.equal(getSessionUiStatePath(), path);
  assert.equal(getSessionUiStatePath("/x"), join("/x", "pi-web-session-state.json"));
  assert.ok(path.startsWith(agentDir));
});

test("a missing file reads as empty without creating anything", (t) => {
  const { agentDir } = fixture(t);
  assert.deepEqual(readSessionUiState(), { version: 1, revision: 0, sessions: {}, projects: {} });
  assert.equal(getSessionUiStateRevision(), 0);
  assert.equal(fs.existsSync(agentDir), false);
});

test("updates write a private file, bump the revision only on change, and keep unknown fields", async (t) => {
  const { path, readFile, write } = fixture(t);
  write({ version: 1, revision: 4, futureField: { a: 1 }, sessions: { old: { archivedAt: 1 } }, projects: {} });
  assert.equal(getSessionUiStateRevision(), 4);

  const pinned = await updateSessionUiState({ action: "set", ids: ["s1"], pinned: true });
  assert.equal(pinned.revision, 5);
  assert.equal(typeof pinned.sessions.s1.pinnedAt, "number");
  if (process.platform !== "win32") assert.equal(fs.statSync(path).mode & 0o777, 0o600);
  const stored = readFile();
  assert.deepEqual(stored.futureField, { a: 1 });
  assert.equal(stored.revision, 5);
  assert.deepEqual(stored.sessions.old, { archivedAt: 1 });
  assert.ok(fs.readFileSync(path, "utf8").endsWith("}\n"));
  assert.equal(getSessionUiStateRevision(), 5);

  const mtime = fs.statSync(path).mtimeMs;
  const same = await updateSessionUiState({ action: "set", ids: ["s1"], pinned: true });
  assert.equal(same.revision, 5);
  assert.equal(same.sessions.s1.pinnedAt, pinned.sessions.s1.pinnedAt);
  assert.equal(fs.statSync(path).mtimeMs, mtime, "no write without a change");
  assert.deepEqual(readSessionUiState(), same);
});

test("reads are copies: changing one never reaches the cache", async (t) => {
  fixture(t);
  await updateSessionUiState({ action: "set", ids: ["s1"], archived: true });
  const first = readSessionUiState();
  first.sessions.s1.archivedAt = 0;
  first.sessions.extra = { pinnedAt: 1 };
  const second = readSessionUiState();
  assert.notEqual(second.sessions.s1.archivedAt, 0);
  assert.equal(second.sessions.extra, undefined);
});

test("the revision tracks writes by another process", (t) => {
  const { write, path } = fixture(t);
  write({ version: 1, revision: 1, sessions: {}, projects: {} });
  assert.equal(getSessionUiStateRevision(), 1);
  // Same size and possibly the same mtime: the replace still gives a new inode.
  const temp = `${path}.tmp-test`;
  fs.writeFileSync(temp, JSON.stringify({ version: 1, revision: 2, sessions: {}, projects: {} }));
  fs.renameSync(temp, path);
  assert.equal(getSessionUiStateRevision(), 2);
  fs.rmSync(path);
  assert.equal(getSessionUiStateRevision(), 0);
});

test("a corrupt file reads as empty and is set aside, not overwritten, on the next write", async (t) => {
  const { agentDir, path, readFile, write } = fixture(t);
  const warnings = quietWarnings(t);
  write({ version: 1, revision: 8, sessions: { a: { pinnedAt: 1 } }, projects: {} });
  assert.equal(getSessionUiStateRevision(), 8);
  write("{ not json");
  assert.deepEqual(readSessionUiState().sessions, {});
  assert.equal(getSessionUiStateRevision(), 0);
  assert.equal(fs.readFileSync(path, "utf8"), "{ not json", "reads never rewrite");

  const next = await updateSessionUiState({ action: "set", ids: ["b"], archived: true });
  assert.deepEqual(Object.keys(next.sessions), ["b"]);
  assert.equal(next.revision, 10, "last seen revision + 1 for the reset, + 1 for the change");
  assert.equal(readFile().revision, 10);
  const backups = fs.readdirSync(agentDir).filter((name) => name.startsWith("pi-web-session-state.json.corrupt-"));
  assert.equal(backups.length, 1);
  assert.equal(fs.readFileSync(join(agentDir, backups[0]), "utf8"), "{ not json");
  assert.ok(warnings.some((line) => line.includes(backups[0])));
});

test("a file of another shape is set aside even when the change itself is a no-op", async (t) => {
  const { agentDir, readFile, write } = fixture(t);
  quietWarnings(t);
  write({ version: 2, revision: 3, sessions: {} });
  const next = await updateSessionUiState({ action: "set", ids: ["x"], pinned: false });
  assert.equal(next.revision, 1);
  assert.deepEqual(readFile(), { version: 1, revision: 1, sessions: {}, projects: {} });
  assert.equal(fs.readdirSync(agentDir).filter((name) => name.includes(".corrupt-")).length, 1);
});

test("the project order survives a round trip, once, and is not written while empty", async (t) => {
  const { readFile, write } = fixture(t);
  await updateSessionUiState({ action: "set", ids: ["s1"], pinned: true });
  assert.equal("projectOrder" in readFile(), false, "no empty field in the file");

  const added = await updateSessionUiState({ action: "add-projects", keys: ["/b", "/a"] });
  assert.deepEqual(added.projectOrder, ["/b", "/a"]);
  assert.deepEqual(readFile().projectOrder, ["/b", "/a"]);
  const moved = await updateSessionUiState({ action: "move-project", projectKey: "/a", anchorKey: "/b", position: "before", add: [] });
  assert.equal(moved.revision, added.revision + 1);
  assert.deepEqual(readSessionUiState().projectOrder, ["/a", "/b"]);
  const same = await updateSessionUiState({ action: "add-projects", keys: ["/a"] });
  assert.equal(same.revision, moved.revision, "adding a key it has is no write");

  // A known field: never kept a second time as an unknown one for a newer build.
  write({ ...readFile(), futureField: 1 });
  await updateSessionUiState({ action: "set", ids: ["s2"], pinned: true });
  const text = fs.readFileSync(getSessionUiStatePath(), "utf8");
  assert.equal(text.match(/"projectOrder"/g).length, 1);
  assert.equal(readFile().futureField, 1);
});

test("a malformed project order reads as none without setting the file aside", async (t) => {
  const { agentDir, readFile, write } = fixture(t);
  const warnings = quietWarnings(t);
  write({ version: 1, revision: 2, sessions: { a: { pinnedAt: 1 } }, projects: {}, projectOrder: "not a list" });
  const read = readSessionUiState();
  assert.deepEqual(read.sessions, { a: { pinnedAt: 1 } });
  assert.equal("projectOrder" in read, false);
  const next = await updateSessionUiState({ action: "add-projects", keys: ["/p"] });
  assert.equal(next.revision, 3);
  assert.deepEqual(readFile().projectOrder, ["/p"]);
  assert.deepEqual(readFile().sessions, { a: { pinnedAt: 1 } }, "pins kept");
  assert.equal(fs.readdirSync(agentDir).filter((name) => name.includes(".corrupt-")).length, 0);
  assert.deepEqual(warnings, []);
});

test("project names survive a round trip, once, and are not written while empty", async (t) => {
  const { agentDir, readFile, write } = fixture(t);
  const warnings = quietWarnings(t);
  // A file from before names existed loads as it was.
  const old = { version: 1, revision: 3, sessions: { a: { pinnedAt: 1 } }, projects: { "/p": { pinnedAt: 2, root: "/p" } }, projectOrder: ["/p"] };
  write(old);
  assert.deepEqual(readSessionUiState(), old);

  const named = await updateSessionUiState({ action: "rename-project", projectKey: "/p", name: "Thermal Models" });
  assert.equal(named.revision, 4);
  assert.deepEqual(readFile(), { ...old, revision: 4, projectNames: { "/p": "Thermal Models" } }, "pins and order untouched");
  const same = await updateSessionUiState({ action: "rename-project", projectKey: "/p", name: "Thermal Models" });
  assert.equal(same.revision, 4, "the same name is no write");

  // A known field: never kept a second time as an unknown one for a newer build.
  write({ ...readFile(), futureField: 1 });
  await updateSessionUiState({ action: "rename-project", projectKey: "/q", name: "热模型" });
  const text = fs.readFileSync(getSessionUiStatePath(), "utf8");
  assert.equal(text.match(/"projectNames"/g).length, 1);
  assert.deepEqual(readFile().projectNames, { "/p": "Thermal Models", "/q": "热模型" });
  assert.equal(readFile().futureField, 1);

  await updateSessionUiState({ action: "rename-project", projectKey: "/p", name: null });
  await updateSessionUiState({ action: "rename-project", projectKey: "/q", name: null });
  assert.equal("projectNames" in readFile(), false, "no empty field in the file");
  assert.deepEqual(readFile().projects, old.projects);

  // Malformed names read as none, and are no reason to set the file aside.
  write({ ...readFile(), projectNames: ["not", "a", "map"] });
  assert.equal("projectNames" in readSessionUiState(), false);
  const next = await updateSessionUiState({ action: "rename-project", projectKey: "/p", name: "P" });
  assert.deepEqual(readFile().projectNames, { "/p": "P" });
  assert.deepEqual(next.sessions, old.sessions);
  assert.equal(fs.readdirSync(agentDir).filter((name) => name.includes(".corrupt-")).length, 0);
  assert.deepEqual(warnings, []);
});

test("a removed file restarts from the last revision seen", async (t) => {
  const { path } = fixture(t);
  await updateSessionUiState({ action: "set", ids: ["a"], pinned: true });
  await updateSessionUiState({ action: "set", ids: ["b"], pinned: true });
  fs.rmSync(path);
  const next = await updateSessionUiState({ action: "set", ids: ["c"], pinned: true });
  assert.equal(next.revision, 3);
  assert.deepEqual(Object.keys(next.sessions), ["c"]);
});

test("writes from one process are applied in order", async (t) => {
  fixture(t);
  const results = await Promise.all([
    updateSessionUiState({ action: "set", ids: ["a"], archived: true }),
    updateSessionUiState({ action: "restore", entries: [{ id: "a", pinnedAt: null, archivedAt: null }] }),
    updateSessionUiState({ action: "set", ids: ["b"], pinned: true }),
    updateSessionUiState({ action: "pin-project", projectKey: "/p", root: "/p", pinned: true }),
  ]);
  assert.deepEqual(results.map((state) => state.revision), [1, 2, 3, 4]);
  const final = readSessionUiState();
  assert.equal(final.sessions.a, undefined);
  assert.equal(typeof final.sessions.b.pinnedAt, "number");
  assert.equal(final.projects["/p"].root, "/p");
});

test("a lock held by another process is reported as locked", async (t) => {
  const { agentDir, path } = fixture(t);
  fs.mkdirSync(agentDir, { recursive: true });
  fs.mkdirSync(`${path}.lock`);
  await assert.rejects(
    updateSessionUiState({ action: "set", ids: ["a"], pinned: true }),
    (error) => error instanceof SessionUiStateLockedError,
  );
  assert.equal(fs.existsSync(path), false);
  fs.rmdirSync(`${path}.lock`);
  assert.equal((await updateSessionUiState({ action: "set", ids: ["a"], pinned: true })).revision, 1);
});

test("forget removes the given sessions and skips the lock when none is present", async (t) => {
  const { agentDir, path, readFile } = fixture(t);
  await forgetSessionUiState(["a"]);
  assert.equal(fs.existsSync(agentDir), false, "nothing created for a session without state");

  await updateSessionUiState({ action: "set", ids: ["a", "b", "c"], archived: true });
  const mtime = fs.statSync(path).mtimeMs;
  // A held lock proves the no-op path never takes it.
  fs.mkdirSync(`${path}.lock`);
  await forgetSessionUiState(["zzz", "yyy"]);
  fs.rmdirSync(`${path}.lock`);
  assert.equal(fs.statSync(path).mtimeMs, mtime);

  await forgetSessionUiState(new Set(["a", "c", "zzz"]));
  assert.deepEqual(Object.keys(readFile().sessions), ["b"]);
  assert.equal(readFile().revision, 2);
});

test("lock options never use proper-lockfile's crashing default", () => {
  assert.match(source, /onCompromised: \(error: Error\) => \{\s*console\.warn/);
  assert.match(source, /realpath: false/);
  assert.match(source, /Symbol\.for\("pi-web:session-ui-state-write-queue"\)/);
  assert.match(source, /readRegularFileText\(path, MAX_BYTES\)/);
});

import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { interopDefault: true, moduleCache: false });
const {
  hasSideMetadata,
  readSideRelation,
  SIDE_BOUNDARY_TEXT,
  SIDE_META_TYPE,
  sideOwnEntries,
  sideToolNames,
} = await jiti.import("./side-session.ts");
const { SUBAGENT_META_TYPE } = await jiti.import("./subagents.ts");
const { createSideSession, forkSessionBranch, SessionForkError } = await jiti.import("./session-fork.ts");
const { SessionManager } = await jiti.import("@earendil-works/pi-coding-agent");
const { listSessionFamilies, getSessionFamily, SIDE_BOUNDARY_MESSAGE_TYPE, SIDE_SESSION_NAME, sideChatNameFrom, sideChatNameFromText, sideChatTitle } = await jiti.import("./session-family.ts");

/** A scratch agent dir and session dir: nothing here may reach the real ~/.pi. */
function scratch() {
  const root = mkdtempSync(join(tmpdir(), "pi-web-side-session-"));
  const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
  const previousHome = process.env.HOME;
  const previousUserProfile = process.env.USERPROFILE;
  process.env.PI_CODING_AGENT_DIR = join(root, "agent");
  process.env.HOME = join(root, "home");
  process.env.USERPROFILE = join(root, "home");
  return {
    cwd: join(root, "project"),
    sessionDir: join(root, "sessions"),
    restore() {
      if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
      else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
      if (previousHome === undefined) delete process.env.HOME;
      else process.env.HOME = previousHome;
      if (previousUserProfile === undefined) delete process.env.USERPROFILE;
      else process.env.USERPROFILE = previousUserProfile;
      rmSync(root, { recursive: true, force: true });
    },
  };
}

const user = (text) => ({ role: "user", content: text, timestamp: Date.now() });
const assistant = (text) => ({ role: "assistant", content: [{ type: "text", text }], timestamp: Date.now() });

function lines(path) {
  return readFileSync(path, "utf8").trim().split("\n").map((line) => JSON.parse(line));
}

function refusal(code) {
  return (error) => error instanceof SessionForkError && error.code === code;
}

/** u1 → a1, then back to u1 → a2: the file's leaf (its last entry) is a2. */
function branchedSession({ cwd, sessionDir }) {
  const manager = SessionManager.create(cwd, sessionDir);
  const u1 = manager.appendMessage(user("question"));
  manager.appendMessage(assistant("first answer"));
  manager.branch(u1);
  manager.appendMessage(assistant("second answer"));
  return { manager, path: manager.getSessionFile() };
}

test("forks the branch into a side session stamped with side metadata", () => {
  const dirs = scratch();
  try {
    const source = branchedSession(dirs);
    const before = readFileSync(source.path, "utf8");

    const side = createSideSession(source.path);

    assert.notEqual(side.sessionId, source.manager.getSessionId());
    assert.ok(existsSync(side.path));
    assert.equal(dirname(side.path), dirname(source.path));
    assert.equal(readFileSync(source.path, "utf8"), before, "the source is untouched");

    const [header, meta, ...entries] = lines(side.path);
    assert.equal(header.type, "session");
    assert.equal(header.id, side.sessionId);
    assert.equal(header.parentSession, source.path);
    // The metadata sits directly after the header, inside the bounded head
    // read the session list uses, so no tail read is needed to find it.
    assert.equal(meta.type, "custom");
    assert.equal(meta.customType, SIDE_META_TYPE);
    assert.equal(meta.data.version, 1);
    assert.equal(meta.data.parentSessionId, source.manager.getSessionId());
    // The inherited history ends on the hidden boundary: pi's leaf, in the file's one chain.
    const boundary = entries.at(-1);
    assert.equal(boundary.type, "custom_message");
    assert.equal(boundary.customType, SIDE_BOUNDARY_MESSAGE_TYPE);
    assert.equal(boundary.content, SIDE_BOUNDARY_TEXT);
    assert.equal(boundary.display, false);
    assert.equal(boundary.parentId, entries.at(-2).id);
    assert.equal(SessionManager.open(side.path).getLeafId(), boundary.id);
    const context = SessionManager.open(side.path).buildSessionContext();
    assert.equal(context.messages.at(-1).customType, SIDE_BOUNDARY_MESSAGE_TYPE);
    assert.equal(context.messages.at(-1).display, false);
    // The copied entries form one parent chain under the metadata entry.
    assert.equal(entries[0].parentId, meta.id);
    const messages = entries.filter((entry) => entry.type === "message");
    assert.deepEqual(messages.map((entry) => (
      typeof entry.message.content === "string" ? entry.message.content : entry.message.content[0].text
    )), ["question", "second answer"]);
    // The name the switcher row and tab show.
    assert.equal(SessionManager.open(side.path).getSessionName(), SIDE_SESSION_NAME);
  } finally {
    dirs.restore();
  }
});

test("the side metadata is found by the list scan's bounded head read", () => {
  const dirs = scratch();
  try {
    const source = branchedSession(dirs);
    const side = createSideSession(source.path);
    // Exactly what readSessionRelationEntries() reads: the first two lines
    // after the header, bounded, without a tail read.
    const head = lines(side.path).slice(1, 3);
    const relation = readSideRelation(head);
    assert.equal(relation?.parentSessionId, source.manager.getSessionId());
    assert.ok(hasSideMetadata(head));
  } finally {
    dirs.restore();
  }
});

test("a live wrapper's leaf picks the branch the side chat inherits", () => {
  const dirs = scratch();
  try {
    const manager = SessionManager.create(dirs.cwd, dirs.sessionDir);
    const u1 = manager.appendMessage(user("question"));
    manager.appendMessage(assistant("first answer"));
    manager.branch(u1);
    manager.appendMessage(assistant("second answer"));
    // The branch ending at the first answer: u1 → a1.
    const a1 = manager.getEntries().find((entry) => entry.type === "message" && entry.message.role === "assistant");
    const sourcePath = manager.getSessionFile();

    const side = createSideSession(sourcePath, a1.id);
    const messages = lines(side.path).filter((entry) => entry.type === "message");
    assert.deepEqual(messages.map((entry) => (
      typeof entry.message.content === "string" ? entry.message.content : entry.message.content[0].text
    )), ["question", "first answer"]);
  } finally {
    dirs.restore();
  }
});

test("a side chat can start with a name, which its first prompt then leaves alone", () => {
  const dirs = scratch();
  try {
    const source = branchedSession(dirs);
    const side = createSideSession(source.path, undefined, "the selected text");
    assert.equal(SessionManager.open(side.path).getSessionName(), "the selected text");
  } finally {
    dirs.restore();
  }
});

test("a shell-only branch is copied, as the sidebar's Fork copies it", () => {
  const dirs = scratch();
  try {
    const manager = SessionManager.create(dirs.cwd, dirs.sessionDir);
    manager.appendMessage({ role: "bashExecution", command: "ls", output: "a", exitCode: 0, cancelled: false, truncated: false, timestamp: Date.now() });
    const sourcePath = join(dirs.sessionDir, "shell-only.jsonl");
    mkdirSync(dirs.sessionDir, { recursive: true });
    writeFileSync(sourcePath, [manager.getHeader(), ...manager.getEntries()].map((entry) => JSON.stringify(entry)).join("\n") + "\n");

    const side = createSideSession(sourcePath);
    const [, meta, ...entries] = lines(side.path);
    assert.equal(meta.customType, SIDE_META_TYPE);
    assert.equal(entries[0].parentId, meta.id);
    assert.equal(SessionManager.open(side.path).getSessionName(), SIDE_SESSION_NAME);
  } finally {
    dirs.restore();
  }
});

test("a side chat keeps only what its parent had, cut down to the read-mostly tools", () => {
  const tool = (name) => ({ name, description: name, parameters: {} });
  const recorded = [{ role: "system", content: "", toolsAdded: ["read", "bash", "edit", "write", "ext_tool", "mcp__x__y"].map(tool), timestamp: 1 }];
  assert.deepEqual(sideToolNames(undefined, recorded), ["read", "bash"]);
  // A pin wins over the recorded loadout: a Read-only parent stays without a shell.
  assert.deepEqual(sideToolNames(["read", "grep", "find", "ls"], recorded), ["read", "grep", "find", "ls"]);
  assert.deepEqual(sideToolNames(["read", "powershell", "edit"], []), ["read", "powershell"]);
  // An older transcript with neither.
  assert.deepEqual(sideToolNames(undefined, []), ["read", "bash"]);
  // Only tools the parent could not lend: nothing, not a default.
  assert.deepEqual(sideToolNames(["edit", "write"], recorded), []);
});

test("a side chat's name comes from its message's first line", () => {
  assert.equal(sideChatNameFrom("  why did it fail?\nsee the log"), "why did it fail?");
  assert.equal(sideChatNameFrom("x".repeat(50)), `${"x".repeat(40)}…`);
  assert.equal(sideChatNameFrom("/compact"), null);
  assert.equal(sideChatNameFrom("!ls"), null);
  assert.equal(sideChatNameFrom("  "), null);
  // Selected text names a chat whatever it starts with.
  assert.equal(sideChatNameFromText("/usr/bin/env\nnode"), "/usr/bin/env");
  assert.equal(sideChatNameFromText("  "), null);

  assert.equal(sideChatTitle({ name: SIDE_SESSION_NAME }, "untitled"), "untitled");
  assert.equal(sideChatTitle({}, "untitled"), "untitled");
  assert.equal(sideChatTitle({ name: "question" }, "untitled"), "question");
});

test("usage counts what a side chat added, not what it inherited", () => {
  const dirs = scratch();
  try {
    const source = branchedSession(dirs);
    const side = createSideSession(source.path);
    const inherited = lines(side.path).slice(1);
    const meta = inherited.find((entry) => entry.customType === SIDE_META_TYPE);
    const own = { type: "message", id: "own", timestamp: new Date(Date.parse(meta.data.createdAt) + 1).toISOString() };
    const old = inherited.filter((entry) => entry.type === "message").map((entry) => ({ ...entry, timestamp: "2020-01-01T00:00:00.000Z" }));
    assert.deepEqual(sideOwnEntries([meta, ...old, own]), [own]);
    // Anything else is counted whole.
    assert.deepEqual(sideOwnEntries(old), old);
  } finally {
    dirs.restore();
  }
});

test("refuses an entry-only session, a missing file, and an unwritten leaf", () => {
  const dirs = scratch();
  try {
    // On disk, but no message entry on its branch: nothing a side chat inherits.
    const timestamp = new Date().toISOString();
    const entryOnly = join(dirs.sessionDir, "entry-only.jsonl");
    mkdirSync(dirs.sessionDir, { recursive: true });
    writeFileSync(entryOnly, [
      { type: "session", version: 3, id: "entry-only", timestamp, cwd: dirs.cwd },
      { type: "custom", id: "n1", parentId: null, timestamp, customType: "pi-web:note", data: { hello: true } },
    ].map((entry) => JSON.stringify(entry)).join("\n") + "\n");
    assert.throws(() => createSideSession(entryOnly), refusal("empty"));

    assert.throws(() => createSideSession(join(dirs.sessionDir, "missing.jsonl")), refusal("not_found"));
    // A live leaf that is not on disk yet.
    const source = branchedSession(dirs);
    assert.throws(() => createSideSession(source.path, "not-on-disk"), refusal("unsaved"));
  } finally {
    dirs.restore();
  }
});

test("refuses a subagent session and a nested side chat, not a Chat-only session", () => {
  const dirs = scratch();
  try {
    // A subagent session: metadata first, as the subagent runtime writes it.
    const subagent = SessionManager.create(dirs.cwd, dirs.sessionDir);
    subagent.appendCustomEntry(SUBAGENT_META_TYPE, {
      version: 1,
      parentSessionId: "parent",
      parentSessionPath: "parent.jsonl",
      parentToolCallId: "call",
      profile: "general-purpose",
      description: "Task",
      task: "Task",
      runInBackground: false,
      createdAt: new Date().toISOString(),
    });
    subagent.appendMessage(user("do the task"));
    assert.throws(() => createSideSession(subagent.getSessionFile()), refusal("subagent"));

    // A side chat of a side chat is refused (no nesting).
    const source = branchedSession(dirs);
    const side = createSideSession(source.path);
    assert.throws(() => createSideSession(side.path), refusal("side"));

    // A Chat-only parent gets a side chat with no tools (rpc-manager-side.integration.test.mjs).
    const chatOnly = SessionManager.create(dirs.cwd, dirs.sessionDir);
    chatOnly.appendMessage(user("hello"));
    chatOnly.appendMessage(assistant("hi"));
    chatOnly.appendCustomEntry("pi-web:tool-selection", { version: 1, tools: [] });
    assert.ok(existsSync(createSideSession(chatOnly.getSessionFile()).path));

    // The sidebar's Fork refuses a side chat.
    const forkSource = branchedSession(dirs);
    const forkSide = createSideSession(forkSource.path);
    assert.throws(() => forkSessionBranch(forkSide.path), refusal("side"));
  } finally {
    dirs.restore();
  }
});

test("side sessions hide as family members beside subagents", () => {
  const base = {
    path: "/x.jsonl", cwd: "/x", created: "2024-01-01T00:00:00.000Z",
    messageCount: 1, firstMessage: "m", modified: "2024-01-01T00:00:00.000Z",
  };
  const main = { ...base, id: "main" };
  const subagent = {
    ...base, id: "sub", modified: "2024-01-02T00:00:00.000Z",
    relation: { kind: "subagent", parentSessionId: "main", profile: "general-purpose", description: "Task", status: "completed" },
  };
  const side = {
    ...base, id: "side", modified: "2024-01-03T00:00:00.000Z",
    relation: { kind: "side", parentSessionId: "main" },
  };
  const other = { ...base, id: "other", modified: "2024-01-04T00:00:00.000Z" };

  const families = listSessionFamilies([main, subagent, side, other]);
  assert.deepEqual(families.map((family) => family.root.id).sort(), ["main", "other"]);
  const family = getSessionFamily([main, subagent, side, other], "main");
  assert.deepEqual(family?.subagents.map((session) => session.id).sort(), ["side", "sub"]);
  // The family is found from the side chat too, and its activity is the family's latest.
  assert.equal(getSessionFamily([main, subagent, side, other], "side")?.root.id, "main");
  const mainFamily = families.find((family) => family.root.id === "main");
  assert.equal(mainFamily?.latestModified, side.modified);

  // A side chat of a side chat (never creatable, but never a root either).
  const nested = { ...base, id: "nested", relation: { kind: "side", parentSessionId: "side" } };
  const nestedFamilies = listSessionFamilies([main, side, nested]);
  assert.deepEqual(nestedFamilies.map((family) => family.root.id), ["main"]);
  assert.equal(nestedFamilies[0].subagents.length, 2);
});

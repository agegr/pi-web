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
  sideInheritedLeafId,
  sideOwnEntries,
  sideToolNames,
} = await jiti.import("./side-session.ts");
const { SUBAGENT_META_TYPE } = await jiti.import("./subagents.ts");
const { readSessionToolSelection } = await jiti.import("./session-tool-selection.ts");
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
const assistant = (text) => ({ role: "assistant", content: [{ type: "text", text }], stopReason: "stop", timestamp: Date.now() });
const reply = (text, stopReason) => ({ ...assistant(text), stopReason });
const toolCall = (toolName, input) => ({
  role: "assistant",
  content: [{ type: "toolCall", toolCallId: "call-1", toolName, input }],
  stopReason: "toolUse",
  timestamp: Date.now(),
});

function lines(path) {
  return readFileSync(path, "utf8").trim().split("\n").map((line) => JSON.parse(line));
}

function messageTexts(path) {
  return lines(path).filter((entry) => entry.type === "message").map((entry) => (
    typeof entry.message.content === "string" ? entry.message.content : entry.message.content[0].text
  ));
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

test("a side chat taken mid-run ends at the parent's last ended turn", () => {
  const dirs = scratch();
  try {
    const manager = SessionManager.create(dirs.cwd, dirs.sessionDir);
    manager.appendMessage(user("fix the test"));
    const ended = manager.appendMessage(reply("fixed the first test", "stop"));
    manager.appendMessage(user("now fix lint"));
    manager.appendMessage(toolCall("bash", { command: "npm run lint" }));

    const leaf = manager.getLeafId();
    assert.equal(sideInheritedLeafId(manager.getBranch(leaf), leaf), ended);

    const side = createSideSession(manager.getSessionFile());
    const [, meta, ...entries] = lines(side.path);
    assert.equal(meta.customType, SIDE_META_TYPE);
    assert.equal(entries[0].parentId, meta.id);
    assert.deepEqual(messageTexts(side.path), ["fix the test", "fixed the first test"]);
    assert.equal(JSON.stringify(entries).includes("now fix lint"), false, "the unanswered prompt is not inherited");
    assert.equal(JSON.stringify(entries).includes("toolCall"), false, "the call without a result is not inherited");
    const boundary = entries.at(-1);
    assert.equal(boundary.customType, SIDE_BOUNDARY_MESSAGE_TYPE);
    assert.equal(boundary.parentId, entries.at(-2).id);
    assert.equal(SessionManager.open(side.path).buildSessionContext().messages.at(-1).customType, SIDE_BOUNDARY_MESSAGE_TYPE);
  } finally {
    dirs.restore();
  }
});

test("an idle parent whose last entry is an ended reply is copied whole", () => {
  const dirs = scratch();
  try {
    const manager = SessionManager.create(dirs.cwd, dirs.sessionDir);
    manager.appendMessage(user("question"));
    const ended = manager.appendMessage(reply("answer", "stop"));
    const leaf = manager.getLeafId();
    assert.equal(leaf, ended);
    // A1 changes nothing here: the cut is the leaf itself.
    assert.equal(sideInheritedLeafId(manager.getBranch(leaf), leaf), leaf);

    const side = createSideSession(manager.getSessionFile());
    assert.deepEqual(messageTexts(side.path), ["question", "answer"]);
    assert.equal(lines(side.path).at(-1).customType, SIDE_BOUNDARY_MESSAGE_TYPE);
  } finally {
    dirs.restore();
  }
});

test("a parent with no finished reply inherits its last prompt, not an empty refusal", () => {
  const dirs = scratch();
  try {
    const manager = SessionManager.create(dirs.cwd, dirs.sessionDir);
    manager.appendMessage(user("q"));
    manager.appendMessage(toolCall("bash", { command: "ls" }));

    const side = createSideSession(manager.getSessionFile());
    assert.ok(existsSync(side.path));
    assert.deepEqual(messageTexts(side.path), ["q"]);
    assert.equal(lines(side.path).at(-1).customType, SIDE_BOUNDARY_MESSAGE_TYPE);
  } finally {
    dirs.restore();
  }
});

test("an aborted reply is an ended turn a side chat keeps", () => {
  const dirs = scratch();
  try {
    const manager = SessionManager.create(dirs.cwd, dirs.sessionDir);
    manager.appendMessage(user("why did it stop?"));
    const stopped = manager.appendMessage(reply("Stopped mid answer", "aborted"));
    const leaf = manager.getLeafId();
    assert.equal(sideInheritedLeafId(manager.getBranch(leaf), leaf), stopped);

    const side = createSideSession(manager.getSessionFile());
    assert.deepEqual(messageTexts(side.path), ["why did it stop?", "Stopped mid answer"]);
  } finally {
    dirs.restore();
  }
});

test("an error or output-limit reply is not a cut point", () => {
  const dirs = scratch();
  try {
    for (const stopReason of ["error", "length"]) {
      const manager = SessionManager.create(dirs.cwd, dirs.sessionDir);
      manager.appendMessage(user("go"));
      manager.appendMessage(reply("done", "stop"));
      manager.appendMessage(user("again"));
      manager.appendMessage(reply("partial", stopReason));

      const side = createSideSession(manager.getSessionFile());
      assert.deepEqual(messageTexts(side.path), ["go", "done"], `${stopReason} reply is continued in the same run`);
    }

    // With no ended reply at all, the last user prompt is the fallback.
    const manager = SessionManager.create(dirs.cwd, dirs.sessionDir);
    manager.appendMessage(user("q"));
    manager.appendMessage(reply("boom", "error"));
    assert.deepEqual(messageTexts(createSideSession(manager.getSessionFile()).path), ["q"]);
  } finally {
    dirs.restore();
  }
});

test("creating a side chat mid-run leaves the parent's file and leaf untouched", () => {
  const dirs = scratch();
  try {
    const manager = SessionManager.create(dirs.cwd, dirs.sessionDir);
    manager.appendMessage(user("fix the test"));
    manager.appendMessage(reply("fixed the first test", "stop"));
    manager.appendMessage(user("now fix lint"));
    manager.appendMessage(toolCall("bash", { command: "npm run lint" }));
    const sourcePath = manager.getSessionFile();
    const leafBefore = manager.getLeafId();
    const bytesBefore = readFileSync(sourcePath, "utf8");

    const side = createSideSession(sourcePath);

    // Only the copy was rewound: the source's bytes and its leaf are the same.
    assert.equal(readFileSync(sourcePath, "utf8"), bytesBefore);
    assert.equal(manager.getLeafId(), leafBefore);
    assert.equal(SessionManager.open(sourcePath).getLeafId(), leafBefore);
    assert.deepEqual(messageTexts(side.path), ["fix the test", "fixed the first test"]);
  } finally {
    dirs.restore();
  }
});

test("a message-less source still refuses with empty", () => {
  const dirs = scratch();
  try {
    // On disk, but no message entry on its branch: nothing a side chat inherits.
    const timestamp = new Date().toISOString();
    const messageLess = join(dirs.sessionDir, "message-less.jsonl");
    mkdirSync(dirs.sessionDir, { recursive: true });
    writeFileSync(messageLess, [
      { type: "session", version: 3, id: "message-less", timestamp, cwd: dirs.cwd },
      { type: "custom", id: "n1", parentId: null, timestamp, customType: "pi-web:note", data: { hello: true } },
    ].map((entry) => JSON.stringify(entry)).join("\n") + "\n");
    assert.throws(() => createSideSession(messageLess), refusal("empty"));
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

test("a tool pin on another branch binds the side chat, as it binds its parent", () => {
  const dirs = scratch();
  try {
    for (const pin of [["read", "grep", "find", "ls"], []]) {
      const manager = SessionManager.create(dirs.cwd, dirs.sessionDir);
      manager.appendMessage(user("question"));
      const a1 = manager.appendMessage(assistant("first answer"));
      manager.appendCustomEntry("pi-web:tool-selection", { version: 1, tools: pin });
      manager.appendMessage(user("second question"));
      manager.appendMessage(assistant("second answer"));

      const side = lines(createSideSession(manager.getSessionFile(), a1).path);
      assert.equal(side[1].customType, SIDE_META_TYPE);
      const entries = side.slice(1);
      assert.deepEqual(readSessionToolSelection(entries), pin);
      // Still one chain ending on the boundary, and the other branch stays out.
      assert.equal(entries.at(-1).customType, SIDE_BOUNDARY_MESSAGE_TYPE);
      for (let index = 1; index < entries.length; index += 1) assert.equal(entries[index].parentId, entries[index - 1].id);
      assert.ok(!JSON.stringify(entries).includes("second answer"));
    }

    const unpinned = SessionManager.create(dirs.cwd, dirs.sessionDir);
    unpinned.appendMessage(user("question"));
    unpinned.appendMessage(assistant("answer"));
    assert.equal(readSessionToolSelection(lines(createSideSession(unpinned.getSessionFile()).path).slice(1)), undefined);
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

  const sides = [
    { id: "newer", name: SIDE_SESSION_NAME, created: "2026-01-02", relation: { kind: "side" } },
    { id: "older", name: SIDE_SESSION_NAME, created: "2026-01-01", relation: { kind: "side" } },
    { id: "subagent", created: "2025-01-01", relation: { kind: "subagent" } },
  ];
  assert.equal(sideChatTitle(sides[1], "Side chat", sides), "Side chat 1");
  assert.equal(sideChatTitle(sides[0], "Side chat", sides), "Side chat 2");
  assert.equal(sideChatTitle({ ...sides[0], name: "question" }, "Side chat", sides), "question");
  assert.equal(sideChatTitle(sides[0], "Side chat", [sides[0]]), "Side chat 1");
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

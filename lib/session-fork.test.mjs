import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { interopDefault: true, moduleCache: false });
const { forkSessionBranch, readForkSourceTitle, SessionForkError } = await jiti.import("./session-fork.ts");
const {
  FORK_NAME_BASE_MAX,
  forkSessionName,
  sessionDisplayTitle,
  shortenToCodePoints,
  splitBeforeForkSuffix,
  splitForkSuffix,
} = await jiti.import("./session-fork-name.ts");
const { scanSessionFileInfo } = await jiti.import("./session-list-scanner.ts");
const { SUBAGENT_META_TYPE } = await jiti.import("./subagents.ts");
const { SessionManager } = await jiti.import("@earendil-works/pi-coding-agent");
// The sidebar row's own title rule, which the copy's name must start from.
const componentJiti = createJiti(import.meta.url, { jsx: { runtime: "automatic" }, tsconfigPaths: true });
const { sessionRowTitle } = await componentJiti.import("../components/SessionTree.tsx");

/** A scratch agent dir and session dir: nothing here may reach the real ~/.pi. */
async function scratch(t) {
  const root = await mkdtemp(join(tmpdir(), "pi-web-session-fork-"));
  const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
  const previousHome = process.env.HOME;
  process.env.PI_CODING_AGENT_DIR = join(root, "agent");
  process.env.HOME = join(root, "home");
  t.after(async () => {
    if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
    if (previousHome === undefined) delete process.env.HOME;
    else process.env.HOME = previousHome;
    await rm(root, { recursive: true, force: true });
  });
  return { cwd: join(root, "project"), sessionDir: join(root, "sessions") };
}

const user = (text) => ({ role: "user", content: text, timestamp: Date.now() });
const assistant = (text) => ({ role: "assistant", content: [{ type: "text", text }], timestamp: Date.now() });

function lines(path) {
  return readFileSync(path, "utf8").trim().split("\n").map((line) => JSON.parse(line));
}

function messageTexts(path) {
  return lines(path).filter((entry) => entry.type === "message").map((entry) => (
    typeof entry.message.content === "string" ? entry.message.content : entry.message.content[0].text
  ));
}

/** The copy's newest session_info name, as pi reads it back. */
function storedName(path) {
  return SessionManager.open(path).getSessionName();
}

/** The sidebar's Fork as the route runs it: the source's title, then the copy. */
async function forkAsSidebar(path, liveLeafId) {
  return forkSessionBranch(path, liveLeafId, await readForkSourceTitle(path));
}

const SUFFIX = "[0-9a-f]{4}";

function refusal(code) {
  return (error) => error instanceof SessionForkError && error.code === code;
}

/** u1 → a1, then back to u1 → a2: the file's leaf (its last entry) is a2. */
function branchedSession({ cwd, sessionDir }) {
  const manager = SessionManager.create(cwd, sessionDir);
  const u1 = manager.appendMessage(user("question"));
  const a1 = manager.appendMessage(assistant("first answer"));
  manager.appendLabelChange(u1, "start");
  manager.branch(u1);
  const a2 = manager.appendMessage(assistant("second answer"));
  return { manager, path: manager.getSessionFile(), u1, a1, a2 };
}

test("copies the file's leaf branch beside the source and leaves the source as it was", async (t) => {
  const dirs = await scratch(t);
  const source = branchedSession(dirs);
  const before = readFileSync(source.path, "utf8");

  const fork = forkSessionBranch(source.path);

  assert.notEqual(fork.sessionId, source.manager.getSessionId());
  assert.ok(existsSync(fork.path));
  assert.equal(dirname(fork.path), dirname(source.path));
  assert.ok(fork.path.endsWith(`_${fork.sessionId}.jsonl`));
  const [header, ...entries] = lines(fork.path);
  assert.equal(header.type, "session");
  assert.equal(header.id, fork.sessionId);
  assert.equal(header.cwd, source.manager.getCwd());
  assert.equal(header.parentSession, source.path);
  assert.deepEqual(messageTexts(fork.path), ["question", "second answer"]);
  // The label of a copied entry comes along, as pi copies it.
  assert.ok(entries.some((entry) => entry.type === "label" && entry.targetId === source.u1 && entry.label === "start"));
  assert.equal(readFileSync(source.path, "utf8"), before, "the source is untouched");
});

test("an open wrapper's leaf picks the branch it shows", async (t) => {
  const dirs = await scratch(t);
  const source = branchedSession(dirs);
  const fork = forkSessionBranch(source.path, source.a1);
  assert.deepEqual(messageTexts(fork.path), ["question", "first answer"]);
});

test("a shell-only branch is written even though pi would wait for a message", async (t) => {
  const { cwd, sessionDir } = await scratch(t);
  const path = join(sessionDir, "bash-only.jsonl");
  const timestamp = new Date().toISOString();
  mkdirSync(sessionDir, { recursive: true });
  writeFileSync(path, [
    { type: "session", version: 3, id: "bash-only", timestamp, cwd },
    { type: "message", id: "b1", parentId: null, timestamp, message: { role: "bashExecution", command: "ls", output: "a\n", exitCode: 0, cancelled: false, truncated: false, timestamp: Date.now() } },
  ].map((entry) => JSON.stringify(entry)).join("\n") + "\n");

  const fork = forkSessionBranch(path);
  const [header, entry] = lines(fork.path);
  assert.equal(header.parentSession, path);
  assert.equal(entry.message.role, "bashExecution");
  assert.equal(entry.message.command, "ls");
});

test("refuses what it cannot copy, with a code the sidebar can name", async (t) => {
  const { cwd, sessionDir } = await scratch(t);
  const missing = join(sessionDir, "missing.jsonl");
  assert.throws(() => forkSessionBranch(missing), refusal("not_found"));
  // A wrapper whose file is not written yet, or whose leaf is not on disk.
  assert.throws(() => forkSessionBranch(missing, "abc"), refusal("unsaved"));
  const source = branchedSession({ cwd, sessionDir });
  assert.throws(() => forkSessionBranch(source.path, "not-an-entry"), refusal("unsaved"));
  // A leaf reset before the first entry, a header alone, setup entries alone.
  assert.throws(() => forkSessionBranch(source.path, null), refusal("empty"));
  const timestamp = new Date().toISOString();
  const headerOnly = join(sessionDir, "header-only.jsonl");
  writeFileSync(headerOnly, `${JSON.stringify({ type: "session", version: 3, id: "header-only", timestamp, cwd })}\n`);
  assert.throws(() => forkSessionBranch(headerOnly), refusal("empty"));
  const setupOnly = join(sessionDir, "setup-only.jsonl");
  writeFileSync(setupOnly, [
    { type: "session", version: 3, id: "setup-only", timestamp, cwd },
    { type: "model_change", id: "m1", parentId: null, timestamp, provider: "p", modelId: "m" },
  ].map((entry) => JSON.stringify(entry)).join("\n") + "\n");
  assert.throws(() => forkSessionBranch(setupOnly), refusal("empty"));

  // A subagent's copy would be folded into its parent's family, out of sight.
  const subagent = SessionManager.create(cwd, sessionDir, { parentSession: source.path });
  subagent.appendCustomEntry(SUBAGENT_META_TYPE, { version: 1, parentSessionId: "parent", parentSessionPath: source.path });
  subagent.appendMessage(user("task"));
  subagent.appendMessage(assistant("done"));
  assert.throws(() => forkSessionBranch(subagent.getSessionFile()), refusal("subagent"));
  // Invalid metadata does not make a subagent.
  const notSubagent = SessionManager.create(cwd, sessionDir);
  notSubagent.appendCustomEntry(SUBAGENT_META_TYPE, { version: 2 });
  notSubagent.appendMessage(user("hello"));
  assert.ok(existsSync(forkSessionBranch(notSubagent.getSessionFile()).path));
});

test("names the copy after a named source plus a short random suffix, in the copy's file only", async (t) => {
  const dirs = await scratch(t);
  const source = branchedSession(dirs);
  source.manager.appendSessionInfo("PR#1030 状态栏命令按钮");
  const before = readFileSync(source.path, "utf8");

  const fork = await forkAsSidebar(source.path);

  assert.match(fork.name, new RegExp(`^PR#1030 状态栏命令按钮 · ${SUFFIX}$`));
  assert.equal(storedName(fork.path), fork.name, "written as a session_info entry, as a rename writes one");
  const copied = lines(fork.path);
  const last = copied.at(-1);
  assert.equal(last.type, "session_info", "appended last: the copy's leaf, as after a rename");
  assert.equal(last.name, fork.name);
  assert.equal(last.parentId, copied.at(-2).id);
  assert.deepEqual(messageTexts(fork.path), ["question", "second answer"]);
  assert.equal(readFileSync(source.path, "utf8"), before, "the source's bytes are unchanged");
  assert.equal(storedName(source.path), "PR#1030 状态栏命令按钮");
});

test("an unnamed source lends its first message, as its sidebar row shows it", async (t) => {
  const dirs = await scratch(t);
  const source = branchedSession(dirs);
  const before = readFileSync(source.path, "utf8");
  assert.equal(await readForkSourceTitle(source.path), "question");
  const fork = await forkAsSidebar(source.path);
  assert.match(fork.name, new RegExp(`^question · ${SUFFIX}$`));
  assert.equal(storedName(fork.path), fork.name);
  assert.equal(readFileSync(source.path, "utf8"), before);

  // A skill expansion reads as the command the user typed; lines become one.
  const skill = SessionManager.create(dirs.cwd, dirs.sessionDir);
  skill.appendMessage(user('<skill name="review" location="/skills/review/SKILL.md">\nReferences are relative to /skills/review.\n\nbody\n</skill>\n\nthe diff'));
  skill.appendMessage(assistant("ok"));
  assert.match((await forkAsSidebar(skill.getSessionFile())).name, new RegExp(`^/skill:review the diff · ${SUFFIX}$`));
  const multiline = SessionManager.create(dirs.cwd, dirs.sessionDir);
  multiline.appendMessage(user("  fix the\n\n  status bar  "));
  multiline.appendMessage(assistant("ok"));
  assert.match((await forkAsSidebar(multiline.getSessionFile())).name, new RegExp(`^fix the status bar · ${SUFFIX}$`));
});

test("the name the sidebar shows is used even when it was given on another branch", async (t) => {
  const dirs = await scratch(t);
  const source = branchedSession(dirs);
  // Renamed on the a2 branch; the open wrapper shows (and forks) a1's.
  source.manager.appendSessionInfo("Named on a2");
  const fork = await forkAsSidebar(source.path, source.a1);
  assert.deepEqual(messageTexts(fork.path), ["question", "first answer"]);
  assert.match(fork.name, new RegExp(`^Named on a2 · ${SUFFIX}$`));
});

test("a long title is shortened by code points: a name, not a whole first message", async (t) => {
  const dirs = await scratch(t);
  const emoji = SessionManager.create(dirs.cwd, dirs.sessionDir);
  emoji.appendMessage(user("😀".repeat(60)));
  emoji.appendMessage(assistant("ok"));
  const fork = await forkAsSidebar(emoji.getSessionFile());
  const base = fork.name.slice(0, -" · 0000".length);
  assert.equal(base, `${"😀".repeat(FORK_NAME_BASE_MAX - 1)}…`, "no surrogate pair is split");
  assert.match(fork.name, new RegExp(` · ${SUFFIX}$`));

  // Cut at 39 code points, the trailing space dropped before the ellipsis.
  const long = "Investigate why the status bar command buttons vanish after reload";
  assert.equal(forkSessionName(long, "3f9a", false), "Investigate why the status bar command… · 3f9a");
  assert.equal(forkSessionName("x".repeat(FORK_NAME_BASE_MAX), "3f9a", false), `${"x".repeat(FORK_NAME_BASE_MAX)} · 3f9a`, "a title that fits is kept whole");
  assert.equal(shortenToCodePoints("a😀b😀c", 4), "a😀b…");
});

test("a fork of a fork replaces the earlier suffix instead of stacking another", async (t) => {
  const dirs = await scratch(t);
  const source = branchedSession(dirs);
  const first = await forkAsSidebar(source.path);
  const second = await forkAsSidebar(first.path);
  assert.match(first.name, new RegExp(`^question · ${SUFFIX}$`));
  assert.match(second.name, new RegExp(`^question · ${SUFFIX}$`));
  // Shortened once: the second fork keeps the same base.
  const long = SessionManager.create(dirs.cwd, dirs.sessionDir);
  long.appendMessage(user("y".repeat(80)));
  long.appendMessage(assistant("ok"));
  const longFirst = await forkAsSidebar(long.getSessionFile());
  const longSecond = await forkAsSidebar(longFirst.path);
  assert.equal(longSecond.name.slice(0, -4), longFirst.name.slice(0, -4));

  // Only a fork's title can carry a Fork's suffix: a name its user gave keeps it.
  const weekly = SessionManager.create(dirs.cwd, dirs.sessionDir);
  weekly.appendMessage(user("hello"));
  weekly.appendSessionInfo("Weekly sync · 2024");
  assert.match((await forkAsSidebar(weekly.getSessionFile())).name, new RegExp(`^Weekly sync · 2024 · ${SUFFIX}$`));
  assert.equal(forkSessionName("Weekly sync · 2024", "3f9a", true), "Weekly sync · 3f9a");
  assert.equal(forkSessionName("Plan · beta", "3f9a", true), "Plan · beta · 3f9a", "not hex: not a Fork's suffix");
});

test("a shell-only copy is written with its name", async (t) => {
  const { cwd, sessionDir } = await scratch(t);
  const path = join(sessionDir, "bash-only-named.jsonl");
  const timestamp = new Date().toISOString();
  mkdirSync(sessionDir, { recursive: true });
  writeFileSync(path, [
    { type: "session", version: 3, id: "bash-only-named", timestamp, cwd },
    { type: "message", id: "b1", parentId: null, timestamp, message: { role: "bashExecution", command: "ls", output: "a\n", exitCode: 0, cancelled: false, truncated: false, timestamp: Date.now() } },
    { type: "session_info", id: "n1", parentId: "b1", timestamp, name: "Listing" },
  ].map((entry) => JSON.stringify(entry)).join("\n") + "\n");
  const fork = await forkAsSidebar(path);
  assert.match(fork.name, new RegExp(`^Listing · ${SUFFIX}$`));
  assert.equal(storedName(fork.path), fork.name);
  assert.equal(lines(fork.path)[1].message.role, "bashExecution");
});

test("a source with no title of its own leaves the copy unnamed, to take its first real message", async (t) => {
  const { cwd, sessionDir } = await scratch(t);
  const timestamp = new Date().toISOString();
  mkdirSync(sessionDir, { recursive: true });
  const shellOnly = join(sessionDir, "shell-only.jsonl");
  writeFileSync(shellOnly, [
    { type: "session", version: 3, id: "shell-only", timestamp, cwd },
    { type: "message", id: "b1", parentId: null, timestamp, message: { role: "bashExecution", command: "ls", output: "a\n", exitCode: 0, cancelled: false, truncated: false, timestamp: Date.now() } },
  ].map((entry) => JSON.stringify(entry)).join("\n") + "\n");
  assert.equal(await readForkSourceTitle(shellOnly), null, "the list's (no messages) placeholder is no title");
  const shellFork = await forkAsSidebar(shellOnly);
  assert.equal(shellFork.name, undefined);
  assert.ok(!lines(shellFork.path).some((entry) => entry.type === "session_info"), "no name written");
  // The copy's row takes the first message its user writes in it.
  const copy = SessionManager.open(shellFork.path);
  copy.appendMessage(user("now a real question"));
  copy.appendMessage(assistant("ok"));
  const scanned = await scanSessionFileInfo(shellFork.path);
  assert.equal(scanned.name, undefined);
  assert.equal(scanned.firstMessage, "now a real question");

  // Only an image from the user: no text, no title either.
  const image = SessionManager.create(cwd, sessionDir);
  image.appendMessage({ role: "user", content: [{ type: "image", data: "iVBORw0KGgo=", mimeType: "image/png" }], timestamp: Date.now() });
  image.appendMessage(assistant("a picture"));
  assert.equal(await readForkSourceTitle(image.getSessionFile()), null);
  const imageFork = await forkAsSidebar(image.getSessionFile());
  assert.equal(imageFork.name, undefined);
  assert.equal(storedName(imageFork.path), undefined);

  // A named one keeps its name whatever its messages.
  const named = SessionManager.create(cwd, sessionDir);
  named.appendMessage({ role: "user", content: [{ type: "image", data: "iVBORw0KGgo=", mimeType: "image/png" }], timestamp: Date.now() });
  named.appendMessage(assistant("a picture"));
  named.appendSessionInfo("Screenshot");
  assert.match((await forkAsSidebar(named.getSessionFile())).name, new RegExp(`^Screenshot · ${SUFFIX}$`));
});

test("a blank title falls back to the source's id, so forks of the copy do not stack suffixes", async (t) => {
  const dirs = await scratch(t);
  const blank = SessionManager.create(dirs.cwd, dirs.sessionDir);
  blank.appendMessage(user("   \n  "));
  blank.appendMessage(assistant("ok"));
  assert.equal(await readForkSourceTitle(blank.getSessionFile()), undefined);
  const id = blank.getSessionId().slice(0, 12);
  const first = await forkAsSidebar(blank.getSessionFile());
  assert.match(first.name, new RegExp(`^${id} · ${SUFFIX}$`));
  const second = await forkAsSidebar(first.path);
  assert.match(second.name, new RegExp(`^${id} · ${SUFFIX}$`), "the earlier suffix is replaced");
  // A blank title passed in is the id rule too, never a bare suffix.
  assert.match(forkSessionBranch(blank.getSessionFile(), undefined, " \t ").name, new RegExp(`^${id} · ${SUFFIX}$`));
});

test("the source's title follows the sidebar row's rule; the row and the toast split the suffix off", () => {
  const row = (id, rest) => ({ id, path: "", cwd: "", created: "", modified: "", messageCount: 1, firstMessage: "(no messages)", ...rest });
  const skill = '<skill name="review" location="/skills/review/SKILL.md">\nReferences are relative to /skills/review.\n\nbody\n</skill>\n\nthe diff';
  for (const session of [
    row("a", { name: "Named" }),
    row("b", { firstMessage: "first question" }),
    row("c", { firstMessage: skill }),
    row("d", {}),
    row("abcdefghijklmnop", { firstMessage: "" }),
  ]) {
    assert.equal(sessionDisplayTitle(session), sessionRowTitle(session));
  }
  assert.deepEqual(splitForkSuffix("PR#1030 状态栏命令按钮 · 3f9a"), { base: "PR#1030 状态栏命令按钮", suffix: " · 3f9a" });
  assert.deepEqual(splitForkSuffix("Weekly sync · 2024 · 3f9a"), { base: "Weekly sync · 2024", suffix: " · 3f9a" });
  assert.equal(splitForkSuffix("Plan · beta"), null, "not hex");
  assert.equal(splitForkSuffix("Plan · 3F9A"), null, "a Fork's digits are lowercase");
  assert.equal(splitForkSuffix(" · 3f9a"), null, "nothing before it");
  assert.equal(splitForkSuffix("x"), null);
  // The toast: cut before the suffix, which keeps what follows it (the closing quote).
  assert.deepEqual(splitBeforeForkSuffix("已分叉「PR#1030 状态栏命令按钮 · 3f9a」", "PR#1030 状态栏命令按钮 · 3f9a"), { head: "已分叉「PR#1030 状态栏命令按钮", tail: " · 3f9a」" });
  assert.deepEqual(splitBeforeForkSuffix("Forked “Weekly sync · 2024 · 3f9a”", "Weekly sync · 2024 · 3f9a"), { head: "Forked “Weekly sync · 2024", tail: " · 3f9a”" });
  assert.equal(splitBeforeForkSuffix("Forked “(no messages)”", "(no messages)"), null, "an unnamed copy has no suffix");
  assert.equal(splitBeforeForkSuffix("Forked “x”", "y · 3f9a"), null, "a message without the name");
});

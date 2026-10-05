// Behaviour and safety coverage for POST /api/projects/delete: the route that
// removes every session of a derived project group. Every case builds a real
// agent directory on disk, so the assertions are about files that are gone or
// still there rather than about the route's intentions.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { existsSync, lstatSync, readFileSync, readdirSync, readlinkSync } from "node:fs";
import { chmod, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";
import { promisify } from "node:util";
import { createJiti } from "jiti";

const execFileAsync = promisify(execFile);

const jiti = createJiti(import.meta.url, {
  alias: { "@": process.cwd() },
  interopDefault: true,
  moduleCache: false,
});
const { POST } = await jiti.import("./route.ts");
const {
  attachSessionProjectInfo,
  getSessionListVersion,
  invalidateSessionListCache,
  listAllSessions,
} = await jiti.import("@/lib/session-reader");
const { workspaceKeyOf } = await jiti.import("@/lib/workspace-memory");
const { resetSessionScanIndexForTests } = await jiti.import("@/lib/session-list-scanner");

const roots = [];
const previousAgentDir = process.env.PI_CODING_AGENT_DIR;

after(async () => {
  if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
  resetSessionScanIndexForTests();
  invalidateSessionListCache();
  globalThis.__piSessionPathCache = undefined;
  globalThis.__piPathToSessionIdCache = undefined;
  globalThis.__piSmCache = undefined;
  globalThis.__piSessions = undefined;
  for (const root of roots) await rm(root, { recursive: true, force: true });
});

const timestamp = "2026-01-01T00:00:00.000Z";
const line = (entry) => JSON.stringify(entry) + "\n";
const userEntry = (id, content) => ({
  type: "message", id, parentId: null, timestamp,
  message: { role: "user", content },
});

/**
 * An agent directory holding two project groups, each with sessions in two
 * cwds (`-worktrees` included, as a git project's worktree sessions are), a
 * pi-subagents child tree and an artifact transcript under the first.
 */
async function fixture({ symlinkAgentDir = false } = {}) {
  const root = await mkdtemp(join(tmpdir(), "pi-web-project-delete-"));
  roots.push(root);
  // The agent dir as the scanner will spell it, and where it really lives. A
  // symlinked agent dir (macOS /var → /private/var, or a synced ~/.pi) is the
  // case the catalogue's session paths and their realpaths disagree on.
  const realAgentDir = join(root, "agent-real");
  const agentDir = symlinkAgentDir ? join(root, "agent") : realAgentDir;
  if (symlinkAgentDir) {
    // The target must exist before the link can be walked through.
    await mkdir(realAgentDir, { recursive: true });
    await symlink(realAgentDir, agentDir, "dir");
  }
  const sessionsDir = join(agentDir, "sessions");
  // A real repository with a linked worktree, so the worktree's sessions group
  // under the main checkout exactly as they do in the app.
  const repo = join(root, "repo");
  const worktree = join(root, "repo-worktrees", "feature");
  const other = join(root, "other");
  await mkdir(other, { recursive: true });
  await execFileAsync("git", ["init", repo]);
  await execFileAsync("git", ["-C", repo, "config", "user.name", "Pi Web Test"]);
  await execFileAsync("git", ["-C", repo, "config", "user.email", "pi-web-test@example.invalid"]);
  await execFileAsync("git", ["-C", repo, "config", "commit.gpgsign", "false"]);
  await writeFile(join(repo, "README.md"), "# test\n");
  await execFileAsync("git", ["-C", repo, "add", "README.md"]);
  await execFileAsync("git", ["-C", repo, "commit", "-m", "initial"]);
  await execFileAsync("git", ["-C", repo, "worktree", "add", "-b", "feature/test", worktree]);
  // The SDK's encoding: one directory per cwd, named after the stripped path.
  const dirFor = (cwd) => join(sessionsDir, `--${cwd.slice(1).replace(/[/\\:]/g, "-")}--`);

  async function session(cwd, id, extraHeader = {}, firstMessage = id) {
    // Through the link when the agent dir is one: the session must be at the
    // path the scanner enumerates, whose realpath differs.
    const dir = dirFor(cwd);
    await mkdir(dir, { recursive: true });
    const file = join(dir, `${id}.jsonl`);
    await writeFile(file, line({ type: "session", version: 3, id, cwd, timestamp, ...extraHeader }) + line(userEntry(`${id}-u1`, firstMessage)));
    return file;
  }

  process.env.PI_CODING_AGENT_DIR = agentDir;
  resetSessionScanIndexForTests();
  invalidateSessionListCache();
  globalThis.__piSessionPathCache = undefined;
  globalThis.__piPathToSessionIdCache = undefined;
  globalThis.__piSmCache = undefined;

  return { root, agentDir, realAgentDir, sessionsDir, repo, worktree, other, external: root, dirFor, session };
}

/** The key the server groups the cwd's sessions under, derived the same way the sidebar does. */
async function projectKeyOf(cwd) {
  const sessions = await attachSessionProjectInfo(await listAllSessions({ force: true }));
  const match = sessions.find((session) => session.cwd === cwd);
  assert.ok(match, `no enumerated session with cwd ${cwd}`);
  return workspaceKeyOf(match);
}

function post(body, { headers = {}, method = "POST" } = {}) {
  return POST(new Request("http://localhost/api/projects/delete", {
    method,
    headers: { "Content-Type": "application/json", host: "localhost", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  }));
}

async function answer(response) {
  return { status: response.status, body: await response.json() };
}

test("deletes every session of one project, its child trees and its directories, and leaves other projects alone", async (t) => {
  const { repo, worktree, other, dirFor, session } = await fixture(t);
  const mainSession = await session(repo, "proj-main");
  const worktreeSession = await session(worktree, "proj-worktree");
  const otherSession = await session(other, "other-main");
  // A pi-subagents child tree under one top-level session's own directory, plus
  // an artifact transcript the session scan deliberately ignores.
  const projectDir = dirFor(repo);
  const childTree = join(projectDir, "proj-main", "child-uuid", "run-0");
  const artifacts = join(projectDir, "subagent-artifacts");
  await mkdir(childTree, { recursive: true });
  await writeFile(join(childTree, "session.jsonl"), line({ type: "session", version: 3, id: "proj-child", cwd: repo, timestamp }));
  await mkdir(artifacts, { recursive: true });
  await writeFile(join(artifacts, "transcript.jsonl"), "{}\n");

  const projectKey = await projectKeyOf(repo);
  const { status, body } = await answer(await post({ projectKey }));

  assert.equal(status, 200);
  // Two top-level session files, plus the nested pi-subagents child that goes
  // with its parent's child tree.
  assert.deepEqual(body, { deletedSessions: 3, removedDirs: 2 });
  assert.equal(existsSync(mainSession), false, "the main cwd's session is gone");
  assert.equal(existsSync(worktreeSession), false, "the worktree's session is gone too");
  assert.equal(existsSync(childTree), false, "the pi-subagents child tree is gone");
  assert.equal(existsSync(artifacts), false, "the artifact transcripts are gone");
  assert.equal(existsSync(projectDir), false, "the now-empty project directory is gone");
  assert.equal(existsSync(dirFor(worktree)), false, "the worktree's project directory is gone");
  // The other project is untouched, and so are the code folders and the user's
  // own files: only the sessions tree is ever written.
  assert.equal(existsSync(otherSession), true);
  assert.equal(existsSync(join(other, "README")), false, "nothing was created outside the sessions tree");
  assert.equal(existsSync(repo), true);
  assert.equal(existsSync(worktree), true);
});

test("removes the project directory only once it is empty of sessions", async (t) => {
  const { repo, dirFor, session } = await fixture(t);
  await session(repo, "kept-sibling");
  const doomed = await session(repo, "doomed");
  // Two projects sharing one directory cannot happen on disk, so a stray file
  // is the case rmdirSync refuses: the directory stays and the refusal is reported.
  const stray = join(dirFor(repo), "not-a-session.txt");
  await writeFile(stray, "keep me\n");

  const projectKey = await projectKeyOf(repo);
  const { status, body } = await answer(await post({ projectKey }));

  assert.equal(status, 200);
  assert.equal(existsSync(doomed), false);
  assert.equal(existsSync(stray), true, "an unexpected file is left behind, not deleted recursively");
  assert.equal(existsSync(dirFor(repo)), true);
  assert.equal(body.removedDirs, 0);
  assert.equal(body.failures.length, 1);
  assert.equal(body.failures[0].path, dirFor(repo));
});

test("refuses a project key that matches no enumerated project, and never treats it as a path", async (t) => {
  const { repo, other, session } = await fixture(t);
  await session(repo, "proj-main");
  const otherSession = await session(other, "other-main");

  for (const projectKey of ["", "not-a-project", "../../etc", join(process.cwd(), ".."), "/etc"]) {
    const { status, body } = await answer(await post({ projectKey }));
    if (projectKey === "") {
      assert.deepEqual([status, body.reason], [400, "invalid-request"]);
      continue;
    }
    // A posted path is only ever a key: it matches no group, so nothing is removed.
    assert.deepEqual([status, body.reason], [404, "project-not-found"]);
  }
  assert.equal(existsSync(otherSession), true);
});

test("refuses a body that is not JSON, a body without a key, and a request from another page", async () => {
  let response = await post({ projectKey: "x" }, { headers: { origin: "https://evil.example" } });
  assert.deepEqual(await answer(response), { status: 403, body: { error: "Untrusted API request", reason: "request-denied" } });

  response = await post(JSON.stringify({ projectKey: "x" }), { headers: { "Content-Type": "text/plain" } });
  assert.deepEqual(await answer(response), {
    status: 415,
    body: { error: "Content-Type must be application/json", reason: "content-type" },
  });

  response = await post("{ not json");
  assert.deepEqual([response.status, (await response.json()).reason], [400, "invalid-request"]);
  response = await post({});
  assert.deepEqual([response.status, (await response.json()).reason], [400, "invalid-request"]);
  response = await post({ projectKey: 42 });
  assert.deepEqual([response.status, (await response.json()).reason], [400, "invalid-request"]);
});

test("refuses a project with a running session, naming it, and deletes nothing", async (t) => {
  const { repo, session } = await fixture(t);
  const runningFile = await session(repo, "proj-running", {}, "Long run");
  const idleFile = await session(repo, "proj-idle");
  const projectKey = await projectKeyOf(repo);

  // A live wrapper mid-run: the registry entry the busy check reads.
  const previous = globalThis.__piSessions;
  globalThis.__piSessions = new Map([["proj-running", {
    get sessionId() { return "proj-running"; },
    get sessionFile() { return runningFile; },
    get cwd() { return repo; },
    isAlive: () => true,
    isRunning: () => true,
    inner: {
      sessionManager: {
        getHeader: () => ({ type: "session", id: "proj-running", cwd: repo, timestamp }),
        getEntries: () => [userEntry("proj-running-u1", "keep working")],
        getSessionFile: () => runningFile,
        getSessionName: () => "Long run",
      },
    },
  }]]);
  t.after(() => { globalThis.__piSessions = previous; });

  const { status, body } = await answer(await post({ projectKey }));

  assert.equal(status, 409);
  assert.equal(body.reason, "session-busy");
  assert.deepEqual(body.runningSessionTitles, ["Long run"]);
  assert.equal(existsSync(runningFile), true, "a running session is refused, never killed");
  assert.equal(existsSync(idleFile), true, "nothing of the project was deleted");
});

test("refuses a project whose session directory is a symbolic link, leaving its target untouched", { skip: process.platform === "win32" }, async (t) => {
  const { sessionsDir, repo, other, session } = await fixture(t);
  await session(other, "other-main");
  // A project directory that is a link out of the sessions tree: removing it
  // recursively would follow the link and delete whatever it points at.
  const external = await mkdtemp(join(tmpdir(), "pi-web-project-delete-external-"));
  roots.push(external);
  const externalSession = join(external, "linked.jsonl");
  await writeFile(externalSession, line({ type: "session", version: 3, id: "linked-main", cwd: repo, timestamp }));
  const linkDir = join(sessionsDir, "--linked-repo--");
  await mkdir(sessionsDir, { recursive: true });
  await symlink(external, linkDir, "dir");
  resetSessionScanIndexForTests();
  invalidateSessionListCache();

  const projectKey = await projectKeyOf(repo);
  const { status, body } = await answer(await post({ projectKey }));

  assert.equal(status, 409);
  assert.equal(body.reason, "symlink");
  assert.equal(existsSync(externalSession), true, "the link's target survives");
  assert.equal(readlinkSync(linkDir), external);
  assert.ok(lstatSync(linkDir).isSymbolicLink(), "the link itself is still there too");
});

test("invalidates the session path, manager and list caches after a delete", async (t) => {
  const { repo, session } = await fixture(t);
  const file = await session(repo, "proj-main");
  const projectKey = await projectKeyOf(repo);
  // Warm the caches the delete must drop: the path cache from the enumeration,
  // a read-only manager for the file, and the list version before the scan.
  const before = getSessionListVersion();
  assert.ok(globalThis.__piSessionPathCache?.get("proj-main"), "the enumeration cached the path");

  const { status } = await answer(await post({ projectKey }));

  assert.equal(status, 200);
  assert.equal(existsSync(file), false);
  assert.equal(globalThis.__piSessionPathCache?.get("proj-main"), undefined, "the deleted id is no longer cached");
  assert.ok(getSessionListVersion() > before, "the session list was invalidated");
  const remaining = await listAllSessions({ force: true });
  assert.deepEqual(remaining.filter((entry) => entry.id === "proj-main"), []);
});

test("the route derives every removed path from an enumerated session, never from the posted key", async () => {
  // Static check of the contract the traversal test above can only sample: the
  // posted string is compared against `workspaceKeyOf()` and nothing else, and
  // each directory removed is `dirname()` of a real session path.
  const source = readFileSync(new URL("./route.ts", import.meta.url), "utf8");
  assert.match(source, /workspaceKeyOf\(session\) === projectKey/);
  assert.match(source, /projectDirOf\(session\.path, root\)/);
  // The project directory is the first path segment of a real session path,
  // under the root the route resolved itself.
  assert.match(source, /const \[projectDirName\] = relativePath\.split\(sep\)/);
  assert.match(source, /return join\(root, projectDirName\)/);
  assert.doesNotMatch(source, /join\((?:sessionsDir|root), projectKey\)/, "the key is never joined into a path");
  assert.doesNotMatch(source, /resolvePath\(projectKey\)/);
  // Guards, in the order the other mutating routes use.
  const order = ["isApiRequestAllowed(req)", "hasJsonContentType(req)", "typeof projectKey !== \"string\""]
    .map((needle) => source.indexOf(needle));
  assert.ok(order.every((index) => index >= 0), "every guard is present");
  assert.deepEqual(order, [...order].sort((a, b) => a - b), "403 before 415 before 400");
});

test("deletes through a symlinked agent directory, where the catalogue's paths are not real paths", { skip: process.platform === "win32" }, async () => {
  // macOS '/var' → '/private/var' and a symlinked '~/.pi' both put the agent
  // directory behind a link. The scanner builds session paths by joining the
  // path as given, so grouping against its realpath used to reject every
  // session and answer a false 404 on a project the sidebar was showing.
  const { realAgentDir, repo, session } = await fixture({ symlinkAgentDir: true });
  const file = await session(repo, "linked-agent-session");

  const projectKey = await projectKeyOf(repo);
  const { status, body } = await answer(await post({ projectKey }));

  assert.equal(status, 200);
  assert.equal(body.deletedSessions, 1);
  assert.equal(body.removedDirs, 1);
  assert.equal(existsSync(file), false);
  assert.equal(existsSync(join(realAgentDir, "sessions")), true, "the real sessions tree itself is left");
  assert.deepEqual(readdirSync(join(realAgentDir, "sessions")), [], "its project directory is gone");
});

test("unlinks a session file that is a symbolic link, leaving its target intact", { skip: process.platform === "win32" }, async () => {
  const { repo, external, dirFor } = await fixture();
  const externalTarget = join(external, "target-session.jsonl");
  await writeFile(externalTarget, line({ type: "session", version: 3, id: "linked-session", cwd: repo, timestamp }));
  const linkPath = join(dirFor(repo), "linked-session.jsonl");
  await mkdir(dirFor(repo), { recursive: true });
  await symlink(externalTarget, linkPath, "file");
  resetSessionScanIndexForTests();
  invalidateSessionListCache();

  const projectKey = await projectKeyOf(repo);
  const { status } = await answer(await post({ projectKey }));

  assert.equal(status, 200);
  assert.equal(existsSync(linkPath), false, "the link is removed");
  assert.equal(existsSync(externalTarget), true, "the file it pointed at survives: unlink never follows a link");
});

test("reports a session file it cannot remove and still deletes the project's other directories", async (t) => {
  if (process.platform === "win32" || process.getuid?.() === 0) {
    t.skip("a read-only directory does not stop root or Windows");
    return;
  }
  const { repo, worktree, dirFor, session } = await fixture();
  const lockedDir = dirFor(repo);
  const locked = await session(repo, "locked-session");
  const worktreeFile = await session(worktree, "worktree-session");
  // A directory with no write permission: unlink raises EACCES, not ENOENT.
  await chmod(lockedDir, 0o500);
  t.after(() => chmod(lockedDir, 0o700).catch(() => undefined));

  const projectKey = await projectKeyOf(repo);
  const { status, body } = await answer(await post({ projectKey }));

  assert.equal(status, 200);
  assert.equal(existsSync(locked), true, "what could not be removed is still there");
  assert.equal(existsSync(worktreeFile), false, "the project's other directory was still cleaned out");
  assert.equal(body.deletedSessions, 1, "only the session that went counts");
  assert.equal(body.removedDirs, 1);
  assert.ok(
    body.failures.some((failure) => failure.path === locked),
    "the failure names the file left behind",
  );
});

test("refuses a project whose session has an idle but live wrapper, and deletes nothing", async (t) => {
  const { repo, session } = await fixture();
  const idleFile = await session(repo, "idle-live", {}, "Open chat");
  const projectKey = await projectKeyOf(repo);

  // An idle-alive wrapper: its run finished, its chat tab is still open, and it
  // still owns the file. Deleting under it is what the refusal prevents.
  const previous = globalThis.__piSessions;
  globalThis.__piSessions = new Map([["idle-live", {
    get sessionId() { return "idle-live"; },
    get sessionFile() { return idleFile; },
    get cwd() { return repo; },
    isAlive: () => true,
    isRunning: () => false,
    inner: {
      sessionManager: {
        getHeader: () => ({ type: "session", id: "idle-live", cwd: repo, timestamp }),
        getEntries: () => [userEntry("idle-live-u1", "Open chat")],
        getSessionFile: () => idleFile,
        getSessionName: () => "Open chat",
      },
    },
  }]]);
  t.after(() => { globalThis.__piSessions = previous; });

  const { status, body } = await answer(await post({ projectKey }));

  assert.equal(status, 409);
  assert.equal(body.reason, "session-busy");
  assert.deepEqual(body.runningSessionTitles, ["Open chat"]);
  assert.equal(existsSync(idleFile), true, "the live wrapper's file is refused, not deleted under it");
});

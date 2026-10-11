import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { realpathSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";
import { promisify } from "node:util";
import { createJiti } from "jiti";

const execFileAsync = promisify(execFile);

// Real paths: `inferRemovedWorktree()` resolves the repo it infers, and the temp folder
// is a link on macOS.
const root = realpathSync(await mkdtemp(join(tmpdir(), "pi-web-models-worktree-")));
const agentDir = join(root, "agent");
const repo = join(root, "repo");
const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
const previousOffline = process.env.PI_OFFLINE;
process.env.PI_CODING_AGENT_DIR = agentDir;
// The list is served from the SDK's own data and the models.json below, so the route
// never reaches for the network here.
process.env.PI_OFFLINE = "1";

await mkdir(agentDir, { recursive: true });
await writeFile(join(agentDir, "models.json"), JSON.stringify({
  providers: {
    acme: {
      baseUrl: "https://example.invalid/v1",
      apiKey: "sk-test",
      api: "openai-completions",
      models: [{ id: "one", name: "Acme One" }],
    },
  },
}, null, 2));

// A worktree folder is `<repoRoot>-worktrees/<dir>` (what `addWorktree()` makes), and the
// sibling holding `.git` is the repo its removal is inferred back to.
async function initRepo(name) {
  const path = join(root, name);
  await execFileAsync("git", ["init", path]);
  return path;
}
await initRepo("repo");

const jiti = createJiti(import.meta.url, { alias: { "@": process.cwd() } });
const { allowFileRoot } = await jiti.import("../../../lib/file-access.ts");
const { GET } = await jiti.import("./route.ts");
// The repo of the removed worktree below is a project some session named, which is what
// makes it an allowed root; the fallback never adds one of its own.
allowFileRoot(repo);

after(async () => {
  if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
  if (previousOffline === undefined) delete process.env.PI_OFFLINE;
  else process.env.PI_OFFLINE = previousOffline;
  await rm(root, { recursive: true, force: true });
});

async function models(cwd) {
  const response = await GET(new Request(`http://localhost/api/models?cwd=${encodeURIComponent(cwd)}`, { headers: { host: "localhost" } }));
  return { status: response.status, body: await response.json() };
}

test("a removed worktree is listed from the repo it branched from", async () => {
  // A finished subagent run: its worktree is gone, its session still names it as the cwd.
  const removed = join(`${repo}-worktrees`, "pi-web-agent-abc");

  const fromRemoved = await models(removed);
  const fromRepo = await models(repo);

  assert.equal(fromRemoved.status, 200);
  // Not merely some list: the same one the repo answers, which is what a session that ran
  // without worktree isolation gets.
  assert.deepEqual(fromRemoved.body, fromRepo.body);
  assert.deepEqual(fromRemoved.body.modelList.map((m) => `${m.provider}:${m.id}`), ["acme:one"], "an empty list would make the comparison say nothing");
});

test("the repo a removed worktree falls back to is authorized as any other cwd", async () => {
  // A repo no session and no `allowFileRoot()` ever named.
  const unknown = await initRepo("unknown");
  const denied = await models(join(`${unknown}-worktrees`, "pi-web-agent-abc"));
  assert.equal(denied.status, 403);
  assert.deepEqual(denied.body, { error: "Access denied" });

  // Granting the worktree folder — what `addWorktree()` does for a live one — is not a
  // grant for the repo: the folder the fallback answers from is the one checked.
  const granted = join(`${unknown}-worktrees`, "granted-only");
  allowFileRoot(granted);
  assert.equal((await models(granted)).status, 403);
});

test("a missing folder that is not a removed worktree of a repo is refused as before", async () => {
  const missing = join(root, "never-existed");
  const gone = await models(missing);
  assert.equal(gone.status, 400);
  assert.equal(gone.body.error, `Directory does not exist: ${missing}`);

  // The `-worktrees` name alone is not enough: there has to be a repo to fall back to.
  const orphan = await models(join(`${root}-worktrees`, "orphan"));
  assert.equal(orphan.status, 400);
  assert.equal(orphan.body.error, `Directory does not exist: ${join(`${root}-worktrees`, "orphan")}`);
});

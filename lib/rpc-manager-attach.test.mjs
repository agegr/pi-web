import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const rpcManagerSource = () => readFile(new URL("./rpc-manager.ts", import.meta.url), "utf8");

test("a registry entry means attached, so ephemeral work stays out of it", async () => {
  const source = await rpcManagerSource();
  const startupSource = source.slice(source.indexOf("export async function startRpcSession"));

  // Reusing an attached session for utility work is fine; the reverse would let
  // a throwaway satisfy a later attach and skip session_start(reason:"resume").
  assert.match(startupSource, /if \(!options\.ephemeral\) \{\s*const existing = registry\.get\(sessionId\)/);
  assert.match(startupSource, /if \(!options\.ephemeral\) \{\s*const claimedCwd = sessionCwd;/);
  assert.match(startupSource, /if \(options\.ephemeral\) return starting;/);
});

test("only an attach claims the working directory, and destroy releases it", async () => {
  const source = await rpcManagerSource();
  const startupSource = source.slice(source.indexOf("export async function startRpcSession"));

  // An incidental start (fork button, SSE reconnect) needs an AgentSession but
  // has reconciled nothing, so it must not claim or report itself as active.
  assert.match(
    startupSource,
    /if \(options\.attach\) \{\s*wrapper\.markAttached\(\);\s*claimWorktree\(claimedCwd, realSessionId\);/,
  );
  assert.match(startupSource, /registry\.delete\(realSessionId\);\s*releaseWorktree\(claimedCwd, realSessionId\)/);

  // Occupancy follows the claim, not mere registry membership.
  const occupants = source.slice(source.indexOf("export function getWorktreeOccupants"));
  assert.match(occupants, /if \(!wrapper\?\.isAttached\(\)\) continue/);
});

test("attaching over an unattached session restarts it so resume actually fires", async () => {
  const route = await readFile(
    new URL("../app/api/sessions/[id]/attach/route.ts", import.meta.url),
    "utf8",
  );

  // startRpcSession reuses live wrappers, so reusing an incidental one would
  // claim the directory without ever emitting session_start(reason:"resume").
  assert.match(route, /if \(existing\?\.isAlive\(\)\) \{[\s\S]{0,320}await existing\.shutdown\(\);/);
  assert.match(route, /if \(existing\?\.isAttached\(\)\)/);
});

test("only an in-flight run blocks an attach", async () => {
  const source = await rpcManagerSource();
  const blocking = source.slice(source.indexOf("export function findBlockingOccupant"));

  // An idle co-tenant is reported but does not block: several conversations
  // against one checkout is a supported workflow.
  assert.match(blocking, /\.find\(\(occupant\) => occupant\.running\) \?\? null/);
});

test("ownership is keyed by resolved path so aliases cannot bypass it", async () => {
  const source = await rpcManagerSource();

  for (const fn of ["function claimWorktree", "function releaseWorktree"]) {
    const body = source.slice(source.indexOf(fn), source.indexOf("}", source.indexOf(fn)));
    assert.match(body, /normalizeRpcCwd\(cwd\)/, `${fn} must normalize its key`);
  }
  const occupants = source.slice(source.indexOf("export function getWorktreeOccupants"));
  assert.match(occupants, /normalizeRpcCwd\(cwd\)/);
});

test("extension-driven switches are gated by the same ownership check", async () => {
  const source = await rpcManagerSource();
  const finish = source.slice(source.indexOf("private async finishSessionReplacement("));
  const checkIndex = finish.indexOf("findBlockingOccupant(");
  const switchEventIndex = finish.indexOf('type: "session_switch"');
  const teardownIndex = finish.indexOf("this.teardownForReplacement(");

  assert.ok(checkIndex >= 0, "the switch path must consult the ownership index");
  assert.ok(checkIndex < switchEventIndex, "block before telling browsers to follow");
  assert.ok(checkIndex < teardownIndex, "block before tearing the current session down");
  // Both ends of the switch are being replaced, so neither counts as an occupant.
  assert.match(finish, /findBlockingOccupant\(cwd, \[this\.inner\.sessionId, sessionId\]\)/);
});

test("title generation borrows a throwaway session and disposes it", async () => {
  const route = await readFile(
    new URL("../app/api/sessions/[id]/auto-name/route.ts", import.meta.url),
    "utf8",
  );

  assert.match(route, /startRpcSession\(id, filePath, undefined, \{ ephemeral: true \}\)/);
  assert.match(route, /finally \{\s*if \(!attached\) session\.destroy\(\);/);
  // An attach may land while the model works; the attached wrapper owns the file.
  assert.match(route, /const target = attached \? session : \(getRpcSession\(id\) \?\? session\)/);
});

test("the attach route resumes rather than starting cold", async () => {
  const route = await readFile(
    new URL("../app/api/sessions/[id]/attach/route.ts", import.meta.url),
    "utf8",
  );

  // reason:"resume" is what makes extensions reconcile the checkout.
  assert.match(route, /sessionStartEvent: \{ type: "session_start", reason: "resume" \}/);
  assert.match(route, /findBlockingOccupant\(cwd, \[id\]\)/);
  assert.match(route, /status: 409/);
  assert.match(route, /await session\.waitUntilReady\(\)/);
  // Detaching must not abandon a run midway.
  assert.match(route, /if \(session\.isRunning\(\)\)/);
});

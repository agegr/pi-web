import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("RPC session startup preloads extension-registered providers before restoring models", async () => {
  const source = await readFile(new URL("./rpc-manager.ts", import.meta.url), "utf8");
  const startupSource = source.slice(source.indexOf("export async function startRpcSession"));

  assert.match(startupSource, /createAgentSessionServices\(/);
  assert.match(startupSource, /createAgentSessionFromServices\(/);
  assert.doesNotMatch(startupSource, /await createAgentSession\(/);
});

test("custom extension UI receives the fixed headless terminal facade", async () => {
  const source = await readFile(new URL("./rpc-manager.ts", import.meta.url), "utf8");
  const customUiSource = source.slice(
    source.indexOf("private requestExtensionCustomUi"),
    source.indexOf("private requestExtensionUi"),
  );

  assert.match(customUiSource, /createHeadlessCustomUiTui\(/);
  assert.match(customUiSource, /width,/);
});

test("web authentication failures do not control AgentSession lifecycle", async () => {
  const rpcSource = await readFile(new URL("./rpc-manager.ts", import.meta.url), "utf8");
  const authSources = await Promise.all([
    readFile(new URL("../proxy.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/auth/logout/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/auth/password/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/agent/[id]/events/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/pi-web-auth.ts", import.meta.url), "utf8"),
  ]);

  assert.match(rpcSource, /export function getRpcSession\(sessionId: string\)/);
  assert.match(rpcSource, /withFinalRunningNotification\(\(\) => this\.inner\.abort\(\)\)/);
  assert.match(rpcSource, /export function getRunningRpcSessionIds\(\)/);
  assert.match(authSources[3], /req\.signal\?\.addEventListener\("abort", cleanup\)/);
  assert.doesNotMatch(authSources.slice(0, 3).concat(authSources[4]).join("\n"), /getRpcSession|destroy\(|\.abort\(|shutdown\(|send\(/);
});

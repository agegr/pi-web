import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";
import { gunzipSync } from "node:zlib";
import { createJiti } from "jiti";

// Isolate the runtime registry so this read-only route test never creates a real agent.
const directory = mkdtempSync(join(tmpdir(), "pi-web-list-route-"));
const stateKey = "__piWebListRouteTest";
const readerStub = join(directory, "reader.mjs");
const rpcStub = join(directory, "rpc.mjs");
const indexStub = join(directory, "index.mjs");
writeFileSync(readerStub, `
const state = () => globalThis.${stateKey};
export const getSessionListVersion = () => state().version;
export const listAllSessions = async (options) => {
  state().calls.push(options);
  options.onTiming?.("session-scan", 1);
  return state().load();
};
export const attachSessionProjectInfo = async (sessions) => sessions;
export const mergeSessionLists = (disk, live) => state().merge(disk, live);
`);
writeFileSync(rpcStub, `
const state = () => globalThis.${stateKey};
export const getRpcSessionInfos = () => state().runtime;
export const getRunningRpcSessionIds = () => ["running"];
export const getCompletionNotificationSuppressedRpcSessionIds = () => ["child"];
`);
writeFileSync(indexStub, `
export const refreshSessionIndexInBackground = () => { globalThis.${stateKey}.validations += 1; };
`);
after(() => {
  delete globalThis[stateKey];
  rmSync(directory, { recursive: true, force: true });
});
const actual = createJiti(import.meta.url, { alias: { "@": process.cwd() } });
const { mergeSessionLists } = await actual.import("../../../lib/session-reader.ts");
const jiti = createJiti(import.meta.url, {
  moduleCache: false,
  alias: {
    "@/lib/session-reader": readerStub,
    "@/lib/rpc-manager": rpcStub,
    "@/lib/session-index": indexStub,
    "@": process.cwd(),
  },
});
const { GET } = await jiti.import("./route.ts");
const { GET: running } = await jiti.import("../agent/running/route.ts");

function setup() {
  const state = { version: 7, calls: [], validations: 0, runtime: [], load: async () => [], merge: mergeSessionLists };
  globalThis[stateKey] = state;
  return state;
}

test("列表请求只加载一次，保留计时、版本和通知字段", async () => {
  const state = setup();
  const response = await GET(new Request("http://localhost/api/sessions?force=1"));
  assert.equal(response.status, 200);
  assert.equal(state.calls.length, 1);
  assert.equal(state.calls[0].force, true);
  assert.match(response.headers.get("Server-Timing"), /session-scan;dur=/);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.equal(response.headers.get("Vary"), "Accept-Encoding");
  assert.deepEqual(await response.json(), {
    sessions: [], sessionListVersion: 7,
    runningSessionIds: ["running"], completionNotificationSuppressedSessionIds: ["child"],
  });
});

test("客户端支持 gzip 时压缩大响应并保持 JSON 内容一致", async () => {
  const state = setup();
  state.load = async () => [{ id: "large", name: "x".repeat(4096) }];
  state.merge = disk => disk;

  const compressed = await GET(new Request("http://localhost/api/sessions", {
    headers: { "Accept-Encoding": "br, gzip" },
  }));
  assert.equal(compressed.status, 200);
  assert.equal(compressed.headers.get("Content-Encoding"), "gzip");
  assert.equal(compressed.headers.get("Vary"), "Accept-Encoding");
  assert.match(compressed.headers.get("Server-Timing"), /compress;dur=/);
  const decoded = JSON.parse(gunzipSync(Buffer.from(await compressed.arrayBuffer())).toString("utf8"));
  assert.equal(decoded.sessions[0].name.length, 4096);

  const uncompressed = await GET(new Request("http://localhost/api/sessions", {
    headers: { "Accept-Encoding": "gzip;q=0, *;q=1" },
  }));
  assert.equal(uncompressed.headers.get("Content-Encoding"), null);
  assert.equal((await uncompressed.json()).sessions[0].name.length, 4096);
});

test("扫描期间发生变化时不把旧结果标记成新版本", async () => {
  const state = setup();
  let release;
  state.load = () => new Promise(resolve => { release = resolve; });
  const pending = GET(new Request("http://localhost/api/sessions"));
  assert.equal(state.calls.length, 1);
  assert.equal(state.calls[0].force, false);
  state.version = 8;
  release([]);
  assert.equal((await (await pending).json()).sessionListVersion, 7);
});

test("列表失败仍返回不可缓存的错误和请求计时", async () => {
  const state = setup();
  state.load = async () => { throw new Error("fixture failure"); };
  const response = await GET(new Request("http://localhost/api/sessions"));
  assert.equal(response.status, 500);
  assert.equal(state.calls.length, 1);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.match(response.headers.get("Server-Timing"), /total;dur=/);
  assert.match((await response.json()).error, /fixture failure/);
});

test("运行态轮询只调度后台验证，不等待目录列表加载", async () => {
  const state = setup();
  state.load = () => { throw new Error("运行态响应不能等待目录加载"); };
  const response = await running();
  assert.equal(response.status, 200);
  assert.equal(state.validations, 1);
  assert.equal(state.calls.length, 0);
  assert.deepEqual(await response.json(), {
    sessionListVersion: 7, runningSessionIds: ["running"], completionNotificationSuppressedSessionIds: ["child"],
  });
});

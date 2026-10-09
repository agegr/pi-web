import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { GET } = await jiti.import("./route.ts");
const { cacheSessionPath, invalidateSessionPathCache, invalidateSessionManagerCache } = await jiti.import("@/lib/session-reader.ts");
const fence = (value) => `\`\`\`pi-html id="demo"\n<button>${value}</button>\n\`\`\``;

test("artifact index covers compacted/paged history and reads only the selected ancestor branch", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'pi-web-artifacts-'));
  const file = join(dir, 'session.jsonl');
  const id = 'artifact-route-fixture';
  const timestamp = new Date().toISOString();
  const assistant = (id, parentId, text) => ({ type: 'message', id, parentId, timestamp, message: { role: 'assistant', content: [{ type: 'text', text }], provider: 'test', model: 'test', timestamp: Date.now() } });
  const entries = [{ type: 'session', version: 3, id, timestamp, cwd: dir }, assistant('first', null, fence('first'))];
  for (let index = 0; index < 105; index++) entries.push({ type: 'message', id: 'filler-' + index, parentId: entries.at(-1).id, timestamp, message: { role: 'user', content: 'ordinary text' } });
  entries.push(assistant('second', entries.at(-1).id, fence('second')));
  entries.push({ type: 'compaction', id: 'compact', parentId: 'second', timestamp, summary: 'summary', firstKeptEntryId: 'second', tokensBefore: 10000 });
  entries.push(assistant('sibling', 'first', fence('other branch')));
  const original = entries.map((entry) => JSON.stringify(entry)).join('\n') + '\n';
  writeFileSync(file, original);
  cacheSessionPath(id, file);
  t.after(() => { invalidateSessionPathCache(id); invalidateSessionManagerCache(file); rmSync(dir, { recursive: true, force: true }); });
  const get = (query) => GET(new Request(`http://localhost/api/sessions/${id}/artifacts?${query}`), { params: Promise.resolve({ id }) });
  const response = await get('leafId=compact');
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  const history = (await response.json()).versions;
  assert.deepEqual(history.map((item) => item.entryId), ['first', 'second']);
  assert.equal(history[0].code, undefined, 'Index returns metadata, not all historical HTML');
  const old = await get('leafId=compact&key=first%3A0%3A0');
  assert.equal((await old.json()).version.code, '<button>first</button>');
  assert.equal((await get('leafId=compact&key=sibling%3A0%3A0')).status, 404);
  assert.equal((await get('leafId=missing')).status, 404);
  assert.deepEqual((await (await get('leafId=null')).json()).versions, []);
  assert.deepEqual((await (await get('')).json()).versions.map((item) => item.entryId), ['first', 'sibling']);
  assert.equal(readFileSync(file, 'utf8'), original, 'Browsing never rewrites or appends artifact state');
});

test("artifact reads prefer the open wrapper's in-memory SessionManager", async (t) => {
  const id = 'in-memory-artifact-fixture';
  const previous = globalThis.__piSessions;
  const version = { type: 'message', id: 'live-entry', message: { role: 'assistant', content: [{ type: 'text', text: fence('live') }] } };
  globalThis.__piSessions = new Map([[id, { isAlive: () => true, inner: { sessionManager: {
    getLeafId: () => version.id, getEntry: (key) => key === version.id ? version : undefined, getBranch: () => [version],
  } } }]]);
  t.after(() => { globalThis.__piSessions = previous; });
  const response = await GET(new Request('http://localhost/api/sessions/live/artifacts'), { params: Promise.resolve({ id }) });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).versions[0].key, 'live-entry:0:0');
});

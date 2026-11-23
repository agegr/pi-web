import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { appendFile, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  alias: { "@": process.cwd() },
  interopDefault: true,
  moduleCache: false,
});
const { GET } = await jiti.import("./[id]/entries/route.ts");
const {
  cacheSessionPath,
  invalidateSessionPathCache,
  invalidateSessionManagerCache,
  invalidateSessionListCache,
} = await jiti.import("../../../lib/session-reader.ts");
const timestamp = "2026-01-01T00:00:00.000Z";
const entry = (id, parentId, fields) => ({ id, parentId, timestamp, ...fields });
const custom = (id, parentId, customType = "test:checkpoint") => entry(id, parentId, {
  type: "custom", customType, data: { tree: id },
});
const history = [
  entry("u1", null, { type: "message", message: { role: "user", content: "first" } }),
  custom("cp1", "u1"),
  custom("store", "cp1", "test:store"),
  entry("a1", "store", { type: "message", message: { role: "assistant", content: [] } }),
  custom("cp2", "a1"),
  entry("u2", "u1", { type: "message", message: { role: "user", content: "sibling branch" } }),
  custom("cp3", "u2"),
  entry("hidden", "cp3", {
    type: "custom_message", customType: "test:hidden", content: "hidden message", display: false,
  }),
];

async function fixture(t, { live = false, persist = true, entries = history } = {}) {
  const dir = await mkdtemp(join(tmpdir(), "pi-web-custom-entries-"));
  const id = randomUUID();
  const filePath = join(dir, `2026-01-01T00-00-00-000Z_${id}.jsonl`);
  const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
  const previousRegistry = globalThis.__piSessions;
  process.env.PI_CODING_AGENT_DIR = dir;
  globalThis.__piSessions = new Map();
  invalidateSessionListCache();
  t.after(async () => {
    if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
    globalThis.__piSessions = previousRegistry;
    invalidateSessionPathCache(id);
    invalidateSessionManagerCache(filePath);
    invalidateSessionListCache();
    await rm(dir, { recursive: true, force: true });
  });
  if (persist) {
    await writeFile(filePath, [
      { type: "session", version: 3, id, timestamp, cwd: dir },
      ...history,
    ].map((value) => JSON.stringify(value)).join("\n") + "\n");
  }
  cacheSessionPath(id, filePath);
  if (live) {
    globalThis.__piSessions.set(id, {
      isAlive: () => true,
      inner: { sessionManager: {
        getEntries: () => entries,
        getLeafId: () => entries.at(-1)?.id ?? null,
      } },
    });
  }
  const read = async (query = "", sessionId = id) => {
    const response = await GET(
      new Request(`http://localhost/api/sessions/${sessionId}/entries${query}`),
      { params: Promise.resolve({ id: sessionId }) },
    );
    return { response, body: await response.json() };
  };
  return { id, filePath, read };
}

test("reads custom entries from all branches without activating a dormant session", async (t) => {
  const { id, read } = await fixture(t);
  const { response, body } = await read();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.deepEqual(body, {
    entries: history.filter((value) => value.type === "custom"),
    leafId: "hidden",
    nextAfter: "hidden",
    hasMore: false,
  });
  assert.equal(globalThis.__piSessions.has(id), false);
});

test("filters exact custom types, including repeated customType parameters", async (t) => {
  const { read } = await fixture(t);
  assert.deepEqual((await read("?customType=test%3Acheckpoint")).body.entries.map(({ id }) => id), ["cp1", "cp2", "cp3"]);
  assert.deepEqual((await read("?customType=test%3Acheckpoint&customType=test%3Astore")).body.entries.map(({ id }) => id), ["cp1", "store", "cp2", "cp3"]);
  assert.deepEqual((await read("?customType=test")).body.entries, []);
});

test("pages in append order with an exclusive cursor, not parent-chain order", async (t) => {
  const { read } = await fixture(t);
  const first = await read("?customType=test%3Acheckpoint&limit=1");
  assert.equal(first.response.status, 200);
  assert.deepEqual(first.body.entries.map(({ id }) => id), ["cp1"]);
  assert.equal(first.body.hasMore, true);
  const second = await read(`?customType=test%3Acheckpoint&limit=1&after=${first.body.nextAfter}`);
  assert.deepEqual(second.body.entries.map(({ id }) => id), ["cp2"]);
  assert.equal(second.body.hasMore, true);
  const third = await read(`?customType=test%3Acheckpoint&limit=1&after=${second.body.nextAfter}`);
  assert.deepEqual(third.body.entries.map(({ id }) => id), ["cp3"]);
  assert.equal(third.body.hasMore, false);
  assert.equal(third.body.nextAfter, "hidden");
});

test("accepts cursors from non-custom entries and advances across unmatched entries", async (t) => {
  const { read } = await fixture(t);
  assert.deepEqual((await read("?after=a1")).body.entries.map(({ id }) => id), ["cp2", "cp3"]);
  assert.deepEqual((await read("?customType=absent&after=cp3")).body, {
    entries: [], leafId: "hidden", nextAfter: "hidden", hasMore: false,
  });
  assert.deepEqual((await read("?after=hidden")).body, {
    entries: [], leafId: "hidden", nextAfter: "hidden", hasMore: false,
  });
});

test("a saved cursor recovers appends made while a client was disconnected", async (t) => {
  const { filePath, read } = await fixture(t);
  const first = (await read("?customType=test%3Acheckpoint")).body;
  const appended = custom("cp4", "cp1");
  await appendFile(filePath, JSON.stringify(appended) + "\n");
  const { response, body } = await read(`?customType=test%3Acheckpoint&after=${first.nextAfter}`);
  assert.equal(response.status, 200);
  assert.deepEqual(body, {
    entries: [appended], leafId: "cp4", nextAfter: "cp4", hasMore: false,
  });
});

test("reads live entries ahead of disk and supports an unsaved runtime", async (t) => {
  for (const persist of [true, false]) {
    await t.test(`persisted=${persist}`, async (t) => {
      const entries = [...history, custom("live", "hidden")];
      const { read } = await fixture(t, { live: true, persist, entries });
      const { response, body } = await read("?after=hidden");
      assert.equal(response.status, 200);
      assert.deepEqual(body, {
        entries: [entries.at(-1)], leafId: "live", nextAfter: "live", hasMore: false,
      });
    });
  }
});

test("ignores a closing wrapper and reads the saved entries", async (t) => {
  const { id, read } = await fixture(t);
  globalThis.__piSessions.set(id, {
    isAlive: () => false,
    get inner() { throw new Error("closing wrapper must not be read"); },
  });
  const { response, body } = await read();
  assert.equal(response.status, 200);
  assert.deepEqual(body.entries, history.filter((value) => value.type === "custom"));
});

test("uses a default page of 100 and permits at most 1000 entries", async (t) => {
  const entries = Array.from({ length: 1001 }, (_, index) => custom(`c${index}`, index ? `c${index - 1}` : null));
  const { read } = await fixture(t, { live: true, persist: false, entries });
  assert.equal((await read()).body.entries.length, 100);
  const page = await read("?limit=1000");
  assert.equal(page.response.status, 200);
  assert.equal(page.body.entries.length, 1000);
  assert.equal(page.body.hasMore, true);
});

test("rejects invalid limits, empty selectors and unknown cursors instead of silently restarting", async (t) => {
  const { read } = await fixture(t);
  for (const query of ["?limit=", "?limit=0", "?limit=-1", "?limit=1.5", "?limit=no", "?limit=1001", "?after=", "?after=unknown", "?customType="]) {
    const { response, body } = await read(query);
    assert.equal(response.status, 400, query);
    assert.equal(typeof body.error, "string", query);
  }
});

test("returns an empty snapshot for an empty runtime and 404 for a missing session", async (t) => {
  const { read } = await fixture(t, { live: true, persist: false, entries: [] });
  assert.deepEqual((await read()).body, {
    entries: [], leafId: null, nextAfter: null, hasMore: false,
  });
  assert.equal((await read("", randomUUID())).response.status, 404);
});

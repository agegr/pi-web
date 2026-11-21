import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  alias: {
    "@/": `${path.resolve(import.meta.dirname, "../../..")}/`,
  },
});

const { GET } = await jiti.import("./route.ts");
const { invalidateSessionListCache } = await jiti.import("@/lib/session-reader");

test("GET /api/sessions returns ETag and 304 Not Modified when If-None-Match matches", async () => {
  const first = await GET(new Request("http://localhost/api/sessions"));
  assert.equal(first.status, 200);
  const etag = first.headers.get("etag");
  assert.ok(etag, "expected ETag header on 200 response");
  assert.equal(first.headers.get("cache-control"), "no-store");

  const second = await GET(
    new Request("http://localhost/api/sessions", {
      headers: { "If-None-Match": etag },
    }),
  );
  assert.equal(second.status, 304);
  assert.equal(second.headers.get("etag"), etag);
  assert.equal(await second.text(), "");
});

test("GET /api/sessions distinguishes summary=1 ETag from full ETag and bypasses 304 on force=1", async () => {
  const summaryRes = await GET(new Request("http://localhost/api/sessions?summary=1"));
  assert.equal(summaryRes.status, 200);
  const summaryEtag = summaryRes.headers.get("etag");
  assert.ok(summaryEtag);

  const fullWithSummaryEtag = await GET(
    new Request("http://localhost/api/sessions", {
      headers: { "If-None-Match": summaryEtag },
    }),
  );
  assert.equal(fullWithSummaryEtag.status, 200);
  const fullEtag = fullWithSummaryEtag.headers.get("etag");
  assert.ok(fullEtag);
  assert.notEqual(fullEtag, summaryEtag);

  const forced = await GET(
    new Request("http://localhost/api/sessions?force=1", {
      headers: { "If-None-Match": fullEtag },
    }),
  );
  assert.equal(forced.status, 200);
});

test("GET /api/sessions invalidates ETag when sessionListVersion changes", async () => {
  const first = await GET(new Request("http://localhost/api/sessions"));
  assert.equal(first.status, 200);
  const etag = first.headers.get("etag");
  assert.ok(etag);

  invalidateSessionListCache();

  const afterBump = await GET(
    new Request("http://localhost/api/sessions", {
      headers: { "If-None-Match": etag },
    }),
  );
  assert.equal(afterBump.status, 200);
  const nextEtag = afterBump.headers.get("etag");
  assert.ok(nextEtag);
  assert.notEqual(nextEtag, etag);
});

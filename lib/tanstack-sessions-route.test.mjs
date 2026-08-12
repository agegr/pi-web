import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createJiti } from "jiti";

const nextSource = await readFile(new URL("../app/api/sessions/route.ts", import.meta.url), "utf8");
const adapterSource = await readFile(new URL("../src/routes/api/sessions.ts", import.meta.url), "utf8");
const jiti = createJiti(import.meta.url, { alias: { "@": process.cwd() }, moduleCache: false });

test("sessions handler uses only standard Web response APIs", () => {
  assert.doesNotMatch(nextSource, /next\/server|NextResponse/);
  assert.match(nextSource, /Response\.json/);
});

test("TanStack sessions route delegates to the existing handler", () => {
  assert.match(adapterSource, /GET: \(\{ request \}\) => getSessions\(request\)/);
});

test("sessions handler preserves JSON shape and cache headers", async () => {
  const { GET } = await jiti.import("../app/api/sessions/route.ts");
  const response = await GET(new Request("http://localhost/api/sessions?force=1"));
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.ok(Array.isArray(body.sessions));
  assert.ok(Array.isArray(body.runningSessionIds));
});

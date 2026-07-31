import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("API key saves go through omp's AuthStorage, not a network catalog refresh", async () => {
  const source = await readFile(new URL("../app/api/auth/api-key/[provider]/route.ts", import.meta.url), "utf-8");

  // omp keeps credentials in `agent.db`; writing through AuthStorage shares the
  // CLI's store and lock, and avoids the unbounded catalog refresh a login()
  // call would trigger.
  assert.doesNotMatch(source, /\.login\(/);
  assert.match(source, /authStorage\.set\(provider, \{ type: "api_key"/);
  assert.match(source, /authStorage\.remove\(provider\)/);
});

test("the API key status endpoint never returns the stored key", async () => {
  const source = await readFile(new URL("../app/api/auth/api-key/[provider]/route.ts", import.meta.url), "utf-8");
  const getSource = source.slice(source.indexOf("export async function GET"), source.indexOf("export async function POST"));

  assert.doesNotMatch(getSource, /getApiKey|peekApiKey|credential\.key/);
  assert.match(getSource, /configured: authStorage\.hasAuth\(provider\)/);
});

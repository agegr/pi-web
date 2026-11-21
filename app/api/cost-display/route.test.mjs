import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createJiti } from "jiti";

const agentDir = await mkdtemp(path.join(tmpdir(), "piweb-cost-display-"));
const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
process.env.PI_CODING_AGENT_DIR = agentDir;
test.after(async () => {
  if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
  await rm(agentDir, { recursive: true, force: true });
});

const jiti = createJiti(import.meta.url, {
  alias: { "@": path.resolve(import.meta.dirname, "../../..") },
});
const { GET, PUT } = await jiti.import("./route.ts");

const settingsPath = path.join(agentDir, "settings.json");

function putRequest(body) {
  return new Request("http://127.0.0.1:30141/api/cost-display", {
    method: "PUT",
    headers: { "Content-Type": "application/json", Host: "127.0.0.1:30141" },
    body: JSON.stringify(body),
  });
}

test("GET returns default USD settings when no settings.json exists", async () => {
  const res = await GET();
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { costCurrency: "USD", usdToCnyRate: 7.2 });
  await assert.rejects(readFile(settingsPath, "utf8"), { code: "ENOENT" });
});

test("PUT persists ui.costCurrency and ui.usdToCnyRate while keeping other settings", async () => {
  await writeFile(settingsPath, JSON.stringify({ defaultModel: "m", ui: { other: true } }));

  const res = await PUT(putRequest({ costCurrency: "CNY", usdToCnyRate: 7.25 }));
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { costCurrency: "CNY", usdToCnyRate: 7.25 });

  assert.deepEqual(JSON.parse(await readFile(settingsPath, "utf8")), {
    defaultModel: "m",
    ui: { other: true, costCurrency: "CNY", usdToCnyRate: 7.25 },
  });
});

test("PUT rejects invalid currency or exchange rate", async () => {
  const badCurrency = await PUT(putRequest({ costCurrency: "EUR", usdToCnyRate: 7.2 }));
  assert.equal(badCurrency.status, 400);

  const badRate = await PUT(putRequest({ costCurrency: "CNY", usdToCnyRate: 0 }));
  assert.equal(badRate.status, 400);
});

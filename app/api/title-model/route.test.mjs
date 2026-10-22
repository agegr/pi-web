import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const agentDir = await mkdtemp(path.join(os.tmpdir(), "pi-web-title-model-route-"));
const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
process.env.PI_CODING_AGENT_DIR = agentDir;
test.after(async () => {
  if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
  await rm(agentDir, { recursive: true, force: true });
});

const jiti = createJiti(import.meta.url, {
  alias: { "@": process.cwd() },
  interopDefault: true,
  moduleCache: false,
});
const { GET, PUT } = await jiti.import("./route.ts");

const preferencePath = path.join(agentDir, "pi-web-title-model.json");

function put(body, headers = { host: "localhost", "Content-Type": "application/json" }) {
  return PUT(new Request("http://localhost/api/title-model", {
    method: "PUT",
    headers,
    body: typeof body === "string" ? body : JSON.stringify(body),
  }));
}

test("keeps the instance's title model until a choice replaces it whole", async () => {
  assert.deepEqual(await (await GET()).json(), { titleModel: null });

  const model = await put({ titleModel: { provider: "cheap", modelId: "small", thinkingLevel: "high" } });
  assert.equal(model.status, 200);
  assert.deepEqual(await model.json(), { titleModel: { provider: "cheap", modelId: "small", thinkingLevel: "high" } });
  assert.deepEqual(JSON.parse(await readFile(preferencePath, "utf8")), {
    provider: "cheap",
    modelId: "small",
    thinkingLevel: "high",
  });
  assert.deepEqual(await (await GET()).json(), {
    titleModel: { provider: "cheap", modelId: "small", thinkingLevel: "high" },
  });

  // A level without a model names the session's own: the old model choice goes.
  const level = await put({ titleModel: { thinkingLevel: "medium" } });
  assert.deepEqual(await level.json(), { titleModel: { thinkingLevel: "medium" } });

  // Nothing to prefer is no file at all: naming follows the session's own model.
  const cleared = await put({ titleModel: null });
  assert.deepEqual(await cleared.json(), { titleModel: null });
  assert.equal(existsSync(preferencePath), false);
  assert.deepEqual(await (await GET()).json(), { titleModel: null });
});

test("drops a field that is not one, and refuses a body that is no choice at all", async () => {
  await writeFile(preferencePath, JSON.stringify({ provider: "cheap", modelId: "small" }));

  // A field that is not a usable string is dropped; the rest of the choice stands.
  assert.deepEqual(await (await put({ titleModel: { provider: 5, thinkingLevel: "max" } })).json(), {
    titleModel: { thinkingLevel: "max" },
  });

  assert.equal((await put({ titleModel: "cheap/small" })).status, 400);
  assert.equal((await put({ titleModel: ["cheap"] })).status, 400);
  // No `titleModel` key at all must not clear a stored choice.
  assert.equal((await put({})).status, 400);
  assert.equal((await put("{")).status, 400);
  assert.equal((await put({ titleModel: { provider: "cheap" } }, { host: "localhost", "Content-Type": "text/plain" })).status, 415);
  assert.equal((await put(
    { titleModel: { provider: "cheap" } },
    { host: "localhost", origin: "https://evil.example", "Content-Type": "application/json" },
  )).status, 403);
  assert.deepEqual(await (await GET()).json(), { titleModel: { thinkingLevel: "max" } });
});

import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";
import { createJiti } from "jiti";

const originalAgentDir = process.env.PI_CODING_AGENT_DIR;
const testAgentDir = await mkdtemp(join(tmpdir(), "pi-web-title-settings-route-"));
process.env.PI_CODING_AGENT_DIR = testAgentDir;

const jiti = createJiti(import.meta.url, {
  alias: { "@": process.cwd() },
  interopDefault: true,
  moduleCache: false,
});
const { GET, PUT } = await jiti.import("./route.ts");

after(async () => {
  if (originalAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = originalAgentDir;
  await rm(testAgentDir, { recursive: true, force: true });
});

function request(body, contentType = "application/json") {
  return new Request("http://localhost/api/session-title/settings", {
    method: "PUT",
    headers: { "Content-Type": contentType, Host: "localhost" },
    body: JSON.stringify(body),
  });
}

test("title settings route defaults to inherit and persists a selected model", async () => {
  let response = await GET();
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { model: "inherit" });

  response = await PUT(request({ model: "google/gemini-2.5-flash" }));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { model: "google/gemini-2.5-flash" });

  const stored = JSON.parse(await readFile(join(testAgentDir, "settings.json"), "utf8"));
  assert.equal(stored.sessionTitleModel, "google/gemini-2.5-flash");

  response = await PUT(request({ model: "inherit" }));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { model: "inherit" });
});

test("title settings route validates request payload", async () => {
  const invalidType = await PUT(request({ model: 123 }));
  assert.equal(invalidType.status, 400);

  const missingHeader = await PUT(request({ model: "fast" }, "text/plain"));
  assert.equal(missingHeader.status, 415);
});

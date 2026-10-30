import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const agentDir = await mkdtemp(path.join(os.tmpdir(), "pi-web-settings-route-"));
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
const { GET, PUT, dynamic } = await jiti.import("./route.ts");
const { resetPiWebSettingsCacheForTests } = await jiti.import("../../../../lib/pi-web-settings.ts");
const { DEFAULT_PI_WEB_SETTINGS } = await jiti.import("../../../../lib/pi-web-settings-shared.ts");

const settingsPath = path.join(agentDir, "pi-web-settings.json");
const JSON_HEADERS = { host: "localhost", "Content-Type": "application/json" };

function put(body, headers = JSON_HEADERS) {
  return PUT(new Request("http://localhost/api/pi-web-settings", {
    method: "PUT",
    headers,
    body: typeof body === "string" ? body : JSON.stringify(body),
  }));
}

async function okSettings(response) {
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  return (await response.json()).settings;
}

async function reset() {
  await rm(settingsPath, { force: true });
  resetPiWebSettingsCacheForTests();
}

test("GET answers the defaults when nothing was saved", async () => {
  await reset();
  assert.equal(dynamic, "force-dynamic");
  assert.deepEqual(await okSettings(await GET()), { ...DEFAULT_PI_WEB_SETTINGS });
});

test("PUT stores one setting at a time and answers all of them", async () => {
  await reset();
  assert.deepEqual(await okSettings(await put({ enterSendMode: "ctrlEnter" })), {
    ...DEFAULT_PI_WEB_SETTINGS,
    enterSendMode: "ctrlEnter",
  });
  assert.deepEqual(await okSettings(await put({ thinkingExpandedDefault: true, quoteSelection: true })), {
    thinkingExpandedDefault: true,
    quoteSelection: true,
    enterSendMode: "ctrlEnter",
  });
  // One file for the whole server: the next GET sees it, no browser state involved.
  assert.deepEqual(await okSettings(await GET()), {
    thinkingExpandedDefault: true,
    quoteSelection: true,
    enterSendMode: "ctrlEnter",
  });
  assert.deepEqual(JSON.parse(await readFile(settingsPath, "utf8")), {
    version: 1,
    thinkingExpandedDefault: true,
    quoteSelection: true,
    enterSendMode: "ctrlEnter",
  });
});

test("a body that names no setting, or the wrong type, is refused", async () => {
  await reset();
  for (const body of [{}, { thinkingExpandedDefault: "yes" }, { enterSendMode: "tab" }, { quoteSelection: null }]) {
    const response = await put(body);
    assert.equal(response.status, 400);
    const payload = await response.json();
    assert.equal(payload.reason, "invalid-request");
  }
  // A body that is not JSON, or not an object at all.
  assert.equal((await put("{ not json")).status, 400);
  assert.equal((await put([])).status, 400);
  // Nothing was written by a refused request.
  await assert.rejects(readFile(settingsPath, "utf8"));
});

test("a request from another origin, or one without a JSON content type, is refused", async () => {
  await reset();
  const untrusted = await put({ quoteSelection: true }, { host: "localhost", "Content-Type": "application/json", origin: "https://elsewhere.example" });
  assert.equal(untrusted.status, 403);
  assert.equal((untrusted.json && (await untrusted.json()).reason), "request-denied");

  const wrongType = await put({ quoteSelection: true }, { host: "localhost", "Content-Type": "text/plain" });
  assert.equal(wrongType.status, 415);
  assert.equal((await wrongType.json()).reason, "content-type");
  await assert.rejects(readFile(settingsPath, "utf8"));
});

test("a corrupt file is backed up and replaced by the write", async () => {
  await reset();
  await writeFile(settingsPath, "{ not json");
  resetPiWebSettingsCacheForTests();
  const warnings = [];
  const previous = console.warn;
  console.warn = (...args) => warnings.push(args.join(" "));
  try {
    assert.deepEqual(await okSettings(await put({ quick: undefined, thinkingExpandedDefault: true })), {
      ...DEFAULT_PI_WEB_SETTINGS,
      thinkingExpandedDefault: true,
    });
  } finally {
    console.warn = previous;
  }
  assert.deepEqual(JSON.parse(await readFile(settingsPath, "utf8")), { version: 1, thinkingExpandedDefault: true });
  assert.ok(warnings.some((line) => line.includes("is not valid pi-web settings") || line.includes("could not be parsed")));
});

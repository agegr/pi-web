import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { createJiti } from "jiti";

const agentDir = mkdtempSync(join(tmpdir(), "pi-web-remote-route-"));
process.env.PI_CODING_AGENT_DIR = agentDir;
delete process.env.PI_WEB_PASSWORD;
delete process.env.PI_WEB_ALLOWED_HOSTS;
after(() => rmSync(agentDir, { recursive: true, force: true }));

const jiti = createJiti(import.meta.url, {
  alias: { "@": process.cwd() },
  moduleCache: false,
});

function localRequest(method, body, host = "127.0.0.1:30141") {
  return new Request("http://127.0.0.1:30141/api/remote-access", {
    method,
    headers: {
      host,
      origin: `http://${host}`,
      "sec-fetch-site": "same-origin",
      ...(body ? { "content-type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}

test("GET snapshot never includes password or hash", async () => {
  const { GET, PUT } = await jiti.import("./route.ts");
  const saved = await PUT(localRequest("PUT", {
    allowedHosts: ["pi.example.com"],
    password: "twelve chars!",
  }));
  assert.equal(saved.status, 200);
  const get = await GET(localRequest("GET"));
  assert.equal(get.status, 200);
  const body = await get.json();
  assert.deepEqual(body.allowedHosts, ["pi.example.com"]);
  assert.equal(body.passwordConfigured, true);
  assert.equal(body.passwordSource, "file");
  assert.equal(body.username, "pi");
  assert.equal("password" in body, false);
  assert.equal("passwordHash" in body, false);
  assert.doesNotMatch(JSON.stringify(body), /twelve chars!|scrypt\$/);
});

test("PUT rejects remote password clearing and invalid hostnames", async () => {
  const { PUT } = await jiti.import("./route.ts");
  const invalid = await PUT(localRequest("PUT", {
    allowedHosts: ["https://pi.example.com"],
    password: "twelve chars!",
  }));
  assert.equal(invalid.status, 400);
  assert.equal((await invalid.json()).code, "invalid_hostname");

  const seeded = await PUT(localRequest("PUT", {
    allowedHosts: [],
    password: "twelve chars!",
  }));
  assert.equal(seeded.status, 200);

  const remoteClear = await PUT(localRequest("PUT", {
    allowedHosts: [],
    password: null,
  }, "192.168.1.1"));
  assert.equal(remoteClear.status, 403);
  assert.equal((await remoteClear.json()).code, "cannot_disable_password_remotely");
});

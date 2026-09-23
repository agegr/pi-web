import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";
import { createJiti } from "jiti";
import { NextRequest } from "next/server.js";

const root = await mkdtemp(join(tmpdir(), "pi-web-default-cwd-route-"));
const agentDir = join(root, "agent");
const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
process.env.PI_CODING_AGENT_DIR = agentDir;
await mkdir(agentDir, { recursive: true });

const jiti = createJiti(import.meta.url, {
  alias: { "@": process.cwd() },
  interopDefault: true,
  moduleCache: false,
});
const { GET, POST, PUT } = await jiti.import("./route.ts");

after(async () => {
  if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
  await rm(root, { recursive: true, force: true });
});

function request(method, body) {
  return new NextRequest("http://localhost/api/default-cwd", {
    method,
    headers: {
      Host: "localhost",
      Origin: "http://localhost",
      "Sec-Fetch-Site": "same-origin",
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

test("GET reports the built-in dated folder until a custom path is saved", async () => {
  const response = await GET();
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.path, "");
  assert.equal(body.placeholder, "~/pi-cwd-{date}");
  assert.match(body.resolved, /pi-cwd-\d{8}$/);
});

test("PUT stores a custom path and POST creates that directory", async () => {
  const cwd = join(root, "scratch");
  let response = await PUT(request("PUT", { path: cwd }));
  let body = await response.json();
  assert.equal(response.status, 200);
  assert.deepEqual(body, {
    path: cwd,
    resolved: cwd,
    placeholder: "~/pi-cwd-{date}",
  });

  response = await POST(request("POST"));
  body = await response.json();
  assert.equal(response.status, 200);
  assert.deepEqual(body, { cwd });
  assert.equal((await stat(cwd)).isDirectory(), true);

  response = await PUT(request("PUT", { path: "" }));
  body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.path, "");
  assert.match(body.resolved, /pi-cwd-\d{8}$/);
});

test("PUT rejects a relative path", async () => {
  const response = await PUT(request("PUT", { path: "relative/dir" }));
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /absolute path/);
});

test("rejects untrusted mutating requests", async () => {
  const response = await PUT(new NextRequest("http://localhost/api/default-cwd", {
    method: "PUT",
    headers: {
      Host: "localhost",
      Origin: "https://evil.example",
      "Sec-Fetch-Site": "cross-site",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ path: join(root, "nope") }),
  }));
  assert.equal(response.status, 403);
});

import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { createJiti } from "jiti";

const agentDir = mkdtempSync(join(tmpdir(), "pi-web-tanstack-security-"));
process.env.PI_CODING_AGENT_DIR = agentDir;
after(() => rmSync(agentDir, { recursive: true, force: true }));

const jiti = createJiti(import.meta.url, {
  alias: { "@": process.cwd() },
  moduleCache: false,
});

const cases = [
  {
    name: "rejects an untrusted API host as JSON",
    request: new Request("http://localhost:30141/api/sessions", {
      headers: { host: "attacker.example:30141", origin: "http://attacker.example:30141" },
    }),
    status: 403,
    contentType: "application/json",
    body: { error: "Untrusted API request" },
  },
  {
    name: "rejects an untrusted root host as text",
    request: new Request("http://localhost:30141/", {
      headers: { host: "attacker.example:30141" },
    }),
    status: 403,
    contentType: "text/plain",
    body: "Untrusted request",
  },
];

test("request security rejects untrusted hosts with the legacy response matrix", async () => {
  const { getRequestSecurityRejection } = await jiti.import("../src/request-security.ts");
  for (const c of cases) {
    const response = getRequestSecurityRejection(c.request);
    assert.ok(response, `${c.name}: expected a rejection response`);
    assert.equal(response.status, c.status, c.name);
    if (c.contentType === "text/plain") {
      assert.ok(
        response.headers.get("content-type")?.startsWith("text/plain"),
        `${c.name}: expected a text content type`,
      );
    } else {
      assert.equal(response.headers.get("content-type"), c.contentType, c.name);
    }
    assert.deepEqual(
      c.contentType === "application/json" ? await response.json() : await response.text(),
      c.body,
      c.name,
    );
  }
});

test("request security requires Basic Auth when PI_WEB_PASSWORD is enabled", async () => {
  const { getRequestSecurityRejection } = await jiti.import("../src/request-security.ts");
  process.env.PI_WEB_PASSWORD = "correct horse battery staple";
  try {
    const response = getRequestSecurityRejection(new Request("http://localhost:30141/", {
      headers: { host: "localhost:30141" },
    }));
    assert.equal(response.status, 401);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(
      response.headers.get("www-authenticate"),
      'Basic realm="Pi Web", charset="UTF-8"',
    );
    assert.equal(await response.text(), "Authentication required");
  } finally {
    delete process.env.PI_WEB_PASSWORD;
  }
});

test("request security allows trusted roots and APIs", async () => {
  const { getRequestSecurityRejection } = await jiti.import("../src/request-security.ts");
  const trusted = [
    new Request("http://localhost:30141/", { headers: { host: "localhost:30141" } }),
    new Request("http://localhost:30141/api/sessions", {
      headers: { host: "localhost:30141", origin: "http://localhost:30141" },
    }),
  ];
  for (const request of trusted) {
    assert.equal(getRequestSecurityRejection(request), undefined);
  }
});

test("request security accepts valid Basic Auth", async () => {
  const { getRequestSecurityRejection } = await jiti.import("../src/request-security.ts");
  process.env.PI_WEB_PASSWORD = "correct horse battery staple";
  try {
    const authorization = `Basic ${Buffer.from("pi:correct horse battery staple").toString("base64")}`;
    const request = new Request("http://localhost:30141/", {
      headers: { host: "localhost:30141", authorization },
    });
    assert.equal(getRequestSecurityRejection(request), undefined);
  } finally {
    delete process.env.PI_WEB_PASSWORD;
  }
});

test("request security bypasses static PWA assets like the former proxy matcher", async () => {
  const { getRequestSecurityRejection } = await jiti.import("../src/request-security.ts");
  process.env.PI_WEB_PASSWORD = "correct horse battery staple";
  try {
    const untrustedHost = "attacker.example:30141";
    for (const pathname of [
      "/sw.js",
      "/manifest.webmanifest",
      "/offline.html",
      "/icons/icon-192.png",
      "/_build/app.js",
    ]) {
      const request = new Request(`http://localhost:30141${pathname}`, {
        headers: { host: untrustedHost },
      });
      assert.equal(
        getRequestSecurityRejection(request),
        undefined,
        `${pathname} must bypass the security bridge`,
      );
    }
  } finally {
    delete process.env.PI_WEB_PASSWORD;
  }
});

test("request security allows HTTPS proxy scheme mismatch when Host matches Origin host", async () => {
  const { getRequestSecurityRejection } = await jiti.import("../src/request-security.ts");
  const response = getRequestSecurityRejection(new Request("https://localhost:30141/api/agent/new", {
    method: "POST",
    headers: {
      host: "localhost:30141",
      origin: "http://localhost:30141",
      "x-forwarded-proto": "https",
      "sec-fetch-site": "same-origin",
      "content-type": "application/json",
    },
  }));
  assert.equal(response, undefined);
});

test("global middleware registers request security before filtered server-function CSRF", async () => {
  const startSource = await readFile(new URL("../src/start.ts", import.meta.url), "utf8");
  assert.match(startSource, /requestMiddleware/);
  assert.match(startSource, /handlerType === "serverFn"/);
  const securityIndex = startSource.indexOf("requestSecurityMiddleware");
  const csrfIndex = startSource.indexOf("serverFunctionCsrfMiddleware");
  assert.ok(securityIndex >= 0 && csrfIndex > securityIndex, "security middleware must precede CSRF middleware");
});

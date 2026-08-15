import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { moduleCache: false });

function snapshot(overrides = {}) {
  return {
    schemaVersion: 1,
    configPath: "/tmp/pi-web-vision-env",
    writable: true,
    settings: {
      protocol: "chat_completions",
      baseUrl: "https://vision.example.test/v1",
      model: "flash",
      language: "zh",
    },
    credential: { configured: true, source: "file", writable: true },
    install: {
      extension: { present: true, path: "/tmp/vision.ts" },
      skill: { present: true, path: "/tmp/SKILL.md" },
    },
    ...overrides,
  };
}

async function loadHelper() {
  return jiti.import("./vision-toolkit-health.ts");
}

test("local health does not call fetch", async () => {
  const { runVisionToolkitHealth } = await loadHelper();
  let fetches = 0;
  const result = await runVisionToolkitHealth({
    testConnection: false,
    snapshot: snapshot(),
    fetchImpl: async () => {
      fetches += 1;
      return new Response("{}", { status: 200 });
    },
    lookPath: (command) => `/usr/bin/${command}`,
    runCommand: (command, args) => {
      if (args.includes("--version") || command.includes("python")) {
        return { ok: true, stdout: "Python 3.12.0", stderr: "" };
      }
      return { ok: true, stdout: "", stderr: "" };
    },
    fileExists: () => true,
    readStoredApiKey: () => "sk-secret",
  });

  assert.equal(fetches, 0);
  assert.equal(result.connectionTested, false);
  assert.equal(result.checks.service, undefined);
});

test("missing python is error, missing chrome is warning", async () => {
  const { runVisionToolkitHealth } = await loadHelper();
  const result = await runVisionToolkitHealth({
    testConnection: false,
    snapshot: snapshot(),
    fetchImpl: async () => {
      throw new Error("fetch must not run");
    },
    lookPath: () => undefined,
    runCommand: () => ({ ok: false, stdout: "", stderr: "not found" }),
    fileExists: () => false,
    readStoredApiKey: () => "sk-secret",
  });

  assert.equal(result.checks.python.status, "error");
  assert.equal(result.checks.chrome.status, "warning");
  assert.equal(result.healthy, false);
});

test("connection 200 / 401 / 404 / 429 / network map to the spec statuses", async () => {
  const { runVisionToolkitHealth } = await loadHelper();

  async function classify(status, network = false) {
    return runVisionToolkitHealth({
      testConnection: true,
      snapshot: snapshot(),
      fetchImpl: async () => {
        if (network) throw new TypeError("fetch failed");
        return new Response("{}", { status });
      },
      lookPath: (command) => `/usr/bin/${command}`,
      runCommand: () => ({ ok: true, stdout: "Python 3.12.0", stderr: "" }),
      fileExists: () => true,
      readStoredApiKey: () => "sk-secret",
    });
  }

  const ok = await classify(200);
  assert.equal(ok.checks.service.status, "ok");
  assert.match(ok.checks.service.detail, /HTTP 200/);
  assert.equal(ok.connectionTested, true);

  const unauthorized = await classify(401);
  assert.equal(unauthorized.checks.service.status, "error");
  assert.match(unauthorized.checks.service.detail, /401/);

  const forbidden = await classify(403);
  assert.equal(forbidden.checks.service.status, "error");

  const missingModels = await classify(404);
  assert.equal(missingModels.checks.service.status, "warning");
  assert.match(missingModels.checks.service.detail, /\/models/);

  const limited = await classify(429);
  assert.equal(limited.checks.service.status, "warning");
  assert.match(limited.checks.service.detail, /429/);

  const other = await classify(500);
  assert.equal(other.checks.service.status, "error");
  assert.match(other.checks.service.detail, /500/);

  const unreachable = await classify(0, true);
  assert.equal(unreachable.checks.service.status, "error");
  assert.match(unreachable.checks.service.detail, /could not be reached/i);
});

test("connection is GET {baseUrl}/models with Authorization and no body", async () => {
  const { runVisionToolkitHealth } = await loadHelper();
  /** @type {{ url?: string, init?: RequestInit }} */
  const seen = {};
  await runVisionToolkitHealth({
    testConnection: true,
    snapshot: snapshot(),
    fetchImpl: async (input, init) => {
      seen.url = String(input);
      seen.init = init;
      return new Response("{}", { status: 200 });
    },
    lookPath: (command) => `/usr/bin/${command}`,
    runCommand: () => ({ ok: true, stdout: "Python 3.12.0", stderr: "" }),
    fileExists: () => true,
    readStoredApiKey: () => "sk-secret",
  });

  assert.equal(seen.url, "https://vision.example.test/v1/models");
  assert.equal(seen.init?.method ?? "GET", "GET");
  assert.equal(seen.init?.body, undefined);
  const headers = new Headers(seen.init?.headers);
  assert.equal(headers.get("authorization"), "Bearer sk-secret");
});

test("error strings redact the api key", async () => {
  const { runVisionToolkitHealth } = await loadHelper();
  const secret = "sk-super-secret-do-not-leak";
  const result = await runVisionToolkitHealth({
    testConnection: true,
    snapshot: snapshot(),
    fetchImpl: async () => {
      throw new Error(`ECONNREFUSED while using ${secret}`);
    },
    lookPath: (command) => `/usr/bin/${command}`,
    runCommand: () => ({ ok: true, stdout: "Python 3.12.0", stderr: "" }),
    fileExists: () => true,
    readStoredApiKey: () => secret,
  });

  const serialized = JSON.stringify(result);
  assert.doesNotMatch(serialized, /sk-super-secret-do-not-leak/);
  assert.doesNotMatch(serialized, /apiKey/);
  assert.equal(result.checks.service.status, "error");
});

function localStubs(overrides = {}) {
  return {
    lookPath: (command) => `/usr/bin/${command}`,
    runCommand: () => ({ ok: true, stdout: "Python 3.12.0", stderr: "" }),
    fileExists: () => true,
    readStoredApiKey: () => "sk-secret",
    ...overrides,
  };
}

test("connection test rejects private and link-local targets when a credential is attached", async () => {
  const { runVisionToolkitHealth } = await loadHelper();
  let fetches = 0;
  const result = await runVisionToolkitHealth({
    testConnection: true,
    snapshot: snapshot({
      settings: {
        protocol: "chat_completions",
        baseUrl: "http://169.254.169.254/",
        model: "flash",
        language: "zh",
      },
    }),
    fetchImpl: async () => {
      fetches += 1;
      return new Response("{}", { status: 200 });
    },
    ...localStubs(),
  });

  assert.equal(fetches, 0);
  assert.equal(result.connectionTested, false);
  assert.equal(result.checks.service.status, "error");
  assert.match(result.checks.service.detail, /private|link-local/i);
});

test("connection test allows loopback proxies with a credential", async () => {
  const { runVisionToolkitHealth } = await loadHelper();
  /** @type {{ url?: string }} */
  const seen = {};
  const result = await runVisionToolkitHealth({
    testConnection: true,
    snapshot: snapshot({
      settings: {
        protocol: "chat_completions",
        baseUrl: "http://127.0.0.1:8787/v1",
        model: "flash",
        language: "zh",
      },
    }),
    fetchImpl: async (input) => {
      seen.url = String(input);
      return new Response("{}", { status: 200 });
    },
    ...localStubs(),
  });

  assert.equal(seen.url, "http://127.0.0.1:8787/v1/models");
  assert.equal(result.checks.service.status, "ok");
  assert.equal(result.connectionTested, true);
});

test("connection test aborts a stalled upstream", async () => {
  const { runVisionToolkitHealth } = await loadHelper();
  /** @type {AbortSignal | undefined} */
  let signal;
  const result = await runVisionToolkitHealth({
    testConnection: true,
    snapshot: snapshot(),
    fetchImpl: async (_input, init) => {
      signal = init?.signal;
      const error = new Error("The operation was aborted due to timeout");
      error.name = "TimeoutError";
      throw error;
    },
    ...localStubs(),
  });

  assert.ok(signal);
  assert.equal(result.checks.service.status, "error");
  assert.match(result.checks.service.detail, /timed out/i);
});

test("health request body must be { testConnection: boolean }", async () => {
  const { parseVisionHealthRequest } = await loadHelper();
  assert.deepEqual(parseVisionHealthRequest({ testConnection: true }), {
    ok: true,
    testConnection: true,
  });
  assert.deepEqual(parseVisionHealthRequest({ testConnection: false }), {
    ok: true,
    testConnection: false,
  });
  assert.equal(parseVisionHealthRequest(null).ok, false);
  assert.equal(parseVisionHealthRequest({}).ok, false);
  assert.equal(parseVisionHealthRequest({ testConnection: "true" }).ok, false);
  assert.equal(parseVisionHealthRequest({ testConnection: 1 }).ok, false);
});

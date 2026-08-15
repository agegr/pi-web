import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  alias: { "@": process.cwd() },
  moduleCache: false,
});

function createAgentDir(t) {
  const root = mkdtempSync(join(tmpdir(), "pi-web-remote-access-"));
  const previous = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = root;
  t.after(() => {
    if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previous;
    rmSync(root, { recursive: true, force: true });
  });
  return root;
}

async function load() {
  return jiti.import("./remote-access-config.ts");
}

test("parseAllowedHostname accepts domains and IDN, rejects URLs wildcards IPs and ports", async () => {
  const { parseAllowedHostname } = await load();
  assert.deepEqual(parseAllowedHostname("pi.example.com"), { ok: true, hostname: "pi.example.com" });
  assert.deepEqual(parseAllowedHostname("PI.Example.COM."), { ok: true, hostname: "pi.example.com" });
  const idn = parseAllowedHostname("münchen.example");
  assert.equal(idn.ok, true);
  if (idn.ok) assert.match(idn.hostname, /^xn--/);

  for (const value of [
    "",
    "https://pi.example.com",
    "pi.example.com/path",
    "pi.example.com:443",
    "*.example.com",
    "*",
    "127.0.0.1",
    "::1",
    "user:pass@pi.example.com",
  ]) {
    const parsed = parseAllowedHostname(value);
    assert.equal(parsed.ok, false, value);
  }
});

test("write creates 0600 file, preserves unknown keys, and never snapshots secrets", async (t) => {
  const root = createAgentDir(t);
  const { writeRemoteAccessConfig, getRemoteAccessConfigPath, invalidateRemoteAccessCache } = await load();
  const path = getRemoteAccessConfigPath();
  writeFileSync(path, JSON.stringify({
    schemaVersion: 1,
    allowedHosts: [],
    operatorNote: "keep-me",
  }, null, 2));
  invalidateRemoteAccessCache();

  const result = writeRemoteAccessConfig({
    allowedHosts: ["pi.example.com"],
    password: "correct horse",
    loopbackRequest: true,
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.snapshot.allowedHosts[0], "pi.example.com");
  assert.equal(result.snapshot.passwordConfigured, true);
  assert.equal(result.snapshot.passwordSource, "file");
  assert.equal("password" in result.snapshot, false);
  assert.equal("passwordHash" in result.snapshot, false);
  assert.doesNotMatch(JSON.stringify(result.snapshot), /correct horse|passwordHash|scrypt\$/);

  const saved = JSON.parse(readFileSync(path, "utf8"));
  assert.equal(saved.operatorNote, "keep-me");
  assert.match(saved.passwordHash, /^scrypt\$16384\$8\$1\$/);
  assert.equal(statSync(path).mode & 0o777, 0o600);
  assert.equal(root.startsWith(tmpdir()) || path.includes(root), true);
});

test("stored hash verifies the original password and rejects a wrong one", async (t) => {
  createAgentDir(t);
  const { writeRemoteAccessConfig, verifyStoredPassword } = await load();
  const written = writeRemoteAccessConfig({
    allowedHosts: [],
    password: "twelve chars!",
    loopbackRequest: true,
  });
  assert.equal(written.ok, true);
  assert.equal(verifyStoredPassword("twelve chars!"), true);
  assert.equal(verifyStoredPassword("wrong password"), false);
});

test("hosts require a password unless env supplies one", async (t) => {
  createAgentDir(t);
  const previous = process.env.PI_WEB_PASSWORD;
  delete process.env.PI_WEB_PASSWORD;
  t.after(() => {
    if (previous === undefined) delete process.env.PI_WEB_PASSWORD;
    else process.env.PI_WEB_PASSWORD = previous;
  });
  const { writeRemoteAccessConfig } = await load();
  const missing = writeRemoteAccessConfig({
    allowedHosts: ["pi.example.com"],
    loopbackRequest: true,
  });
  assert.equal(missing.ok, false);
  if (!missing.ok) assert.equal(missing.code, "password_required");

  process.env.PI_WEB_PASSWORD = "env-password-ok";
  const withEnv = writeRemoteAccessConfig({
    allowedHosts: ["pi.example.com"],
    loopbackRequest: true,
  });
  assert.equal(withEnv.ok, true);
});

test("clearing a password from a non-loopback request is forbidden", async (t) => {
  createAgentDir(t);
  const { writeRemoteAccessConfig } = await load();
  assert.equal(writeRemoteAccessConfig({
    allowedHosts: [],
    password: "twelve chars!",
    loopbackRequest: true,
  }).ok, true);
  const remote = writeRemoteAccessConfig({
    allowedHosts: [],
    password: null,
    loopbackRequest: false,
  });
  assert.equal(remote.ok, false);
  if (!remote.ok) {
    assert.equal(remote.status, 403);
    assert.equal(remote.code, "cannot_disable_password_remotely");
  }
});

test("clearing a password while hosts remain requires env or loopback empty hosts", async (t) => {
  createAgentDir(t);
  const previous = process.env.PI_WEB_PASSWORD;
  delete process.env.PI_WEB_PASSWORD;
  t.after(() => {
    if (previous === undefined) delete process.env.PI_WEB_PASSWORD;
    else process.env.PI_WEB_PASSWORD = previous;
  });
  const { writeRemoteAccessConfig } = await load();
  assert.equal(writeRemoteAccessConfig({
    allowedHosts: ["pi.example.com"],
    password: "twelve chars!",
    loopbackRequest: true,
  }).ok, true);
  const blocked = writeRemoteAccessConfig({
    allowedHosts: ["pi.example.com"],
    password: null,
    loopbackRequest: true,
  });
  assert.equal(blocked.ok, false);
  if (!blocked.ok) assert.equal(blocked.code, "password_required");

  const cleared = writeRemoteAccessConfig({
    allowedHosts: [],
    password: null,
    loopbackRequest: true,
  });
  assert.equal(cleared.ok, true);
});

test("corrupt JSON fails closed for hosts and reports configError", async (t) => {
  const root = createAgentDir(t);
  const { getRemoteAccessConfigPath, readRemoteAccessSnapshot, readRemoteAccessAllowedHosts, invalidateRemoteAccessCache } = await load();
  writeFileSync(getRemoteAccessConfigPath(), "{not json");
  invalidateRemoteAccessCache();
  assert.deepEqual(readRemoteAccessAllowedHosts(), []);
  const snapshot = readRemoteAccessSnapshot();
  assert.equal(typeof snapshot.configError, "string");
  assert.deepEqual(snapshot.allowedHosts, []);
  assert.equal(root.length > 0, true);
});

test("unspecified bind advertises the request host instead of 0.0.0.0", async (t) => {
  createAgentDir(t);
  const previous = {
    PI_WEB_HOSTNAME: process.env.PI_WEB_HOSTNAME,
    NITRO_HOST: process.env.NITRO_HOST,
    NITRO_PORT: process.env.NITRO_PORT,
    PORT: process.env.PORT,
  };
  t.after(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
  process.env.PI_WEB_HOSTNAME = "0.0.0.0";
  process.env.NITRO_HOST = "0.0.0.0";
  process.env.NITRO_PORT = "30141";
  delete process.env.PORT;

  const { readRemoteAccessSnapshot } = await load();
  const snapshot = readRemoteAccessSnapshot(new Request("http://192.168.5.172:30143/api/remote-access", {
    headers: { host: "192.168.5.172:30143" },
  }));
  assert.equal(snapshot.bindHostname, "192.168.5.172");
  assert.equal(snapshot.bindPort, "30143");
  assert.notEqual(snapshot.bindHostname, "0.0.0.0");
});

test("explicit loopback bind is not replaced by the request host", async (t) => {
  createAgentDir(t);
  const previous = process.env.PI_WEB_HOSTNAME;
  t.after(() => {
    if (previous === undefined) delete process.env.PI_WEB_HOSTNAME;
    else process.env.PI_WEB_HOSTNAME = previous;
  });
  process.env.PI_WEB_HOSTNAME = "127.0.0.1";
  const { readRemoteAccessSnapshot } = await load();
  const snapshot = readRemoteAccessSnapshot(new Request("http://192.168.5.172:30143/api/remote-access", {
    headers: { host: "192.168.5.172:30143" },
  }));
  assert.equal(snapshot.bindHostname, "127.0.0.1");
});

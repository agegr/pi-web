import assert from "node:assert/strict";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

const root = await mkdtemp(path.join(tmpdir(), "pi-web-auth-"));
const configPath = path.join(root, "pi-web-auth.json");
process.env.PI_WEB_AUTH_CONFIG_PATH = configPath;
const auth = await import(`./auth.ts?test=${Date.now()}`);

test.after(async () => {
  delete process.env.PI_WEB_AUTH_CONFIG_PATH;
  await rm(root, { recursive: true, force: true });
});

test("initializes password authentication once with private file permissions", async () => {
  assert.equal(auth.authIsConfigured(), false);
  assert.equal(auth.initializeAuth("correct horse battery staple"), "created");
  assert.equal(auth.initializeAuth("different password"), "exists");
  assert.equal(auth.verifyPassword("correct horse battery staple"), true);
  assert.equal(auth.verifyPassword("wrong password"), false);

  const configStat = await stat(configPath);
  assert.equal(configStat.mode & 0o777, 0o600);
});

test("accepts valid session tokens and rejects expired or tampered tokens", () => {
  const issuedAt = Date.UTC(2026, 0, 1);
  const token = auth.createSessionToken(issuedAt);

  assert.equal(auth.verifySessionToken(token, issuedAt + 1_000), true);
  assert.equal(auth.verifySessionToken(token, issuedAt + 31 * 24 * 60 * 60 * 1_000), false);
  assert.equal(auth.verifySessionToken(`${token}tampered`, issuedAt + 1_000), false);
  assert.equal(auth.verifySessionToken(undefined, issuedAt), false);
});

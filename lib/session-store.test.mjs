import assert from "node:assert/strict";
import { existsSync, readFileSync, unlinkSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import test from "node:test";

// Note: lazy key creation is implicitly exercised by every other test in
// this file — if the module's secret were broken, sign+verify would fail.

const SESSION_KEY_FILE = join(homedir(), ".pi-web", "session.key");

// Snapshot the existing key so the test run does not pollute a real install.
let originalKey = null;
if (existsSync(SESSION_KEY_FILE)) {
  originalKey = readFileSync(SESSION_KEY_FILE);
}

async function loadSubject() {
  return import("./session-store.ts");
}

function tamperMiddle(value, replacement) {
  const middle = Math.floor(value.length / 2);
  return value.slice(0, middle) + replacement + value.slice(middle + 1);
}

test("signSession and verifySession round-trip a future expiry", async () => {
  const { signSession, verifySession } = await loadSubject();
  const exp = Date.now() + 60_000;
  const cookie = signSession(exp);
  assert.equal(typeof cookie, "string");
  assert.ok(cookie.includes("."), "cookie must contain the payload.signature separator");
  assert.equal(verifySession(cookie), exp);
});

test("verifySession rejects a cookie with a tampered payload", async () => {
  const { signSession, verifySession } = await loadSubject();
  const cookie = signSession(Date.now() + 60_000);
  const [payload, signature] = cookie.split(".");
  // Flip the first payload character to a different valid base64url char.
  const swapped = payload[0] === "A" ? "B" : "A";
  const tampered = swapped + payload.slice(1) + "." + signature;
  assert.equal(verifySession(tampered), null);
});

test("verifySession rejects a cookie with a tampered signature", async () => {
  const { signSession, verifySession } = await loadSubject();
  const cookie = signSession(Date.now() + 60_000);
  const tampered = tamperMiddle(cookie, "X");
  assert.notEqual(tampered, cookie);
  assert.equal(verifySession(tampered), null);
});

test("verifySession rejects an expired cookie", async () => {
  const { signSession, verifySession } = await loadSubject();
  const cookie = signSession(Date.now() - 1);
  assert.equal(verifySession(cookie), null);
});

test("verifySession rejects malformed inputs without throwing", async () => {
  const { verifySession } = await loadSubject();
  assert.equal(verifySession(""), null);
  assert.equal(verifySession("no-separator"), null);
  assert.equal(verifySession(".just-a-signature"), null);
  assert.equal(verifySession("just-a-payload."), null);
  assert.equal(verifySession("!!!.???"), null);
  assert.equal(verifySession("a.b.c"), null); // extra separator
});

// Restore the original key exactly as we found it.
test.after(async () => {
  if (originalKey) {
    const { writeFileSync, renameSync, unlinkSync: rm } = await import("node:fs");
    const { basename, dirname, join } = await import("node:path");
    const { randomBytes } = await import("node:crypto");
    const dir = dirname(SESSION_KEY_FILE);
    const temp = join(dir, `.session.key-${randomBytes(16).toString("hex")}.tmp`);
    writeFileSync(temp, originalKey, { encoding: "binary", flag: "wx", mode: 0o600 });
    renameSync(temp, SESSION_KEY_FILE);
    // Reference to satisfy the linter — writeFileSync already opened in 0o600.
    void basename; void rm;
  } else if (existsSync(SESSION_KEY_FILE)) {
    unlinkSync(SESSION_KEY_FILE);
  }
});
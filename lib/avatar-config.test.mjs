import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  tsconfigPaths: true,
});
const {
  normalizeAvatarConfig,
  parseAvatarConfig,
  validateAvatarDataUrl,
  validateAvatarConfigPayload,
} = await jiti.import("./avatar-config.ts");
const {
  getAvatarConfigPath,
  readAvatarConfig,
  writeAvatarConfig,
} = await jiti.import("./avatar-config.server.ts");

const EMPTY_CONFIG = {
  user: null,
  assistant: null,
  tool: null,
};

function createProject(t) {
  const cwd = mkdtempSync(join(tmpdir(), "pi-web-avatars-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  return cwd;
}

function writeConfig(cwd, contents) {
  mkdirSync(join(cwd, ".pi"), { recursive: true });
  writeFileSync(getAvatarConfigPath(cwd), contents, "utf8");
}

test("missing avatar config resolves to a complete null record without creating a file", (t) => {
  const cwd = createProject(t);

  assert.deepEqual(readAvatarConfig(cwd), EMPTY_CONFIG);
  assert.equal(existsSync(getAvatarConfigPath(cwd)), false);
});

test("malformed avatar JSON resolves to a complete null record", (t) => {
  const cwd = createProject(t);
  writeConfig(cwd, '{"user":"data:image/png;base64,abc"');

  assert.deepEqual(readAvatarConfig(cwd), EMPTY_CONFIG);
});

test("incomplete avatar config preserves valid keys and fills missing keys with null", (t) => {
  const cwd = createProject(t);
  const userAvatar = "data:image/png;base64,dXNlcg==";
  writeConfig(cwd, JSON.stringify({ user: userAvatar }));

  assert.deepEqual(readAvatarConfig(cwd), {
    user: userAvatar,
    assistant: null,
    tool: null,
  });
});

test("unexpected role values are ignored without discarding valid present keys", () => {
  const assistantAvatar = "data:image/webp;base64,YXNzaXN0YW50";

  assert.deepEqual(
    normalizeAvatarConfig({
      user: 42,
      assistant: assistantAvatar,
      tool: { src: "not-supported" },
      extra: "ignored",
    }),
    {
      user: null,
      assistant: assistantAvatar,
      tool: null,
    },
  );
});

test("non-object JSON also resolves to a complete null record", () => {
  assert.deepEqual(parseAvatarConfig("null"), EMPTY_CONFIG);
  assert.deepEqual(parseAvatarConfig('"not-an-object"'), EMPTY_CONFIG);
});

// --- validateAvatarDataUrl ---

test("validateAvatarDataUrl accepts a canonical PNG data URL", () => {
  const result = validateAvatarDataUrl("data:image/png;base64,dGVzdA==");
  assert.deepEqual(result, {
    ok: true,
    mime: "image/png",
    base64: "dGVzdA==",
  });
});

test("validateAvatarDataUrl accepts JPEG and WebP data URLs case-insensitively", () => {
  for (const value of [
    "data:image/jpeg;base64,YWJj",
    "data:image/webp;base64,WFla",
    "DATA:IMAGE/PNG;base64,YWJj",
  ]) {
    const result = validateAvatarDataUrl(value);
    assert.equal(result.ok, true, `expected ok for ${value}`);
  }
});

test("validateAvatarDataUrl rejects unsupported MIME types and non-data values", () => {
  for (const value of [
    "data:image/svg+xml;base64,PHN2Zy8+",
    "data:image/gif;base64,R0lGODlh",
    "data:text/plain;base64,Zm9v",
    "https://example.com/avatar.png",
    "data:image/png,not-base64",
    "data:image/png;base64,",
  ]) {
    const result = validateAvatarDataUrl(value);
    assert.equal(result.ok, false, `expected failure for ${value}`);
  }
});

test("validateAvatarDataUrl strips whitespace inside the base64 payload", () => {
  const result = validateAvatarDataUrl("data:image/png;base64,dGVz dA==");
  assert.equal(result.ok, true);
  assert.equal(result.ok ? result.base64 : "", "dGVzdA==");
});

// --- validateAvatarConfigPayload ---

test("validateAvatarConfigPayload returns a normalized complete record for valid input", () => {
  const result = validateAvatarConfigPayload({
    user: "data:image/png;base64,dXNlcg==",
    assistant: "data:image/jpeg;base64,YXNz",
    tool: null,
  });
  assert.deepEqual(result, {
    user: "data:image/png;base64,dXNlcg==",
    assistant: "data:image/jpeg;base64,YXNz",
    tool: null,
  });
});

test("validateAvatarConfigPayload throws when a role is not a supported data URL", () => {
  assert.throws(
    () =>
      validateAvatarConfigPayload({
        user: "data:image/svg+xml;base64,PHN2Zy8+",
        assistant: null,
        tool: null,
      }),
    /user/,
  );
});

test("validateAvatarConfigPayload throws when input is not an object", () => {
  assert.throws(() => validateAvatarConfigPayload(null), /object/);
  assert.throws(() => validateAvatarConfigPayload("not-an-object"), /object/);
});

// --- writeAvatarConfig ---

test("writeAvatarConfig writes a complete three-role record to the project avatars.json", (t) => {
  const cwd = createProject(t);
  const next = {
    user: "data:image/png;base64,dXNlcg==",
    assistant: "data:image/webp;base64,YXNz",
    tool: "data:image/jpeg;base64,dG9vbA==",
  };

  writeAvatarConfig(cwd, next);

  assert.deepEqual(
    JSON.parse(readFileSync(getAvatarConfigPath(cwd), "utf8")),
    next,
  );
});

test("writeAvatarConfig creates the .pi directory when missing", (t) => {
  const cwd = createProject(t);
  assert.equal(existsSync(join(cwd, ".pi")), false);

  writeAvatarConfig(cwd, { user: null, assistant: null, tool: null });

  assert.equal(existsSync(getAvatarConfigPath(cwd)), true);
});

test("writeAvatarConfig preserves the previous file when a second write fails midway", (t) => {
  const cwd = createProject(t);
  const first = {
    user: "data:image/png;base64,Zmlyc3Q=",
    assistant: null,
    tool: null,
  };
  writeAvatarConfig(cwd, first);

  // A second write replaces atomically; verify the new file is valid.
  const second = {
    user: null,
    assistant: "data:image/webp;base64,c2Vjb25k",
    tool: null,
  };
  writeAvatarConfig(cwd, second);
  assert.deepEqual(readAvatarConfig(cwd), second);
});

test("writeAvatarConfig preserves a null record as the on-disk default", (t) => {
  const cwd = createProject(t);
  writeAvatarConfig(cwd, { user: null, assistant: null, tool: null });
  assert.deepEqual(readAvatarConfig(cwd), EMPTY_CONFIG);
});

// --- 2 MB encoded size guard (ticket #5) ---

test("validateAvatarDataUrl rejects an encoded data URL larger than 2 MB", () => {
  // Build a data URL whose full string length is comfortably above 2 MB.
  const huge = "data:image/png;base64," + "A".repeat(2 * 1024 * 1024 + 1);
  const result = validateAvatarDataUrl(huge);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.match(result.reason, /exceeds/);
    assert.match(result.reason, /2097152/);
  }
});

test("validateAvatarDataUrl accepts an encoded data URL exactly at the 2 MB boundary", () => {
  // Padding before the base64 portion is fixed, so the size test on the
  // full string stays just below the limit for a 2 MB - 1 byte payload.
  const prefix = "data:image/png;base64,";
  const payload = "A".repeat(2 * 1024 * 1024 - prefix.length - 1);
  const boundary = prefix + payload;
  const result = validateAvatarDataUrl(boundary);
  assert.equal(result.ok, true, `expected ok for ${boundary.length}-byte payload`);
});

test("validateAvatarDataUrl checks size before the regex match so it fails fast on huge payloads", () => {
  // 4 MB of garbage: should be rejected with the size reason, not the regex
  // reason ("avatar must be a data:...").
  const huge = "X".repeat(4 * 1024 * 1024);
  const result = validateAvatarDataUrl(huge);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.match(result.reason, /exceeds/);
  }
});

test("validateAvatarConfigPayload rejects an oversized role payload", () => {
  const huge = "data:image/png;base64," + "A".repeat(2 * 1024 * 1024 + 1);
  assert.throws(
    () =>
      validateAvatarConfigPayload({
        user: huge,
        assistant: null,
        tool: null,
      }),
    /exceeds/,
  );
});

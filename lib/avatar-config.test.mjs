import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  tsconfigPaths: true,
});
const { normalizeAvatarConfig, parseAvatarConfig } = await jiti.import(
  "./avatar-config.ts",
);
const { getAvatarConfigPath, readAvatarConfig } = await jiti.import(
  "./avatar-config.server.ts",
);

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
